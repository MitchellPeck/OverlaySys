import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as media from "./media";
import * as decks from "./decks";
import * as mediaDeckSession from "./mediaDeckSession";
import { broadcast } from "./broadcast";
import { scheduleSync } from "./cloudSync";
import * as stageFeedHub from "./stageFeedHub";
import { getLiveFolderPath } from "./liveFolders";

/** A live folder whose path isn't set on this machine. */
export const FOLDER_ELSEWHERE_MESSAGE = "This folder is set up on another computer.";

export type MediaMessage = Extract<
  ClientMessage,
  {
    type: "list_media" | "get_media_item" | "save_media_item" | "delete_media_item" | "restore_media_item" | "media_folder_take";
  }
>;

type Send = (m: ServerMessage) => void;

async function broadcastList(): Promise<void> {
  broadcast({ type: "media_list", items: await media.listMediaMetas() });
}

/**
 * Live Media panel: loop a live folder on `channel`. It plays in the saved
 * order and size/position of a deck that links the folder, if one does.
 * Refused (and nothing on air changes) when the id isn't a live folder, the
 * folder isn't set up on this machine, or it is empty.
 */
async function takeFolder(msg: Extract<MediaMessage, { type: "media_folder_take" }>, send: Send): Promise<void> {
  const refuse = (code: string, message: string) => send({ type: "error", code, message, op: msg.type, id: msg.id });
  const item = await media.getMediaItem(msg.id);
  if (!item || item.kind !== "live-folder") {
    refuse("not_found", "That live folder is gone.");
    return;
  }
  if (!(await getLiveFolderPath(msg.id))) {
    refuse("not_configured", FOLDER_ELSEWHERE_MESSAGE);
    return;
  }
  // The most recently updated deck linking the folder (ties by id), so the choice never depends on list order.
  const linked = (await decks.listDecks())
    .filter((d) => d.liveFolderId === msg.id)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id))[0];
  const res = mediaDeckSession.startFolder(msg.channel, {
    folderId: msg.id,
    name: item.name,
    ...(linked?.folderOrder ? { folderOrder: linked.folderOrder } : {}),
    ...(linked?.mediaFit ? { mediaFit: linked.mediaFit } : {}),
    ...(linked?.mediaPosition ? { mediaPosition: linked.mediaPosition } : {}),
    // Chosen at the panel: tops every other layer for this loop.
    ...(msg.fit ? { fit: msg.fit } : {}),
    ...(msg.position ? { position: msg.position } : {}),
  });
  // The only refusal for a folder started at its first file: nothing to play.
  if (!res.ok) refuse("empty", res.error);
}

export async function handleMediaMessage(msg: MediaMessage, send: Send): Promise<void> {
  switch (msg.type) {
    case "media_folder_take":
      await takeFolder(msg, send);
      return;
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
