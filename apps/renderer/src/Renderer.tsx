import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChannelState, ChannelConfig, StageFeed } from "@overlaysys/core";
import { StageView, serverOffset } from "@overlaysys/stage-widgets";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { WsClient, defaultServerUrl } from "./wsClient";
import { createTemplateLoader } from "./templateLoader";
import { createChannelPlayer, type ChannelPlayer } from "./channelPlayer";
import { createMirrorSubscription } from "./mirrorSubscription";
import { MediaLayer } from "./MediaLayer";
import type { ClientMessage } from "@overlaysys/ws-protocol";

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
  // Template fetches + the take/clear sequencing live in templateLoader.ts and
  // channelPlayer.ts (unit-tested). Created inside the WS effect.
  const playerRef = useRef<ChannelPlayer | null>(null);
  // Which channel we subscribe to and whose state we apply. Defaults to
  // the URL param; retargets when a config with `mirrorOf` arrives. The
  // sequencing (reconnects, late config, changed mirrorOf) lives in
  // mirrorSubscription.ts where it is unit-tested — see that file for the
  // reconnect bug that used to black out the alpha output.
  const subscriptionRef = useRef(createMirrorSubscription(channel));
  const clientRef = useRef<WsClient | null>(null);
  const sendRef = useRef((msg: ClientMessage) => clientRef.current?.send(msg));

  const [status, setStatus] = useState<Status>("connecting");
  const [latestState, setLatestState] = useState<ChannelState | null>(null);
  const [stageFeed, setStageFeed] = useState<{ feed: StageFeed; offsetMs: number } | null>(null);
  const [config, setConfig] = useState<ChannelConfig | null>(null);
  // A stage channel shows only its StageView: its own state's templates and
  // media must not mount (they'd play hidden, media audio included). Mirrored
  // into a ref so the long-lived WS effect's applyState sees the current kind.
  const isStage = config?.kind === "stage";
  const isStageRef = useRef(isStage);
  isStageRef.current = isStage;
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

  // Config can land after state: tear down anything mounted before we knew
  // this was a stage channel.
  useEffect(() => {
    if (isStage) playerRef.current?.reset();
  }, [isStage]);

  const backgroundColor = matte ? "#000" : (config?.background ?? "transparent");

  useEffect(() => {
    const client = new WsClient(defaultServerUrl());
    clientRef.current = client;

    const loader = createTemplateLoader({
      request: (id) => client.send({ type: "get_template", templateId: id }),
    });
    const player = createChannelPlayer<MountedTemplate>({
      loadTemplate: (id) => loader.get(id),
      mount: (tpl, data) => mountTemplate(stageRef.current!, tpl, data),
      sessionStartPending: () => pendingSessionStartRef.current,
      // Session-start cue: dip stage opacity to SONG_FADE_DIP_MIN now (after
      // the previous OUT has finished, so we don't clobber that animation),
      // then ramp back to 1 over SONG_FADE_MS once the new mount is in. The
      // dip is not 0 — the lyric template's IN underneath still shows.
      beforeFreshMount: () => {
        if (!pendingSessionStartRef.current) return false;
        pendingSessionStartRef.current = false;
        if (songFadeOutTimerRef.current) {
          clearTimeout(songFadeOutTimerRef.current);
          songFadeOutTimerRef.current = null;
        }
        setSongFadeTransitionMs(0);
        setSongFadeOpacity(SONG_FADE_DIP_MIN);
        return true;
      },
      afterFreshMount: (tpl, m, sessionStart) => {
        // Blink overlay fires in parallel with playIn so the IN animation
        // continues underneath.
        if (tpl.blinkOnTake?.enabled) m.playBlink(tpl.blinkOnTake).catch(() => {});
        if (sessionStart) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setSongFadeTransitionMs(SONG_FADE_MS);
              setSongFadeOpacity(1);
            });
          });
        }
      },
      onLoadError: (id, err) => {
        console.warn(`[renderer] ${channel}: template ${id} failed to load — stage cleared`, err);
      },
    });
    playerRef.current = player;

    function applyState(state: ChannelState) {
      if (!stageRef.current) return;
      if (isStageRef.current) return;
      void player.apply(state);
    }

    const subscription = subscriptionRef.current;
    const sendAll = (msgs: ReturnType<typeof subscription.hello>) => {
      for (const m of msgs) client.send(m);
    };

    const offStatus = client.onStatus((s) => setStatus(s));
    const offMsg = client.on((msg) => {
      if (msg.type === "hello") {
        // Every hello is a fresh socket (first connect OR a reconnect), so
        // the server knows nothing about us: subscribe to the URL channel,
        // re-subscribe to the mirror source if we already have one, and
        // re-fetch config in case mirrorOf changed while we were away.
        sendAll(subscription.hello());
        // Template requests sent on the old socket died with it.
        loader.resend();
      } else if (msg.type === "channel") {
        const before = subscription.source;
        const msgs = subscription.channelConfig(msg.config);
        if (msg.config.id === channel) setConfig(msg.config);
        sendAll(msgs);
        if (subscription.source !== before) {
          console.log(`[renderer] ${channel}: now mirroring ${subscription.source}`);
        }
      } else if (msg.type === "channel_list") {
        // Broadcast after sync pulls and operator edits. It is the only
        // signal an open window gets when its config lands late (fresh
        // install, cloud pull) — get_channel may have answered not_found.
        const before = subscription.source;
        const msgs = subscription.channelList(msg.configs);
        if (subscription.config) setConfig(subscription.config);
        sendAll(msgs);
        if (subscription.source !== before) {
          console.log(`[renderer] ${channel}: now mirroring ${subscription.source}`);
        }
      } else if (msg.type === "stage_feed" && msg.channel === channel) {
        setStageFeed({ feed: msg.feed, offsetMs: serverOffset(msg.feed.serverNow, Date.now()) });
      } else if (msg.type === "state" && subscription.accepts(msg.channel)) {
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
          // The session went away. Two cases:
          //   - channel is going dark (clear / song_end): state.active is
          //     null or its phase is "out". Apply the stage fade — gradient
          //     and all template layers should disappear together.
          //   - a take replaced the session (operator hit outro or any
          //     graphic over the song): state.active is a new mount in
          //     phase "in". Skip the stage fade — that new mount carries
          //     the visuals. If it's the same template (same-template
          //     outro), the smooth-swap branch above handles continuity;
          //     if it's a different template, the destroy+remount branch
          //     handles the cross-fade.
          const isEnd =
            !msg.state.active || msg.state.active.phase === "out";
          if (isEnd) {
            setSongFadeTransitionMs(SONG_FADE_MS);
            setSongFadeOpacity(0);
            if (songFadeOutTimerRef.current) clearTimeout(songFadeOutTimerRef.current);
            songFadeOutTimerRef.current = setTimeout(() => {
              setSongFadeTransitionMs(0);
              setSongFadeOpacity(1);
              songFadeOutTimerRef.current = null;
            }, SONG_FADE_MS + 50);
          }
        }
        lastHadSongSessionRef.current = hasSession;
        setLatestState(msg.state);
        applyState(msg.state);
      } else if (msg.type === "template") {
        loader.received(msg.template);
      } else if (msg.type === "error") {
        if (msg.code === "not_found" && loader.notFound(msg.message)) {
          // A take's template is gone; the player has cleared the stage.
        } else if (msg.code === "not_found" && msg.message === channel) {
          // No config for this channel yet. Normal for ad-hoc channels;
          // for a channel that is SUPPOSED to mirror (alpha outputs) it
          // means we are painting our own — usually empty — state until a
          // channel_list broadcast brings the config. Say so, because a
          // black output with no log line is undiagnosable.
          console.warn(
            `[renderer] ${channel}: no channel config on server — rendering own state, not a mirror`,
          );
        } else if (msg.code !== "not_found") {
          console.warn("[server error]", msg);
        }
      }
    });

    client.connect();

    return () => {
      offStatus();
      offMsg();
      client.close();
      clientRef.current = null;
      if (songFadeOutTimerRef.current) {
        clearTimeout(songFadeOutTimerRef.current);
        songFadeOutTimerRef.current = null;
      }
      loader.dispose();
      player.reset();
      playerRef.current = null;
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
      {!isStage && (
        <MediaLayer
          media={latestState?.media ?? null}
          clearCut={latestState?.mediaClearCut === true}
          channel={channel}
          isMirror={subscriptionRef.current.source !== channel}
          matte={matte}
          scale={scale}
          send={sendRef.current}
        />
      )}
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
          zIndex: 2,
          opacity: songFadeOpacity,
          transition: songFadeTransitionMs > 0
            ? `opacity ${songFadeTransitionMs}ms ease`
            : "none",
        }}
      />
      {isStage && stageFeed && (
        <StageView feed={stageFeed.feed} offsetMs={stageFeed.offsetMs} connected={status === "open"} send={sendRef.current} />
      )}
      {debug && (
        <DebugOverlay
          status={status}
          state={latestState}
          channel={channel}
          source={subscriptionRef.current.source}
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
      <div>media: {state?.media ? `${state.media.label ?? state.media.rowId} (${state.media.playback.status})` : "—"}</div>
    </div>
  );
}
