import { useEffect, useRef } from "react";
import type { ChannelMedia, MediaStatus } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { defaultServerUrl } from "./wsClient";
import {
  initialMountPlan,
  pendingSeek,
  pickAudioSink,
  readSinkRequest,
  resolveMediaUrl,
  type AppliedSeek,
} from "./mediaSync";

const STAGE_W = 1920;
const STAGE_H = 1080;
const TICK_MS = 250;

type Props = {
  media: ChannelMedia | null;
  /** The channel this window renders (URL param), used in media_status. */
  channel: string;
  /** Mirror windows (e.g. alpha) play muted and never report. */
  isMirror: boolean;
  matte: boolean;
  scale: number;
  send: (msg: ClientMessage) => void;
};

/**
 * Full-frame video slot beneath the template stage. Keyed by takenAt by the
 * parent, so a new take is a fresh element (hard cut) and this component
 * only handles one take's lifetime.
 */
export function MediaLayer(props: Props) {
  if (!props.media) return null;
  return <MediaVideo key={props.media.takenAt} {...props} media={props.media} />;
}

function MediaVideo({ media, channel, isMirror, matte, scale, send }: Props & { media: ChannelMedia }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appliedRef = useRef<AppliedSeek>(initialMountPlan(media).applied);
  const warningRef = useRef<string | undefined>(undefined);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const unmountedRef = useRef(false);
  const takenAt = media.takenAt;

  function report(status: MediaStatus, error?: string) {
    if (isMirror) return;
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
    const onMeta = () => report(v.paused ? "loading" : "playing");
    const onError = () => report("error", v.error?.message || `media error ${v.error?.code ?? ""}`.trim());
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onError);

    const tick = setInterval(() => {
      if (!v.paused && !v.ended) report("playing");
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
      if (!mediaRef.current.paused) {
        v.play().catch(onPlayRejected);
      }
    })();

    return () => {
      disposed = true;
      unmountedRef.current = true;
      clearInterval(tick);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onError);
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    // Mount-once per take; parent keys this component by takenAt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Converge on declarative transport state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = isMirror ? 0 : media.volume;
    const seekTo = pendingSeek(media, appliedRef.current);
    if (seekTo !== null) {
      appliedRef.current = { takenAt: media.takenAt, seq: media.seek!.seq };
      v.currentTime = seekTo;
    }
    if (media.paused && !v.paused) v.pause();
    if (!media.paused && v.paused && v.readyState > 0) {
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
        width: STAGE_W,
        height: STAGE_H,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: "50% 50%",
        // Same silhouette trick as the template stage: the video area keys solid white.
        filter: matte ? "brightness(0) invert(1)" : undefined,
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        disablePictureInPicture
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
      />
    </div>
  );
}
