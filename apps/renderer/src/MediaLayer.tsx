import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelMedia, MediaPlayback, MediaStatus, MediaTransition } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { defaultServerUrl } from "./wsClient";
import type { StageSize } from "./stageSize";
import {
  initialMountPlan,
  mirrorCorrection,
  pendingSeek,
  pickAudioSink,
  readSinkRequest,
  resolveMediaUrl,
  type AppliedSeek,
} from "./mediaSync";
import {
  endFadeStartsAt,
  nextLayers,
  rampGain,
  shouldAnimateIn,
  transitionEasing,
  transitionKeyframes,
  type MediaLayerEntry,
  type TransitionDirection,
} from "./mediaTransition";

const TICK_MS = 250;
const RAMP_STEP_MS = 16;

type Props = {
  media: ChannelMedia | null;
  /** The channel this window renders (URL param), used in media_status. */
  channel: string;
  /** Mirror windows (e.g. alpha) play muted and never report. */
  isMirror: boolean;
  matte: boolean;
  scale: number;
  /** Output resolution (same box as the template stage). */
  stageSize: StageSize;
  send: (msg: ClientMessage) => void;
  /** The last media_clear asked for a hard cut (skip the Out transition). */
  clearCut: boolean;
  /**
   * Mirrors only: the primary window's latest playback report for the source
   * channel, and the server clock offset, so the mirror video can follow it.
   */
  primaryPlayback?: { current: { takenAt: number; playback: MediaPlayback } | null };
  serverOffsetMs?: { current: number };
};

/**
 * Full-frame video slot beneath the template stage. Each take is its own
 * keyed element; an outgoing take stays mounted while its Out transition
 * plays, so a clear fades and a new take crossfades over the old one.
 */
export function MediaLayer(props: Props) {
  const [layers, setLayers] = useState<MediaLayerEntry[]>([]);
  const { media, clearCut } = props;

  useEffect(() => {
    setLayers((prev) => nextLayers(prev, media, clearCut));
  }, [media, clearCut]);

  const remove = useCallback((takenAt: number) => {
    setLayers((prev) => prev.filter((l) => !(l.leaving && l.media.takenAt === takenAt)));
  }, []);

  return (
    <>
      {layers.map((l) => (
        <MediaVideo
          key={l.media.takenAt}
          {...props}
          media={l.media}
          leaving={l.leaving}
          onGone={remove}
        />
      ))}
    </>
  );
}

type VideoProps = Omit<Props, "media" | "clearCut"> & {
  media: ChannelMedia;
  leaving: MediaLayerEntry["leaving"];
  onGone: (takenAt: number) => void;
};

