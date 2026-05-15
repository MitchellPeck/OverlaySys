import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Template, ChannelState, ChannelConfig } from "@overlaysys/core";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { WsClient, defaultServerUrl } from "./wsClient";

type Props = {
  channel: string;
  debug?: boolean;
};

type Status = "connecting" | "open" | "closed";

const STAGE_W = 1920;
const STAGE_H = 1080;

// Session-boundary stage fade duration. Applied on top of (not in place
// of) the template's own IN/OUT animations — for sessions, that's the
// lyric template — to give the operator + audience an extra session-
// scope cue at start and end.
//
// Start: dip stage opacity to SONG_FADE_DIP_MIN (NOT to 0 — that would
// fully mask the lyric template's IN animation running underneath),
// then ramp back to 1. Triggered AFTER the previous template's OUT
// completes so that animation is not clobbered.
//
// End: ramp opacity 1 → 0 over this duration once the session ends,
// then snap back to 1 (transition disabled) so the next non-song take
// starts at full visibility.
const SONG_FADE_MS = 600;
// How dim the stage gets at the bottom of the session-start dip. 0 fully
// masks the template's IN; 1 is no dimming. 0.25 is a deliberate cue
// without hiding the lyric layer.
const SONG_FADE_DIP_MIN = 0.25;

