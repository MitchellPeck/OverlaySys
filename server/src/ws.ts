import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  encode,
  type ServerMessage,
} from "@overlaysys/ws-protocol";
import * as channels from "./channels";
import * as templates from "./templates";
import * as shows from "./shows";
import * as songs from "./songs";
import * as hotcards from "./hotcards";
import * as projects from "./projects";
import * as songSession from "./songSession";
import * as channelConfigs from "./channelConfigs";
import * as sttListener from "./sttListener";
import * as sttSpawner from "./sttSpawner";
import * as storage from "./storage";
import { registerSender, broadcast } from "./broadcast";

// ───── Module-scope subscriptions ────────────────────────────────────────────
// These broadcast to all connected clients whenever STT state changes.

songSession.onMatch((channel, result, hypothesis, meta) => {
  broadcast({
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
  });
});

sttListener.subscribe((listeners) => {
  broadcast({ type: "stt_listener_state", listeners });
});

sttSpawner.subscribe((status) => {
  broadcast({ type: "stt_spawner_status", status });
});

// Whenever the program channel's active song changes, push the song's text
// to the spawner as a Whisper prompt bias. The spawner restarts the child
// in-place (only when running) so subsequent recognition is biased toward
// the song's vocabulary.
songSession.onProgramBiasChange((bias) => {
  sttSpawner.setBias(bias);
});

export function handleConnection(
  ws: WebSocket,
  _req: IncomingMessage,
  log: FastifyBaseLogger,
): void {
  const subscriptions = new Map<string, () => void>();
  let registeredAudioSourceId: string | null = null;

  function send(msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  }
  const offBroadcast = registerSender(send);

  send({ type: "hello", protocolVersion: PROTOCOL_VERSION, serverTime: Date.now() });

  ws.on("message", async (raw) => {
    let parsed;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch (err) {
      send({ type: "error", code: "bad_message", message: String(err) });
      return;
    }

    try {
      switch (parsed.type) {
        case "subscribe": {
          if (subscriptions.has(parsed.channel)) return;
          const unsub = channels.subscribe(parsed.channel, (state) => {
            send({ type: "state", channel: state.channel, state });
          });
          subscriptions.set(parsed.channel, unsub);
          break;
        }
        case "take": {
          channels.take(parsed.channel, parsed.templateId, parsed.data);
          break;
        }
        case "clear": {
          channels.clear(parsed.channel);
          break;
        }
        case "update": {
          channels.update(parsed.channel, parsed.data);
          break;
        }
        case "cue": {
          channels.take(parsed.channel, parsed.templateId, parsed.data);
          break;
        }
        case "take_pvw_to_pgm": {
          channels.takePvwToPgm(parsed.fromChannel, parsed.toChannel);
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
          await templates.saveTemplate(parsed.template);
          send({ type: "ack", op: "save_template", id: parsed.template.id });
          // Notify everyone (the editor itself, plus the operator's template list).
          const list = await templates.listTemplateMetas();
          broadcast({ type: "template_list", templates: list });
          broadcast({ type: "template", template: parsed.template });
          break;
        }
        case "delete_template": {
          const ok = await templates.deleteTemplate(parsed.templateId);
          send({ type: "ack", op: "delete_template", id: parsed.templateId });
          if (ok) {
            const list = await templates.listTemplateMetas();
            broadcast({ type: "template_list", templates: list });
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
          await shows.saveShow(parsed.show);
          send({ type: "ack", op: "save_show", id: parsed.show.id });
          broadcast({ type: "show", show: parsed.show });
          const list = await shows.listShowMetas();
          broadcast({ type: "show_list", shows: list });
          break;
        }
        case "delete_show": {
          const ok = await shows.deleteShow(parsed.showId);
          send({ type: "ack", op: "delete_show", id: parsed.showId });
          if (ok) {
            const list = await shows.listShowMetas();
            broadcast({ type: "show_list", shows: list });
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
          await projects.saveProject(parsed.project);
          send({ type: "ack", op: "save_project", id: parsed.project.id });
          broadcast({ type: "project", project: parsed.project });
          const list = await projects.listProjects();
          broadcast({ type: "project_list", projects: list });
          break;
        }
        case "delete_project": {
          const ok = await projects.deleteProject(parsed.projectId);
          send({ type: "ack", op: "delete_project", id: parsed.projectId });
          if (ok) {
            const list = await projects.listProjects();
            broadcast({ type: "project_list", projects: list });
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
          await hotcards.saveHotcard(parsed.hotcard);
          send({ type: "ack", op: "save_hotcard", id: parsed.hotcard.id });
          broadcast({ type: "hotcard", hotcard: parsed.hotcard });
          const list = await hotcards.listHotcardMetas();
          broadcast({ type: "hotcard_list", hotcards: list });
          break;
        }
        case "delete_hotcard": {
          const ok = await hotcards.deleteHotcard(parsed.hotcardId);
          send({ type: "ack", op: "delete_hotcard", id: parsed.hotcardId });
          if (ok) {
            const list = await hotcards.listHotcardMetas();
            broadcast({ type: "hotcard_list", hotcards: list });
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
        case "save_song": {
          await songs.saveSong(parsed.song);
          send({ type: "ack", op: "save_song", id: parsed.song.id });
          broadcast({ type: "song", song: parsed.song });
          const list = await songs.listSongMetas();
          broadcast({ type: "song_list", songs: list });
          break;
        }
        case "delete_song": {
          const ok = await songs.deleteSong(parsed.songId);
          send({ type: "ack", op: "delete_song", id: parsed.songId });
          if (ok) {
            const list = await songs.listSongMetas();
            broadcast({ type: "song_list", songs: list });
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
          songSession.start(parsed.channel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: row.arrangement ?? song.defaultArrangement,
            trustMode: row.trustMode ?? false,
          });
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
          songSession.promoteTo(parsed.fromChannel, parsed.toChannel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: row.arrangement ?? song.defaultArrangement,
            trustMode: row.trustMode ?? false,
          });
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
          await channelConfigs.saveChannelConfig(parsed.config);
          send({ type: "ack", op: "save_channel", id: parsed.config.id });
          broadcast({ type: "channel", config: parsed.config });
          const list = await channelConfigs.listChannelConfigs();
          broadcast({ type: "channel_list", configs: list });
          break;
        }
        case "delete_channel": {
          const ok = await channelConfigs.deleteChannelConfig(parsed.channelId);
          send({ type: "ack", op: "delete_channel", id: parsed.channelId });
          if (ok) {
            const list = await channelConfigs.listChannelConfigs();
            broadcast({ type: "channel_list", configs: list });
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
          break;
        }
        case "stt_spawner_start": {
          const cfg = await storage.loadSttConfig();
          sttSpawner.start(cfg);
          break;
        }
        case "stt_spawner_stop": {
          sttSpawner.stop();
          break;
        }
      }
    } catch (err) {
      log.error({ err, type: parsed.type }, "ws handler error");
      send({ type: "error", code: "handler_error", message: String(err) });
    }
  });

  ws.on("close", () => {
    if (registeredAudioSourceId) {
      sttListener.disconnect(registeredAudioSourceId);
    }
    for (const unsub of subscriptions.values()) unsub();
    subscriptions.clear();
    offBroadcast();
    log.info("ws closed");
  });

  ws.on("error", (err) => {
    log.error({ err }, "ws error");
  });
}
