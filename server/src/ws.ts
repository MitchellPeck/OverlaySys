import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";
import {
  isBuiltInStageLayoutId,
  resolveArrangement,
  resolveIntroTake,
  resolveOutroTake,
  resolveSongChannel,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as templates from "./templates";
import * as shows from "./shows";
import * as songs from "./songs";
import * as hotcards from "./hotcards";
import * as projects from "./projects";
import * as songSession from "./songSession";
import { handleScriptureMessage } from "./scriptureHandlers";
import * as channelConfigs from "./channelConfigs";
import * as sttListener from "./sttListener";
import * as sttSpawner from "./sttSpawner";
import * as sttInstaller from "./sttInstaller";
import { scheduleSync } from "./cloudSync";
import * as storage from "./storage";
import { registerSender, broadcast } from "./broadcast";
import * as stageFeedHub from "./stageFeedHub";
import * as stageState from "./stageState";
import { stageFollowedChannels } from "./stageFollowed";
import * as stageLayouts from "./stageLayouts";
import * as timers from "./timers";
import * as pcoLiveSync from "./pco/pcoLiveSync";
import { isLocalAddress, remoteAddressOf, securityContext } from "./security";
import * as outputs from "./outputs";
import { SERVER_VERSION } from "./version";

/**
 * Requests that don't need to wait their turn behind this socket's earlier
 * messages: heartbeats, and slow lookups whose answers don't depend on order
 * (a PCO poll or a capture-device probe must not hold up a take).
 */
const UNORDERED_TYPES = new Set<string>([
  "ping",
  "pco_live_start",
  "stt_check_presence",
  "stt_list_models",
  "stt_enumerate_capture_devices",
]);

/**
 * Operations that install software, write files from a URL, or set the
 * shell command the STT spawner runs. They act on the server machine, so
 * only a connection from that machine may send them.
 */
const LOCAL_ONLY_TYPES = new Set<string>([
  "stt_install_binary",
  "stt_uninstall_binary",
  "stt_download_model",
  "stt_delete_model",
  "stt_cancel_install",
  "stt_spawner_save_config",
]);

// ───── Module-scope subscriptions ────────────────────────────────────────────
// These broadcast to all connected clients whenever STT state changes.

// STT suggestions arrive several times a second while a song is live. They
// go only to clients that opted in with stt_match_subscribe (operator
// consoles, Companion) — never to renderers or stage displays.
const sttMatchSubscribers = new Set<(msg: ServerMessage) => void>();
songSession.onMatch((channel, result, hypothesis, meta) => {
  const msg: ServerMessage = {
    type: "stt_match",
    channel,
    suggestedSlide: result
      ? { sectionIdx: result.sectionIdx, slideIdx: result.slideIdx }
      : null,
    confidence: result?.confidence ?? 0,
    hypothesis,
    strategy: result?.strategy ?? null,
    matchedTokens: result?.matchedTokens ?? [],
    coverage: result?.coverage ?? 0,
    latencyMs: meta.latencyMs,
    isFinal: meta.isFinal,
  };
  for (const send of sttMatchSubscribers) {
    try {
      send(msg);
    } catch {
      // one bad socket must not starve the rest
    }
  }
});

// Any channel change can alter what a confidence monitor shows (a timer on
// another channel, the followed channel's take), so rebuild every feed.
channels.onAnyChange(() => stageFeedHub.invalidateAll());

// Cueing a row to preview must not switch the pastor's notes; only rows that
// actually go to air do.
channels.onLiveRow((channel, source) => {
  if (channel === "preview") return;
  // Loading a different show ends PCO Live sync for the old one.
  const syncShowId = pcoLiveSync.getLiveSyncShowId();
  if (syncShowId !== null && source.showId !== syncShowId) pcoLiveSync.stopLiveSync();
  // Only takes a stage monitor can see move the pastor's notes.
  const followed = stageFollowedChannels();
  void followed
    .then((set) => (set.has(channel) ? stageState.onRowTaken(source) : undefined))
    .catch((err) => console.warn("[stageState] onRowTaken failed", err));
  void timers.onRowTaken(channel, source, undefined, followed).catch((err) => console.warn("[timers] onRowTaken failed", err));
});
timers.subscribeTimers(() => {
  stageFeedHub.invalidateAll();
  broadcast(timers.timersStateMessage());
});
pcoLiveSync.subscribeLiveSync(() => {
  stageFeedHub.invalidateAll();
  broadcast(pcoLiveSync.liveSyncStateMessage());
});
stageState.subscribeStageState(() => {
  stageFeedHub.invalidateAll();
  void stageState.stageStateMessage().then(broadcast, (err) => console.warn("[stageState] broadcast failed", err));
});

sttListener.subscribe((listeners) => {
  broadcast({ type: "stt_listener_state", listeners });
});

// Channel-select meter updates (~10/s) go only to clients that asked for
// them (the STT settings page), never to Companion or renderers.
const levelSubscribers = new Set<(msg: ServerMessage) => void>();
sttSpawner.subscribeLevels((levels, channels) => {
  for (const send of levelSubscribers) send({ type: "stt_levels", levels, channels });
});

sttSpawner.subscribe((status) => {
  broadcast({ type: "stt_spawner_status", status });
});

// Fan install / download progress out to every connected client so multiple
// operator windows watching the STT page all see the same progress bar.
//
// When a job hits a terminal state (done / error / cancelled) we ALSO
// re-check presence and the model list and broadcast both. This is what
// makes "the binary banner flips to green the moment brew install
// finishes" work without the operator UI having to subscribe and round-
// trip a presence_check itself — the server is authoritative here, and
// every connected window picks up the update on the same tick.
sttInstaller.subscribeInstall((progress) => {
  broadcast({ type: "stt_install_progress", progress });
  if (
    progress.state !== "done" &&
    progress.state !== "error" &&
    progress.state !== "cancelled"
  ) {
    return;
  }
  void (async () => {
    try {
      const cfg = await storage.loadSttConfig();
      const [presence, models] = await Promise.all([
        sttInstaller.checkPresence(cfg.modelPath),
        sttInstaller.listModels(),
      ]);
      broadcast({ type: "stt_presence", presence });
      broadcast({
        type: "stt_models",
        models,
        modelsDir: sttInstaller.getModelsDir(),
      });
    } catch (err) {
      // Best-effort. Clients can still recover by clicking elsewhere on the
      // page (which triggers a stt_check_presence on most navigations) or
      // by sending an explicit refresh.
      void err;
    }
  })();
});

outputs.subscribeOutputs(() => broadcast(outputsStateMessage()));

export function outputsStateMessage(): ServerMessage {
  return { type: "outputs_state", outputs: outputs.outputsSnapshot() };
}

// One renderer per channel reports media playback: with two windows on the
// same channel (OBS + a browser preview) both reported, and their slightly
// different clocks made the operator's transport jitter. The first socket to
// report owns the channel until it closes.
const liveConnections = new Set<string>();
const mediaReporters = new Map<string, string>();

/** Should a media_status from `connId` for `channel` be applied? */
export function claimMediaReporter(channel: string, connId: string): boolean {
  const owner = mediaReporters.get(channel);
  if (owner && owner !== connId && liveConnections.has(owner)) return false;
  mediaReporters.set(channel, connId);
  return true;
}

stageFeedHub.subscribePreviews(() =>
  broadcast({ type: "stage_layout_previews", previews: stageFeedHub.listPreviews() }),
);

export interface ConnectionHandle {
  /** Resolves once every message received so far has been handled. */
  drain(): Promise<void>;
}

/** Every channel a panic clear should reach: configured (non-mirror) and any with live state. */
export async function clearAllChannels(cutVideo: boolean): Promise<string[]> {
  const configs = await channelConfigs.listChannelConfigs();
  const mirrors = new Set(configs.filter((c) => c.mirrorOf).map((c) => c.id));
  const ids = new Set<string>(configs.filter((c) => !c.mirrorOf).map((c) => c.id));
  for (const st of channels.allStates()) if (!mirrors.has(st.channel)) ids.add(st.channel);
  for (const id of ids) {
    channels.clear(id);
    if (cutVideo) channels.mediaClear(id, { cut: true });
  }
  return [...ids];
}

export function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  log: FastifyBaseLogger,
): ConnectionHandle {
  // No socket = an in-process connection (tests); otherwise loopback or one
  // of this machine's own addresses.
  const peer = remoteAddressOf(req);
  const isLocalPeer = peer === undefined || isLocalAddress(peer, securityContext().ownAddresses);
  const subscriptions = new Map<string, () => void>();
  const connId = randomUUID();
  const previewSeq = new Map<string, number>();
  let closed = false;
  let registeredAudioSourceId: string | null = null;

  function send(msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  }
  const offBroadcast = registerSender(send);

  liveConnections.add(connId);
  send({ type: "hello", protocolVersion: PROTOCOL_VERSION, serverTime: Date.now(), serverVersion: SERVER_VERSION });
  send(outputsStateMessage());
  // Snapshot so a reconnecting designer learns which preview it (or another socket) holds.
  send({ type: "stage_layout_previews", previews: stageFeedHub.listPreviews() });
  void stageState
    .stageStateMessage()
    .then(send, () => {})
    .then(() => {
      send(timers.timersStateMessage());
      send(pcoLiveSync.liveSyncStateMessage());
    });

  // Messages from one socket are handled strictly in arrival order: each
  // handler (most await disk) runs after the previous one settles. Without
  // this, a quick Stream Deck "song take" + "next slide" could apply the
  // advance before the take had loaded its show. Only slow, order-free
  // requests (and ping, so a busy socket still answers heartbeats) bypass
  // the queue.
  let chain: Promise<void> = Promise.resolve();
  ws.on("message", (raw) => {
    let parsed: ClientMessage;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch (err) {
      send({ type: "error", code: "bad_message", message: String(err) });
      return;
    }
    outputs.touchOutput(connId);
    if (UNORDERED_TYPES.has(parsed.type)) {
      void handleMessage(parsed);
      return;
    }
    chain = chain.then(() => handleMessage(parsed));
  });

  async function handleMessage(parsed: ClientMessage): Promise<void> {
    if (
      !isLocalPeer &&
      (LOCAL_ONLY_TYPES.has(parsed.type) || (parsed.type === "stt_spawner_start" && parsed.config))
    ) {
      send({
        type: "error",
        code: "forbidden_remote",
        message: `${parsed.type} is only allowed from the server machine`,
      });
      return;
    }

    try {
      switch (parsed.type) {
        case "subscribe": {
          // A renderer window on its own channel is an output of it; a
          // mirror's subscription to its source is not.
          if (parsed.role === "renderer" && !parsed.mirrorFor) {
            outputs.addOutput(connId, parsed.channel, parsed.label ?? "renderer");
          }
          if (subscriptions.has(parsed.channel)) {
            // Already live on this socket — don't double-subscribe, but
            // do answer with the current state. A renderer that re-sends
            // its subscriptions (mirror retarget, defensive resync) must
            // be able to catch up; a silent no-op left it painting
            // whatever it last saw.
            send({
              type: "state",
              channel: parsed.channel,
              state: channels.getState(parsed.channel),
            });
            void stageFeedHub.computeFeed(parsed.channel).then(
              (feed) => {
                if (feed) send({ type: "stage_feed", channel: parsed.channel, feed });
              },
              (err) => console.warn("[stageFeedHub] resync failed", err),
            );
            break;
          }
          const unsub = channels.subscribe(parsed.channel, (state) => {
            send({ type: "state", channel: state.channel, state });
          });
          // Renderers are the source of playback reports and never read the
          // 4 Hz ticks; only operator-role subscribers get them.
          // Mirrors do read them: their video follows the primary's clock.
          const unsubPlayback =
            parsed.role === "renderer" && !parsed.mirrorFor
              ? () => {}
              : channels.subscribeMediaPlayback(parsed.channel, (e) => {
                  send({ type: "media_playback", ...e });
                });
          const unsubStage = stageFeedHub.subscribeStage(parsed.channel, (channel, feed) => {
            send({ type: "stage_feed", channel, feed });
          });
          subscriptions.set(parsed.channel, () => {
            unsub();
            unsubPlayback();
            unsubStage();
          });
          break;
        }
        case "take": {
          channels.take(parsed.channel, parsed.templateId, parsed.data, undefined, undefined, parsed.source);
          break;
        }
        case "clear": {
          channels.clear(parsed.channel);
          break;
        }
        case "clear_all_channels": {
          await clearAllChannels(parsed.cutVideo);
          send({ type: "ack", op: "clear_all_channels" });
          break;
        }
        case "update": {
          channels.update(parsed.channel, parsed.data);
          break;
        }
        case "cue": {
          channels.take(parsed.channel, parsed.templateId, parsed.data, undefined, undefined, parsed.source);
          break;
        }
        case "take_pvw_to_pgm": {
          channels.takePvwToPgm(parsed.fromChannel, parsed.toChannel);
          break;
        }
        case "media_take": {
          channels.mediaTake(parsed.channel, {
            rowId: parsed.rowId,
            assetUrl: parsed.assetUrl,
            ...(parsed.label !== undefined ? { label: parsed.label } : {}),
            volume: parsed.volume,
            endAction: parsed.endAction,
            ...(parsed.transitionIn ? { transitionIn: parsed.transitionIn } : {}),
            ...(parsed.transitionOut ? { transitionOut: parsed.transitionOut } : {}),
            ...(parsed.showId ? { showId: parsed.showId } : {}),
          });
          break;
        }
        case "media_clear": {
          channels.mediaClear(parsed.channel, { cut: parsed.cut === true });
          break;
        }
        case "media_control": {
          channels.mediaControl(parsed.channel, parsed.takenAt, parsed.action, parsed.time);
          break;
        }
        case "media_status": {
          if (!claimMediaReporter(parsed.channel, connId)) break;
          channels.mediaStatus(parsed.channel, parsed.takenAt, {
            status: parsed.status,
            currentTime: parsed.currentTime,
            duration: parsed.duration,
            ...(parsed.error !== undefined ? { error: parsed.error } : {}),
          });
          break;
        }
        case "list_templates": {
          const list = await templates.listTemplateMetas();
          send({ type: "template_list", templates: list });
          break;
        }
        case "get_template": {
          const tpl = await templates.getTemplate(parsed.templateId);
          if (!tpl) send({ type: "error", code: "not_found", message: parsed.templateId });
          else send({ type: "template", template: tpl });
          break;
        }
        case "save_template": {
          const saved = await templates.saveTemplate(parsed.template);
          send({ type: "ack", op: "save_template", id: saved.id });
          // Notify everyone (the editor itself, plus the operator's template
          // list). Broadcast the stamped record so clients see updatedAt.
          const list = await templates.listTemplateMetas();
          broadcast({ type: "template_list", templates: list });
          broadcast({ type: "template", template: saved });
          stageFeedHub.invalidateAll();
          scheduleSync();
          break;
        }
        case "delete_template": {
          const ok = await templates.deleteTemplate(parsed.templateId);
          send({ type: "ack", op: "delete_template", id: parsed.templateId });
          if (ok) {
            const list = await templates.listTemplateMetas();
            broadcast({ type: "template_list", templates: list });
            stageFeedHub.invalidateAll();
            scheduleSync();
          }
          break;
        }
        case "duplicate_template": {
          const copy = await templates.duplicateTemplate(parsed.templateId);
          if (!copy) {
            send({ type: "error", code: "not_found", message: parsed.templateId });
            break;
          }
          send({ type: "ack", op: "duplicate_template", id: copy.id });
          const list = await templates.listTemplateMetas();
          broadcast({ type: "template_list", templates: list });
          broadcast({ type: "template", template: copy });
          break;
        }
        case "list_stage_layouts": {
          send({ type: "stage_layout_list", layouts: await stageLayouts.listStageLayoutMetas() });
          break;
        }
        case "get_stage_layout": {
          const layout = await stageLayouts.getStageLayout(parsed.layoutId);
          if (!layout) send({ type: "error", code: "not_found", message: parsed.layoutId });
          else send({ type: "stage_layout", layout });
          break;
        }
        case "save_stage_layout": {
          let saved;
          try {
            saved = await stageLayouts.saveStageLayout(parsed.layout);
          } catch (err) {
            if (err instanceof stageLayouts.ReadOnlyLayoutError) {
              send({ type: "error", code: "read_only", message: parsed.layout.id });
              break;
            }
            throw err;
          }
          send({ type: "ack", op: "save_stage_layout", id: saved.id });
          // Clears previews of the saved layout; that invalidates only if it
          // removed one, so the single guaranteed invalidate is below.
          stageFeedHub.clearPreviewsForLayout(saved.id);
          broadcast({ type: "stage_layout_list", layouts: await stageLayouts.listStageLayoutMetas() });
          broadcast({ type: "stage_layout", layout: saved });
          stageFeedHub.invalidateAll();
          scheduleSync();
          break;
        }
        case "delete_stage_layout": {
          const ok = await stageLayouts.deleteStageLayout(parsed.layoutId);
          if (!ok && isBuiltInStageLayoutId(parsed.layoutId)) {
            send({ type: "error", code: "read_only", message: parsed.layoutId });
            break;
          }
          send({ type: "ack", op: "delete_stage_layout", id: parsed.layoutId });
          if (ok) {
            broadcast({ type: "stage_layout_list", layouts: await stageLayouts.listStageLayoutMetas() });
            stageFeedHub.invalidateAll();
            scheduleSync();
          }
          break;
        }
        case "duplicate_stage_layout": {
          const copy = await stageLayouts.duplicateStageLayout(parsed.layoutId);
          if (!copy) {
            send({ type: "error", code: "not_found", message: parsed.layoutId });
            break;
          }
          send({ type: "ack", op: "duplicate_stage_layout", id: copy.id });
          broadcast({ type: "stage_layout_list", layouts: await stageLayouts.listStageLayoutMetas() });
          broadcast({ type: "stage_layout", layout: copy });
          stageFeedHub.invalidateAll();
          scheduleSync();
          break;
        }
        case "stage_layout_preview": {
          // Per-channel sequence, bumped synchronously before any await, so a
          // slow channel lookup can't apply an older "on" after a newer
          // on/off from this socket (or after the socket closed).
          const seq = (previewSeq.get(parsed.channel) ?? 0) + 1;
          previewSeq.set(parsed.channel, seq);
          if (parsed.layout === null) {
            stageFeedHub.clearPreview(parsed.channel, connId);
            break;
          }
          const cfg = await channelConfigs.getChannelConfig(parsed.channel);
          if (closed || previewSeq.get(parsed.channel) !== seq) break;
          if (cfg?.kind !== "stage") {
            send({ type: "error", code: "not_stage_channel", message: parsed.channel });
          } else stageFeedHub.setPreview(parsed.channel, parsed.layout, connId);
          break;
        }
        case "list_shows": {
          const list = await shows.listShowMetas();
          send({ type: "show_list", shows: list });
          break;
        }
        case "get_show": {
          const s = await shows.getShow(parsed.showId);
          if (!s) send({ type: "error", code: "not_found", message: parsed.showId });
          else send({ type: "show", show: s });
          break;
        }
        case "save_show": {
          const saved = await shows.saveShow(parsed.show);
          send({ type: "ack", op: "save_show", id: saved.id });
          broadcast({ type: "show", show: saved });
          const list = await shows.listShowMetas();
          broadcast({ type: "show_list", shows: list });
          await stageState.reconcileActiveNotes();
          stageFeedHub.invalidateAll();
          broadcast(await stageState.stageStateMessage());
          scheduleSync();
          break;
        }
        case "delete_show": {
          const ok = await shows.deleteShow(parsed.showId);
          send({ type: "ack", op: "delete_show", id: parsed.showId });
          if (ok) {
            const list = await shows.listShowMetas();
            broadcast({ type: "show_list", shows: list });
            await stageState.reconcileActiveNotes();
            stageFeedHub.invalidateAll();
            broadcast(await stageState.stageStateMessage());
            scheduleSync();
          }
          break;
        }
        case "duplicate_show": {
          const copy = await shows.duplicateShow(parsed.showId);
          if (!copy) {
            send({ type: "error", code: "not_found", message: parsed.showId });
            break;
          }
          send({ type: "ack", op: "duplicate_show", id: copy.id });
          const list = await shows.listShowMetas();
          broadcast({ type: "show_list", shows: list });
          broadcast({ type: "show", show: copy });
          break;
        }
        case "list_projects": {
          const list = await projects.listProjects();
          send({ type: "project_list", projects: list });
          break;
        }
        case "save_project": {
          const saved = await projects.saveProject(parsed.project);
          send({ type: "ack", op: "save_project", id: saved.id });
          broadcast({ type: "project", project: saved });
          const list = await projects.listProjects();
          broadcast({ type: "project_list", projects: list });
          scheduleSync();
          break;
        }
        case "delete_project": {
          const ok = await projects.deleteProject(parsed.projectId);
          send({ type: "ack", op: "delete_project", id: parsed.projectId });
          if (ok) {
            const list = await projects.listProjects();
            broadcast({ type: "project_list", projects: list });
            scheduleSync();
          }
          break;
        }
        case "list_hotcards": {
          const list = await hotcards.listHotcardMetas();
          send({ type: "hotcard_list", hotcards: list });
          break;
        }
        case "get_hotcard": {
          const h = await hotcards.getHotcard(parsed.hotcardId);
          if (!h) send({ type: "error", code: "not_found", message: parsed.hotcardId });
          else send({ type: "hotcard", hotcard: h });
          break;
        }
        case "save_hotcard": {
          const saved = await hotcards.saveHotcard(parsed.hotcard);
          send({ type: "ack", op: "save_hotcard", id: saved.id });
          broadcast({ type: "hotcard", hotcard: saved });
          const list = await hotcards.listHotcardMetas();
          broadcast({ type: "hotcard_list", hotcards: list });
          scheduleSync();
          break;
        }
        case "delete_hotcard": {
          const ok = await hotcards.deleteHotcard(parsed.hotcardId);
          send({ type: "ack", op: "delete_hotcard", id: parsed.hotcardId });
          if (ok) {
            const list = await hotcards.listHotcardMetas();
            broadcast({ type: "hotcard_list", hotcards: list });
            scheduleSync();
          }
          break;
        }
        case "duplicate_hotcard": {
          const copy = await hotcards.duplicateHotcard(parsed.hotcardId);
          if (!copy) {
            send({ type: "error", code: "not_found", message: parsed.hotcardId });
            break;
          }
          send({ type: "ack", op: "duplicate_hotcard", id: copy.id });
          const list = await hotcards.listHotcardMetas();
          broadcast({ type: "hotcard_list", hotcards: list });
          broadcast({ type: "hotcard", hotcard: copy });
          break;
        }
        case "list_songs": {
          const list = await songs.listSongMetas();
          send({ type: "song_list", songs: list });
          break;
        }
        case "get_song": {
          const s = await songs.getSong(parsed.songId);
          if (!s) send({ type: "error", code: "not_found", message: parsed.songId });
          else send({ type: "song", song: s });
          break;
        }
        case "notes_select":
          await stageState.dispatchStage({ type: "select", showId: parsed.showId, notesId: parsed.notesId });
          break;
        case "notes_point":
          if ((parsed.delta === undefined) === (parsed.index === undefined)) break;
          await stageState.dispatchStage(
            parsed.index !== undefined ? { type: "point", index: parsed.index } : { type: "point", delta: parsed.delta! },
          );
          break;
        case "notes_scroll":
          await stageState.dispatchStage({ type: "scroll", delta: parsed.delta });
          break;
        case "notes_reset":
          await stageState.dispatchStage({ type: "reset" });
          break;
        case "notes_overflow":
          await stageState.dispatchStage({ type: "overflow", direction: parsed.direction, atPoint: parsed.atPoint });
          break;
        case "stage_message":
          await stageState.dispatchStage({ type: "message", text: parsed.text, now: Date.now() });
          break;
        case "stage_message_clear":
          await stageState.dispatchStage({ type: "messageClear" });
          break;
        case "timer_create": {
          const id = timers.createTimer({
            label: parsed.label,
            mode: parsed.mode,
            durationMs: parsed.durationMs,
            overtime: parsed.overtime,
          });
          if (parsed.start) timers.dispatchTimers({ type: "start", id });
          send({ type: "ack", op: "timer_create", id });
          break;
        }
        case "timer_start":
          timers.dispatchTimers({ type: "start", id: parsed.id });
          break;
        case "timer_pause":
          timers.dispatchTimers({ type: "pause", id: parsed.id });
          break;
        case "timer_resume":
          timers.dispatchTimers({ type: "resume", id: parsed.id });
          break;
        case "timer_reset":
          timers.dispatchTimers({ type: "reset", id: parsed.id });
          break;
        case "timer_delete":
          timers.dispatchTimers({ type: "delete", id: parsed.id });
          break;
        case "timer_adjust":
          timers.dispatchTimers({ type: "adjust", id: parsed.id, deltaMs: parsed.deltaMs });
          break;
        case "pco_live_start": {
          const res = await pcoLiveSync.startLiveSync(parsed.showId);
          if (!res.ok) send({ type: "error", code: "pco_live", message: res.error });
          break;
        }
        case "pco_live_stop":
          pcoLiveSync.stopLiveSync();
          break;
        case "save_song": {
          const saved = await songs.saveSong(parsed.song);
          send({ type: "ack", op: "save_song", id: saved.id });
          broadcast({ type: "song", song: saved });
          const list = await songs.listSongMetas();
          broadcast({ type: "song_list", songs: list });
          stageFeedHub.invalidateAll();
          scheduleSync();
          break;
        }
        case "delete_song": {
          const ok = await songs.deleteSong(parsed.songId);
          send({ type: "ack", op: "delete_song", id: parsed.songId });
          if (ok) {
            const list = await songs.listSongMetas();
            broadcast({ type: "song_list", songs: list });
            stageFeedHub.invalidateAll();
            scheduleSync();
          }
          break;
        }
        case "song_take": {
          const show = await shows.getShow(parsed.showId);
          if (!show) {
            send({ type: "error", code: "not_found", message: parsed.showId });
            break;
          }
          const row = show.rows.find((r) => r.id === parsed.songRowId);
          if (!row || row.kind !== "song") {
            send({ type: "error", code: "not_found", message: parsed.songRowId });
            break;
          }
          const song = await songs.getSong(row.songId);
          if (!song) {
            send({ type: "error", code: "not_found", message: row.songId });
            break;
          }
          const showSong = show.songs.find((e) => e.songId === row.songId);
          songSession.start(parsed.channel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: resolveArrangement(row, showSong, song),
            trustMode: row.trustMode ?? false,
          });
          channels.setLiveRow(parsed.channel, { showId: parsed.showId, rowId: row.id });
          break;
        }
        case "song_take_pvw_to_pgm": {
          const show = await shows.getShow(parsed.showId);
          if (!show) {
            send({ type: "error", code: "not_found", message: parsed.showId });
            break;
          }
          const row = show.rows.find((r) => r.id === parsed.songRowId);
          if (!row || row.kind !== "song") {
            send({ type: "error", code: "not_found", message: parsed.songRowId });
            break;
          }
          const song = await songs.getSong(row.songId);
          if (!song) {
            send({ type: "error", code: "not_found", message: row.songId });
            break;
          }
          const showSong = show.songs.find((e) => e.songId === row.songId);
          songSession.promoteTo(parsed.fromChannel, parsed.toChannel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: resolveArrangement(row, showSong, song),
            trustMode: row.trustMode ?? false,
          });
          channels.setLiveRow(parsed.toChannel, { showId: parsed.showId, rowId: parsed.songRowId });
          break;
        }
        case "song_advance": {
          songSession.advance(parsed.channel, parsed.delta);
          break;
        }
        case "song_jump": {
          songSession.jump(parsed.channel, parsed.sectionId, parsed.slideIdx ?? 0);
          break;
        }
        case "song_jump_kind": {
          songSession.jumpByKindOrdinal(parsed.channel, parsed.kind, parsed.ordinal);
          break;
        }
        case "song_blank": {
          songSession.blank(parsed.channel);
          break;
        }
        case "song_set_trust": {
          songSession.setTrust(parsed.channel, parsed.trustMode);
          break;
        }
        case "song_end": {
          songSession.end(parsed.channel);
          break;
        }
        case "take_song_sub": {
          // Resolve the Song → ShowSong → Row cascade for the chosen sub-take
          // and dispatch the right underlying flow. Intro/outro fire a graphic
          // `take` with resolved field values; lyrics either advances an
          // already-live same-song session or starts a fresh one.
          const show = await shows.getShow(parsed.showId);
          if (!show) {
            send({ type: "error", code: "not_found", message: parsed.showId });
            break;
          }
          const row = show.rows.find((r) => r.id === parsed.songRowId);
          if (!row || row.kind !== "song") {
            send({ type: "error", code: "not_found", message: parsed.songRowId });
            break;
          }
          const song = await songs.getSong(row.songId);
          if (!song) {
            send({ type: "error", code: "not_found", message: row.songId });
            break;
          }
          const showSong = show.songs.find((e) => e.songId === row.songId);
          const lyricTpl = await templates.getTemplate(row.lyricTemplateId);
          const resolvedChannel =
            parsed.channel ??
            resolveSongChannel(row, showSong, song, lyricTpl ?? undefined) ??
            "program";
          if (parsed.sub === "intro" || parsed.sub === "outro") {
            // Pull the specific intro/outro template (resolveIntroTake takes a
            // list and looks up by id — we hand it the single relevant body to
            // avoid a registry-wide load).
            const subTplId =
              parsed.sub === "intro"
                ? row.introTemplateId ??
                  showSong?.introTemplateId ??
                  song.defaultIntroTemplateId
                : row.outroTemplateId ??
                  showSong?.outroTemplateId ??
                  song.defaultOutroTemplateId;
            if (!subTplId) {
              send({
                type: "error",
                code: "not_configured",
                message: `no ${parsed.sub} template`,
              });
              break;
            }
            const subTpl = await templates.getTemplate(subTplId);
            if (!subTpl) {
              send({ type: "error", code: "not_found", message: subTplId });
              break;
            }
            const tpls = [subTpl];
            const take =
              parsed.sub === "intro"
                ? resolveIntroTake(row, showSong, song, tpls)
                : resolveOutroTake(row, showSong, song, tpls);
            if (!take) {
              send({
                type: "error",
                code: "not_configured",
                message: `${parsed.sub} resolved to null`,
              });
              break;
            }
            channels.take(
              resolvedChannel,
              take.templateId,
              take.fieldValues,
              { songRowId: row.id, sub: parsed.sub },
              undefined,
              { showId: parsed.showId, rowId: row.id },
            );
            if (parsed.sub === "intro") {
              // Arm the song on this channel so the section / slide buttons
              // that follow an intro start it instead of being dropped.
              songSession.queue(
                resolvedChannel,
                {
                  song,
                  lyricTemplateId: row.lyricTemplateId,
                  arrangement: resolveArrangement(row, showSong, song),
                  trustMode: row.trustMode ?? false,
                },
                { songRowId: row.id },
              );
            }
            break;
          }
          // sub === "lyrics": advance an existing same-song session, else start.
          const liveSession = songSession.getSession(resolvedChannel);
          if (liveSession && liveSession.songId === row.songId) {
            songSession.advance(resolvedChannel, 1);
          } else {
            songSession.start(resolvedChannel, {
              song,
              lyricTemplateId: row.lyricTemplateId,
              arrangement: resolveArrangement(row, showSong, song),
              trustMode: row.trustMode ?? false,
            });
          }
          channels.setLiveRow(resolvedChannel, { showId: parsed.showId, rowId: row.id });
          break;
        }
        case "scripture_take_intro":
        case "scripture_take_slide":
        case "scripture_advance":
        case "scripture_goto":
        case "scripture_end":
          await handleScriptureMessage(parsed, send);
          break;
        case "list_channels": {
          const list = await channelConfigs.listChannelConfigs();
          send({ type: "channel_list", configs: list });
          break;
        }
        case "get_channel": {
          const cfg = await channelConfigs.getChannelConfig(parsed.channelId);
          if (!cfg) send({ type: "error", code: "not_found", message: parsed.channelId });
          else send({ type: "channel", config: cfg });
          break;
        }
        case "save_channel": {
          const saved = await channelConfigs.saveChannelConfig(parsed.config);
          send({ type: "ack", op: "save_channel", id: saved.id });
          broadcast({ type: "channel", config: saved });
          const list = await channelConfigs.listChannelConfigs();
          broadcast({ type: "channel_list", configs: list });
          stageFeedHub.invalidateAll();
          scheduleSync();
          break;
        }
        case "delete_channel": {
          const ok = await channelConfigs.deleteChannelConfig(parsed.channelId);
          send({ type: "ack", op: "delete_channel", id: parsed.channelId });
          if (ok) {
            const list = await channelConfigs.listChannelConfigs();
            broadcast({ type: "channel_list", configs: list });
            stageFeedHub.invalidateAll();
            scheduleSync();
          }
          break;
        }
        case "ping": {
          send({ type: "pong", t: parsed.t });
          break;
        }
        case "stt_listener_register": {
          sttListener.register(parsed.audioSourceId, parsed.label);
          // Track so we can disconnect this source when the WS closes.
          registeredAudioSourceId = parsed.audioSourceId;
          // The listener daemon only PRODUCES hypotheses; it consumes nothing
          // from the broadcast stream. Unsubscribe it so server broadcasts
          // (stt_match, stt_spawner_status, big template/song saves…) never
          // fan out to it. This kills the old feedback amplifier where the
          // listener echoed stt_match to stderr → spawner captured that as a
          // log line → re-broadcast a full status to every client, per
          // hypothesis. It also removes the need for the listener's oversized
          // receive cap.
          offBroadcast();
          break;
        }
        case "stt_hypothesis": {
          sttListener.markHypothesisReceived(parsed.audioSourceId);
          // Route to all active sessions — the operator UI shows suggestions
          // for every channel regardless of which listener sent them.
          for (const channel of songSession.getChannelsWithSessions()) {
            songSession.processSttHypothesis(
              channel,
              parsed.text,
              parsed.t,
              parsed.isFinal,
            );
          }
          break;
        }
        case "stt_spawner_get_config": {
          const cfg = await storage.loadSttConfig();
          send({ type: "stt_spawner_config", config: cfg });
          send({ type: "stt_spawner_status", status: sttSpawner.getStatus() });
          break;
        }
        case "stt_spawner_save_config": {
          await storage.saveSttConfig(parsed.config);
          send({ type: "ack", op: "stt_spawner_save_config" });
          broadcast({ type: "stt_spawner_config", config: parsed.config });
          // Re-check presence inline so operator banners (Start button
          // enable, "Installed/Missing" pill) reflect the new modelPath the
          // moment the save lands. Without this the UI relies on a separate
          // stt_check_presence message that runs as a concurrent async
          // handler — and that handler's loadSttConfig can race this save's
          // disk write, returning stale data.
          const presence = await sttInstaller.checkPresence(
            parsed.config.modelPath,
          );
          broadcast({ type: "stt_presence", presence });
          break;
        }
        case "stt_spawner_start": {
          // When the operator passes its current draft config we save+start
          // in one handler so there's no race against a separate save_config
          // message — without this, the save's disk write and the start's
          // disk read run as two concurrent async handlers and start can
          // pick up stale config.
          let cfg;
          if (parsed.config) {
            await storage.saveSttConfig(parsed.config);
            broadcast({ type: "stt_spawner_config", config: parsed.config });
            cfg = parsed.config;
          } else {
            cfg = await storage.loadSttConfig();
          }
          // If a device-enumeration probe is mid-flight it's loading (or
          // already holds) the capture device via a throwaway whisper-stream.
          // Launching the real one now would fight it for the mic and often
          // fail to open audio. Wait for the probe to finish first.
          const pendingProbe = sttInstaller.enumerationInFlight();
          if (pendingProbe) {
            try {
              await pendingProbe;
            } catch {
              /* probe failure shouldn't block a start */
            }
          }
          // Channel mode: know the device's channel count so the capture
          // refuses out-of-range channels with a clear error.
          if (cfg.captureMode === "channels") {
            await sttInstaller.listInputDevices().catch(() => undefined);
          }
          sttSpawner.start(cfg);
          break;
        }
        case "stt_match_subscribe": {
          if (parsed.on) sttMatchSubscribers.add(send);
          else sttMatchSubscribers.delete(send);
          break;
        }
        case "stt_levels_subscribe": {
          if (parsed.on) levelSubscribers.add(send);
          else levelSubscribers.delete(send);
          break;
        }
        case "stt_spawner_stop": {
          sttSpawner.stop();
          break;
        }
        case "stt_check_presence": {
          const cfg = await storage.loadSttConfig();
          const presence = await sttInstaller.checkPresence(cfg.modelPath);
          send({ type: "stt_presence", presence });
          // Replay any in-flight install jobs so the requesting client
          // catches up to ongoing downloads without waiting for the next tick.
          for (const job of sttInstaller.listActiveJobs()) {
            send({ type: "stt_install_progress", progress: job });
          }
          break;
        }
        case "stt_list_models": {
          const models = await sttInstaller.listModels();
          send({
            type: "stt_models",
            models,
            modelsDir: sttInstaller.getModelsDir(),
          });
          break;
        }
        case "stt_enumerate_capture_devices": {
          // Never spawn a probe while the real spawner is up (or coming up) —
          // the probe momentarily grabs the capture device and would knock the
          // live whisper-stream off the mic. Serve the cache instead.
          const spawnerState = sttSpawner.getStatus().state;
          const spawnerLive =
            spawnerState === "running" || spawnerState === "starting";
          const [devices, inputDevices] = await Promise.all([
            sttInstaller.enumerateCaptureDevices({
              force: parsed.force,
              probe: spawnerLive ? false : undefined,
            }),
            sttInstaller.listInputDevices({ force: parsed.force }),
          ]);
          send({
            type: "stt_capture_devices",
            devices,
            ...(inputDevices ? { inputDevices } : {}),
          });
          break;
        }
        case "stt_install_binary": {
          try {
            sttInstaller.installBinary();
            send({ type: "ack", op: "stt_install_binary" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "error", code: "stt_install_unsupported", message });
          }
          break;
        }
        case "stt_uninstall_binary": {
          // Refuse if the spawner is running — uninstalling whisper-cpp
          // out from under a live child would crash it with a confusing
          // error. User stops first.
          const state = sttSpawner.getStatus().state;
          if (state === "running" || state === "starting") {
            send({
              type: "error",
              code: "stt_spawner_running",
              message: "Stop the STT spawner before uninstalling whisper-cpp.",
            });
            break;
          }
          try {
            sttInstaller.uninstallBinary();
            send({ type: "ack", op: "stt_uninstall_binary" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "error", code: "stt_uninstall_unsupported", message });
          }
          break;
        }
        case "stt_download_model": {
          try {
            sttInstaller.downloadModel(parsed.url, parsed.filename);
            send({ type: "ack", op: "stt_download_model", id: parsed.filename });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "error", code: "stt_download_invalid", message });
          }
          break;
        }
        case "stt_delete_model": {
          // Refuse if the spawner is running with this model — deleting an
          // in-use file leaves the child in an undefined state on next
          // model reload. Resolve the in-use model path the same way the
          // spawner does so the comparison matches.
          const state = sttSpawner.getStatus().state;
          if (state === "running" || state === "starting") {
            const active = sttSpawner.getActiveConfig();
            if (active && path.basename(active.modelPath) === parsed.filename) {
              send({
                type: "error",
                code: "stt_model_in_use",
                message:
                  "This model is currently in use. Stop the STT spawner before deleting.",
              });
              break;
            }
          }
          try {
            await sttInstaller.deleteModel(parsed.filename);
            send({ type: "ack", op: "stt_delete_model", id: parsed.filename });
            // Re-broadcast updated model list and presence so every connected
            // operator window updates without a manual refresh.
            const models = await sttInstaller.listModels();
            broadcast({
              type: "stt_models",
              models,
              modelsDir: sttInstaller.getModelsDir(),
            });
            const cfg = await storage.loadSttConfig();
            const presence = await sttInstaller.checkPresence(cfg.modelPath);
            broadcast({ type: "stt_presence", presence });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "error", code: "stt_delete_failed", message });
          }
          break;
        }
        case "stt_cancel_install": {
          sttInstaller.cancelInstall(parsed.jobId);
          send({ type: "ack", op: "stt_cancel_install", id: parsed.jobId });
          break;
        }
      }
    } catch (err) {
      log.error({ err, type: parsed.type }, "ws handler error");
      send({ type: "error", code: "handler_error", message: String(err) });
    }
  }

  ws.on("close", () => {
    closed = true;
    liveConnections.delete(connId);
    for (const [ch, owner] of mediaReporters) if (owner === connId) mediaReporters.delete(ch);
    outputs.removeConnection(connId);
    stageFeedHub.clearPreviewsByOwner(connId);
    if (registeredAudioSourceId) {
      sttListener.disconnect(registeredAudioSourceId);
    }
    for (const unsub of subscriptions.values()) unsub();
    subscriptions.clear();
    offBroadcast();
    levelSubscribers.delete(send);
    sttMatchSubscribers.delete(send);
    log.info("ws closed");
  });

  ws.on("error", (err) => {
    log.error({ err }, "ws error");
  });

  return { drain: () => chain };
}