export function Renderer({ channel, debug = false }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
  // Tracks the templateId of the current mount so the takenAt-change handler
  // can distinguish same-template swaps (lyric slide advance, same-template
  // outro) from different-template transitions. Same-template swaps reuse the
  // mount and run its OUT → update → IN animation, so layers outside the
  // template's in/out timelines (e.g. the shadow band on a lyric template)
  // stay in place.
  const lastTemplateIdRef = useRef<string | null>(null);
  const lastTakenAtRef = useRef<number>(0);
  const templateCacheRef = useRef<Map<string, Template>>(new Map());
  const pendingTemplateLoads = useRef<Map<string, ((t: Template) => void)[]>>(
    new Map(),
  );
  // Tracks which mounts have already had playOut() initiated. Without this,
  // consecutive state deliveries (e.g. phase=out followed shortly by a new
  // take) would call playOut twice on the same mount, restarting the
  // animation back to t=0 mid-fade.
  const outStartedRef = useRef<WeakSet<MountedTemplate>>(new WeakSet());
  // The channel whose runtime state we apply. Defaults to the URL param;
  // overridden once a config arrives that specifies `mirrorOf`.
  const sourceChannelRef = useRef<string>(channel);

  const [status, setStatus] = useState<Status>("connecting");
  const [latestState, setLatestState] = useState<ChannelState | null>(null);
  const [config, setConfig] = useState<ChannelConfig | null>(null);
  const [scale, setScale] = useState(1);
  // Session-level fade. opacity drives the stage; transitionMs=0 disables
  // the CSS transition so we can snap back to 1 cleanly after a fade-out
  // without re-triggering a slow ramp on the next non-song take.
  const [songFadeOpacity, setSongFadeOpacity] = useState(1);
  const [songFadeTransitionMs, setSongFadeTransitionMs] = useState(0);
  const lastHadSongSessionRef = useRef(false);
  const songFadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When set, the next takenAt-driven transition is a session start. The
  // transition handler reads + clears this flag and applies a stage fade
  // (snap to 0 after the previous OUT, then ramp back to 1) so the user
  // gets an extra session-boundary cue layered on top of the template's
  // own IN animation.
  const pendingSessionStartRef = useRef(false);

  // Fit-scale the 1920x1080 stage to the viewport.
  useLayoutEffect(() => {
    function update() {
      const sw = window.innerWidth / STAGE_W;
      const sh = window.innerHeight / STAGE_H;
      setScale(Math.min(sw, sh));
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Defensive cleanup: clear any inline `background` left on <html>/<body>
  // by an earlier version of the renderer that mutated those elements
  // directly. HMR doesn't unwind effects from code paths that no longer
  // exist, so a stale chroma-blue bg can otherwise leak through.
  useEffect(() => {
    document.documentElement.style.removeProperty("background");
    document.documentElement.style.removeProperty("background-color");
    document.body.style.removeProperty("background");
    document.body.style.removeProperty("background-color");
  }, []);

  // Compute background from the channel config. Matte mode forces black so
  // the brightness/invert filter has something to silhouette against;
  // otherwise honor the configured custom background (defaults to
  // transparent for OBS alpha-keying). We render this as a full-viewport
  // div in JSX rather than mutating document.body, so it's predictable
  // across page CSS, React Strict Mode, and OBS browser-source quirks.
  const matte = config?.renderMode === "matte";
  const backgroundColor = matte ? "#000" : (config?.background ?? "transparent");

  useEffect(() => {
    const client = new WsClient(defaultServerUrl());

    function ensureTemplate(id: string): Promise<Template> {
      const cached = templateCacheRef.current.get(id);
      if (cached) return Promise.resolve(cached);
      return new Promise((resolve) => {
        const list = pendingTemplateLoads.current.get(id) ?? [];
        list.push(resolve);
        pendingTemplateLoads.current.set(id, list);
        client.send({ type: "get_template", templateId: id });
      });
    }

    function triggerOut(m: MountedTemplate): Promise<void> {
      if (outStartedRef.current.has(m)) return Promise.resolve();
      outStartedRef.current.add(m);
      return m.playOut();
    }

    async function applyState(state: ChannelState) {
      if (!stageRef.current) return;

      if (!state.active) {
        if (mountedRef.current) {
          const m = mountedRef.current;
          mountedRef.current = null;
          lastTemplateIdRef.current = null;
          await triggerOut(m).catch(() => {});
          m.destroy();
        }
        return;
      }

      const { templateId, data, phase, takenAt } = state.active;

      if (takenAt !== lastTakenAtRef.current) {
        lastTakenAtRef.current = takenAt;

        if (phase === "out") return;

        const myTakenAt = takenAt;
        const previous = mountedRef.current;

        // Same-template swap: lyric slide advance, or an outro/intro that
        // happens to reuse the same template. Reuse the mount, run its OUT
        // → data swap → IN. Only layers the template's in/out timelines
        // target will animate (e.g. on a lyric template the text element
        // fades while the shadow band stays put). Pre-condition: a session
        // start is NOT pending (those want the full mount cycle so the
        // session-boundary fade lands correctly).
        if (
          previous &&
          lastTemplateIdRef.current === templateId &&
          !pendingSessionStartRef.current
        ) {
          // Direct playOut (not triggerOut): the WeakSet guard would suppress
          // the second-and-subsequent playOut calls on the same mount, which
          // is exactly what we DON'T want here.
          await previous.playOut().catch(() => {});
          if (myTakenAt !== lastTakenAtRef.current) return;
          previous.update(data);
          await previous.playIn().catch(() => {});
          return;
        }

        // Different-template (or fresh) transition: play the previous mount's
        // out animation to completion, destroy it, then mount the new template
        // and play its in animation. Total transition time is out-duration +
        // in-duration. If a newer take arrives during the out, the takenAt
        // guard below abandons this flow so the newer take's flow can take over.
        mountedRef.current = null;
        lastTemplateIdRef.current = null;

        const tpl = await ensureTemplate(templateId);

        if (previous) {
          await triggerOut(previous).catch(() => {});
          previous.destroy();
        }

        if (myTakenAt !== lastTakenAtRef.current) return;

        // Session-start cue: dip stage opacity to SONG_FADE_DIP_MIN NOW
        // (after previous's OUT has finished, so we don't clobber that
        // animation), then ramp back to 1 over SONG_FADE_MS. The dip is
        // not 0 — we keep the stage partially visible so the lyric
        // template's IN animation underneath still shows through.
        const sessionStart = pendingSessionStartRef.current;
        if (sessionStart) {
          pendingSessionStartRef.current = false;
          if (songFadeOutTimerRef.current) {
            clearTimeout(songFadeOutTimerRef.current);
            songFadeOutTimerRef.current = null;
          }
          setSongFadeTransitionMs(0);
          setSongFadeOpacity(SONG_FADE_DIP_MIN);
        }

        const m = mountTemplate(stageRef.current, tpl, data);
        mountedRef.current = m;
        lastTemplateIdRef.current = templateId;
        m.playIn().catch(() => {});
        // Blink overlay fires in parallel with playIn so the IN animation
        // continues underneath. Catch to keep the takenAt flow alive if the
        // blink tween errors for any reason.
        if (tpl.blinkOnTake?.enabled) {
          m.playBlink(tpl.blinkOnTake).catch(() => {});
        }

        if (sessionStart) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setSongFadeTransitionMs(SONG_FADE_MS);
              setSongFadeOpacity(1);
            });
          });
        }
        return;
      }

      if (phase === "out" && mountedRef.current) {
        const m = mountedRef.current;
        mountedRef.current = null;
        lastTemplateIdRef.current = null;
        triggerOut(m).finally(() => m.destroy());
        return;
      }

      if (mountedRef.current) {
        mountedRef.current.update(data);
      }
    }

    const offStatus = client.onStatus((s) => setStatus(s));
    const offMsg = client.on((msg) => {
      if (msg.type === "hello") {
        // Always subscribe to the URL channel first so we get state without
        // waiting on config (which may not exist for ad-hoc channels).
        client.send({ type: "subscribe", channel, role: "renderer" });
        // Fetch config to learn renderMode + any mirror source.
        client.send({ type: "get_channel", channelId: channel });
      } else if (msg.type === "channel" && msg.config.id === channel) {
        setConfig(msg.config);
        // If the config redirects us to mirror another channel, subscribe
        // to that source and update the active source ref so subsequent
        // state messages from the URL channel are ignored.
        const src = msg.config.mirrorOf;
        if (src && src !== sourceChannelRef.current) {
          sourceChannelRef.current = src;
          client.send({ type: "subscribe", channel: src, role: "renderer" });
        }
      } else if (msg.type === "state" && msg.channel === sourceChannelRef.current) {
        // Session boundary fades: a stage-wide opacity overlay applied on
        // top of whatever the template's own IN/OUT does, as a deliberate
        // session-boundary cue.
        const hadSession = lastHadSongSessionRef.current;
        const hasSession = !!msg.state.songSession;
        if (hasSession && !hadSession) {
          // Session start: arm the transition handler to snap the stage
          // opacity to 0 AFTER the previous template's OUT completes, then
          // fade back to 1. Snapping here would clobber the previous's OUT
          // animation, so we defer to applyState's transition branch.
          pendingSessionStartRef.current = true;
        }
        if (!hasSession && hadSession) {
          // Fade out: transition opacity to 0, then once it lands snap
          // back to 1 (no transition) so the next non-song take starts
          // at full opacity instantly.
          setSongFadeTransitionMs(SONG_FADE_MS);
          setSongFadeOpacity(0);
          if (songFadeOutTimerRef.current) clearTimeout(songFadeOutTimerRef.current);
          songFadeOutTimerRef.current = setTimeout(() => {
            setSongFadeTransitionMs(0);
            setSongFadeOpacity(1);
            songFadeOutTimerRef.current = null;
          }, SONG_FADE_MS + 50);
        }
        lastHadSongSessionRef.current = hasSession;
        setLatestState(msg.state);
        applyState(msg.state);
      } else if (msg.type === "template") {
        templateCacheRef.current.set(msg.template.id, msg.template);
        const waiting = pendingTemplateLoads.current.get(msg.template.id) ?? [];
        for (const r of waiting) r(msg.template);
        pendingTemplateLoads.current.delete(msg.template.id);
      } else if (msg.type === "error") {
        // not_found for get_channel just means the channel has no config —
        // that's a normal case for ad-hoc channels, no action needed.
        if (msg.code !== "not_found") console.warn("[server error]", msg);
      }
    });

    client.connect();

    return () => {
      offStatus();
      offMsg();
      client.close();
      if (songFadeOutTimerRef.current) {
        clearTimeout(songFadeOutTimerRef.current);
        songFadeOutTimerRef.current = null;
      }
      if (mountedRef.current) {
        mountedRef.current.destroy();
        mountedRef.current = null;
      }
    };
  }, [channel]);

  return (
    <>
      {/* Full-viewport background. Sits behind the stage. Transparent by
          default (so OBS alpha-keys correctly), solid color or matte black
          when the channel is configured for chroma key / fill+key. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: backgroundColor,
          zIndex: 0,
        }}
      />
      <div
        ref={stageRef}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
          // Matte: brightness(0) drives every pixel's color to black, then
          // invert(1) flips it to white. Transparent pixels remain
          // transparent and reveal the bg's black background. Result:
          // white silhouette on black, suitable for hardware fill+key.
          filter: matte ? "brightness(0) invert(1)" : undefined,
          zIndex: 1,
          opacity: songFadeOpacity,
          transition: songFadeTransitionMs > 0
            ? `opacity ${songFadeTransitionMs}ms ease`
            : "none",
        }}
      />
      {debug && (
        <DebugOverlay
          status={status}
          state={latestState}
          channel={channel}
          source={sourceChannelRef.current}
          scale={scale}
          config={config}
        />
      )}
    </>
  );
}

function DebugOverlay({
  status,
  state,
  channel,
  source,
  scale,
  config,
}: {
  status: Status;
  state: ChannelState | null;
  channel: string;
  source: string;
  scale: number;
  config: ChannelConfig | null;
}) {
  const dot = { connecting: "🟡", open: "🟢", closed: "🔴" }[status];
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        background: "rgba(0,0,0,0.65)",
        color: "white",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "ui-monospace, monospace",
        pointerEvents: "none",
      }}
    >
      <div>{dot} ws: {status}</div>
      <div>channel: {channel}</div>
      {source !== channel && <div>mirrors: {source}</div>}
      <div>mode: {config?.renderMode ?? "normal"}</div>
      <div>scale: {(scale * 100).toFixed(0)}%</div>
      <div>active: {state?.active ? `${state.active.templateId} (${state.active.phase})` : "—"}</div>
    </div>
  );
}
