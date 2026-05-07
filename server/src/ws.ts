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
import * as songSession from "./songSession";
import * as channelConfigs from "./channelConfigs";
import { registerSender, broadcast } from "./broadcast";

export function handleConnection(
  ws: WebSocket,
  _req: IncomingMessage,
  log: FastifyBaseLogger,
): void {
  const subscriptions = new Map<string, () => void>();

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
      }
    } catch (err) {
      log.error({ err, type: parsed.type }, "ws handler error");
      send({ type: "error", code: "handler_error", message: String(err) });
    }
  });

  ws.on("close", () => {
    for (const unsub of subscriptions.values()) unsub();
    subscriptions.clear();
    offBroadcast();
    log.info("ws closed");
  });

  ws.on("error", (err) => {
    log.error({ err }, "ws error");
  });
}
