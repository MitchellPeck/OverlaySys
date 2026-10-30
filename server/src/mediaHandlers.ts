import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as media from "./media";
import { broadcast } from "./broadcast";
import { scheduleSync } from "./cloudSync";
import * as stageFeedHub from "./stageFeedHub";

export type MediaMessage = Extract<
  ClientMessage,
  { type: "list_media" | "get_media_item" | "save_media_item" | "delete_media_item" | "restore_media_item" }
>;

type Send = (m: ServerMessage) => void;

async function broadcastList(): Promise<void> {
  broadcast({ type: "media_list", items: await media.listMediaMetas() });
}

export async function handleMediaMessage(msg: MediaMessage, send: Send): Promise<void> {
  switch (msg.type) {
    case "list_media":
      send({ type: "media_list", items: await media.listMediaMetas() });
      return;
    case "get_media_item": {
      const m = await media.getMediaItem(msg.id);
      if (!m) send({ type: "error", code: "not_found", message: msg.id });
      else send({ type: "media_item", item: m });
      return;
    }
    case "save_media_item": {
      const saved = await media.saveMediaItem(msg.item);
      send({ type: "ack", op: "save_media_item", id: saved.id });
      broadcast({ type: "media_item", item: saved });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
    case "delete_media_item": {
      const ok = await media.deleteMediaItem(msg.id);
      if (!ok) {
        send({ type: "error", code: "not_found", message: msg.id });
        return;
      }
      send({ type: "ack", op: "delete_media_item", id: msg.id });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
    case "restore_media_item": {
      const m = await media.restoreMediaItem(msg.id);
      if (!m) {
        send({ type: "error", code: "not_found", message: msg.id });
        return;
      }
      send({ type: "ack", op: "restore_media_item", id: m.id });
      broadcast({ type: "media_item", item: m });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
  }
}