function MediaVideo({
  media,
  channel,
  isMirror,
  matte,
  scale,
  stageSize,
  send,
  leaving,
  onGone,
  primaryPlayback,
  serverOffsetMs,
}: VideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animRef = useRef<HTMLDivElement | null>(null);
  const appliedRef = useRef<AppliedSeek>(initialMountPlan(media).applied);
  const warningRef = useRef<string | undefined>(undefined);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const unmountedRef = useRef(false);
  const sinkReadyRef = useRef(false);
  const takenAt = media.takenAt;
  const animateIn = useRef(shouldAnimateIn(media)).current;
  // Transition gain multiplies the row volume; 0 until the In transition runs.
  const gainRef = useRef(animateIn ? 0 : 1);
  const leavingRef = useRef(false);
  // Out transition started early so it lands on the last frame (endAction clear).
  const endFadeRef = useRef<Promise<void> | null>(null);
  const stopTransitionRef = useRef<() => void>(() => {});

  function applyVolume() {
    const v = videoRef.current;
    if (v) v.volume = isMirror ? 0 : mediaRef.current.volume * gainRef.current;
  }

  /**
   * Animate the picture and ramp the audio together. Cancels any transition
   * already running (e.g. an In interrupted by a quick clear) and starts
   * from wherever it left off. Resolves when both finish.
   */
  function runTransition(dir: TransitionDirection, t: MediaTransition, durationMs = t.durationMs): Promise<void> {
    stopTransitionRef.current();
    const el = animRef.current;
    const frames = transitionKeyframes(t.style, dir);
    const target = dir === "in" ? 1 : 0;
    if (!el || !frames || durationMs <= 0) {
      gainRef.current = target;
      applyVolume();
      if (el) {
        el.style.opacity = String(target);
        el.style.transform = "";
      }
      return Promise.resolve();
    }
    // An In starts off-stage; an Out starts from wherever the picture is now
    // (implicit first keyframe), so interrupting a half-done In doesn't pop.
    if (dir === "in") el.style.opacity = "";
    const anim = el.animate(dir === "in" ? frames : frames.slice(-1), {
      duration: durationMs,
      easing: transitionEasing(t.style, dir),
      fill: "forwards",
    });
    const from = gainRef.current;
    const started = performance.now();
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // Interval, not rAF: audio must keep ramping even when nothing repaints.
    const ramp = setInterval(() => {
      const elapsed = performance.now() - started;
      gainRef.current = rampGain(from, target, elapsed, durationMs);
      applyVolume();
      if (elapsed >= durationMs) {
        clearInterval(ramp);
        finish();
      }
    }, RAMP_STEP_MS);
    stopTransitionRef.current = () => {
      clearInterval(ramp);
      // Freeze the current pose into inline style before dropping the animation.
      try {
        anim.commitStyles();
      } catch {
        // commitStyles throws if the element isn't rendered; nothing to keep then.
      }
      anim.cancel();
      finish();
    };
    return done;
  }

  function report(status: MediaStatus, error?: string) {
    if (isMirror || leavingRef.current) return;
    const v = videoRef.current;
    const err = error ?? warningRef.current;
    send({
      type: "media_status",
      channel,
      takenAt,
      status,
      currentTime: v && Number.isFinite(v.currentTime) ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : 0,
      ...(err ? { error: err } : {}),
    });
  }

  // AbortError means a pause()/src removal interrupted play(); media errors
  // arrive via the video "error" event, so only report real play() failures.
  function onPlayRejected(err: unknown) {
    if (unmountedRef.current) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      report("error", `autoplay blocked: ${err.message}`);
    } else {
      report("error", `play failed: ${String(err)}`);
    }
  }

  // Mount: source, start position, audio sink, event reporting, ticks.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const plan = initialMountPlan(mediaRef.current);
    let disposed = false;

    if (isMirror) {
      v.setAttribute("muted", "");
      v.muted = true;
    }
    v.src = resolveMediaUrl(mediaRef.current.assetUrl, defaultServerUrl());
    v.addEventListener(
      "loadedmetadata",
      () => {
        if (plan.startAt > 0) v.currentTime = plan.startAt;
      },
      { once: true },
    );

    const onPlaying = () => report("playing");
    const onPause = () => {
      if (!v.ended) report("paused");
    };
    const onEnded = () => report("ended");
    const onWaiting = () => report("loading");
    const onMeta = () => {
      // A Pause->Play that landed before metadata loaded was held back; catch up.
      if (sinkReadyRef.current && !mediaRef.current.paused && v.paused) {
        v.play().catch(onPlayRejected);
      }
      report(v.paused ? "loading" : "playing");
    };
    const onError = () => report("error", v.error?.message || `media error ${v.error?.code ?? ""}`.trim());
    // Start the In once there's a frame to show, so a slow load doesn't fade in a black box.
    const onLoadedData = () => {
      if (animateIn && !leavingRef.current) void runTransition("in", mediaRef.current.transitionIn);
    };
    v.addEventListener("loadeddata", onLoadedData, { once: true });
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onError);
    const onSeeked = () => report(v.paused ? "paused" : "playing");
    v.addEventListener("seeked", onSeeked);

    const tick = setInterval(() => {
      if (!v.paused && !v.ended) report("playing");
      if (isMirror) followPrimary(v);
      checkEndFade(v);
    }, TICK_MS);

    // Route audio before the first play so the aux port gets the first frame of sound.
    void (async () => {
      if (!isMirror) {
        const want = readSinkRequest(location.search);
        if (want.id || want.label) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const pick = pickAudioSink(devices, want);
            warningRef.current = pick.warning;
            const withSink = v as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
            if (pick.deviceId && withSink.setSinkId) await withSink.setSinkId(pick.deviceId);
          } catch (err) {
            warningRef.current = `audio routing failed (${String(err)}) — using default`;
          }
        }
      }
      if (disposed) return;
      sinkReadyRef.current = true;
      if (!mediaRef.current.paused) {
        v.play().catch(onPlayRejected);
      }
    })();

    return () => {
      disposed = true;
      unmountedRef.current = true;
      clearInterval(tick);
      stopTransitionRef.current();
      v.removeEventListener("loadeddata", onLoadedData);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onError);
      v.removeEventListener("seeked", onSeeked);
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    // Mount-once per take; parent keys this component by takenAt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mirror: steer toward the primary's reported position (see mirrorCorrection). */
  function followPrimary(v: HTMLVideoElement) {
    const p = primaryPlayback?.current;
    if (!p || p.takenAt !== takenAt || v.paused || v.seeking || !Number.isFinite(v.currentTime)) {
      if (v.playbackRate !== 1) v.playbackRate = 1;
      return;
    }
    const fix = mirrorCorrection(v.currentTime, p.playback, Date.now() + (serverOffsetMs?.current ?? 0));
    if (fix.action === "seek") {
      v.playbackRate = 1;
      v.currentTime = fix.time;
    } else if (fix.action === "rate") {
      v.playbackRate = fix.rate;
    } else if (v.playbackRate !== 1) {
      v.playbackRate = 1;
    }
  }

  /**
   * Begin the Out early so it finishes on the last frame. The tick is coarse
   * (250 ms), so fade over whatever time is actually left. A pause or a seek
   * back before the end cancels it.
   */
  function checkEndFade(v: HTMLVideoElement) {
    if (leavingRef.current) return;
    const m = mediaRef.current;
    const startAt = endFadeStartsAt(m, v.duration);
    if (startAt === null) return;
    if (endFadeRef.current) {
      if (v.paused && !v.ended) cancelEndFade();
      else if (v.currentTime < startAt - TICK_MS / 1000) cancelEndFade();
      return;
    }
    if (v.paused || v.ended || m.paused) return;
    if (v.currentTime < startAt - TICK_MS / 1000) return;
    const remainingMs = ((v.duration - v.currentTime) / (v.playbackRate || 1)) * 1000;
    endFadeRef.current = runTransition("out", m.transitionOut, Math.max(0, remainingMs));
  }

  function cancelEndFade() {
    endFadeRef.current = null;
    stopTransitionRef.current();
    gainRef.current = 1;
    applyVolume();
    if (animRef.current) {
      animRef.current.style.opacity = "";
      animRef.current.style.transform = "";
    }
  }

  // On the way out: stop reporting, play the Out (or finish the end fade
  // already running), then ask the parent to unmount.
  useEffect(() => {
    if (!leaving || leavingRef.current) return;
    leavingRef.current = true;
    let cancelled = false;
    const out = leaving.cut
      ? Promise.resolve()
      : (endFadeRef.current ?? runTransition("out", mediaRef.current.transitionOut));
    if (leaving.cut) {
      stopTransitionRef.current();
      videoRef.current?.pause();
    }
    void out.then(() => {
      if (!cancelled) onGone(takenAt);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // Converge on declarative transport state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    applyVolume();
    const seekTo = pendingSeek(media, appliedRef.current);
    if (seekTo !== null) {
      appliedRef.current = { takenAt: media.takenAt, seq: media.seek!.seq };
      v.currentTime = seekTo;
    }
    if (media.paused && !v.paused) v.pause();
    if (!media.paused && v.paused && sinkReadyRef.current) {
      v.play().catch(onPlayRejected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.paused, media.seek?.seq, media.volume, isMirror]);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: stageSize.w,
        height: stageSize.h,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: "50% 50%",
        // Same silhouette trick as the template stage: the video area keys solid white.
        filter: matte ? "brightness(0) invert(1)" : undefined,
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <div
        ref={animRef}
        style={{ width: "100%", height: "100%", opacity: animateIn ? 0 : 1, willChange: "opacity, transform" }}
      >
        <video
          ref={videoRef}
          playsInline
          preload="auto"
          disablePictureInPicture
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      </div>
    </div>
  );
}
