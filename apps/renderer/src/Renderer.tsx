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

// Session-end stage fade. Used only on session end as a deliberate
// "screen goes dark" boundary cue. Session START used to fade in too,
// but that was a workaround for the (now-fixed) songSession path that
// didn't remount the template on start — with forceMount in place the
// template's own playIn handles the visual transition, and the fade-in
// would just conflict with it (snapping the stage opaque-to-clear while
// the previous template is still mid-OUT and the new one is mid-IN).
const SONG_FADE_MS = 600;

export function Renderer({ channel, debug = false }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
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
          await triggerOut(m).catch(() => {});
          m.destroy();
        }
        return;
      }

      const { templateId, data, phase, takenAt } = state.active;

      if (takenAt !== lastTakenAtRef.current) {
        lastTakenAtRef.current = takenAt;

        if (phase === "out") return;

        // Sequential transition: play the previous mount's out animation
        // to completion, destroy it, then mount the new template and play
        // its in animation. Total transition time is out-duration +
        // in-duration. If a newer take arrives during the out (operator
        // pressing space rapidly), the takenAt guard below abandons this
        // flow so the newer take's flow can take over.
        const myTakenAt = takenAt;
        const previous = mountedRef.current;
        mountedRef.current = null;

        const tpl = await ensureTemplate(templateId);

        if (previous) {
          await triggerOut(previous).catch(() => {});
          previous.destroy();
        }

        if (myTakenAt !== lastTakenAtRef.current) return;

        const m = mountTemplate(stageRef.current, tpl, data);
        mountedRef.current = m;
        m.playIn().catch(() => {});
        return;
      }

      if (phase === "out" && mountedRef.current) {
        const m = mountedRef.current;
        mountedRef.current = null;
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
        // Session-end stage fade. Session start is handled by the template's
        // own IN animation (forceMount on session start in songSession.ts
        // guarantees a fresh mount, so the renderer plays the previous
        // template's OUT and the new one's IN). A stage fade-in here would
        // fight that transition.
        const hadSession = lastHadSongSessionRef.current;
        const hasSession = !!msg.state.songSession;
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
