import type { ChannelState, MediaItemMeta } from "@overlaysys/core";
import { mediaRowTakeMessage, type ClientMessage } from "@overlaysys/ws-protocol";
import { NO_FOLDER } from "../../media/libraryConfig";
import { newMediaRowFromPick } from "../../media/pickerModel";

export type PanelChannel = "preview" | "program";

/** Row ids the panel's takes carry, so the panel can light what it put on air. */
export const panelRowId = (m: Pick<MediaItemMeta, "id" | "kind">): string =>
  m.kind === "live-folder" ? `media-folder:${m.id}` : `media-item:${m.id}`;

/**
 * The `media_take` for a library file, with a Media row's defaults: a photo
 * covers the frame and holds; a video plays once with sound and holds its last
 * frame. No show id, so nothing in the show changes.
 */
export function mediaItemTakeMessage(item: MediaItemMeta, channel: PanelChannel): ClientMessage {
  const row = newMediaRowFromPick(
    { mediaItemId: item.id, assetUrl: item.assetUrl ?? "", mediaType: item.mediaType ?? "image" },
    panelRowId(item),
  );
  const labelled = { ...row, label: item.name };
  return mediaRowTakeMessage(labelled.kind === "video" ? { ...labelled, loop: false, muted: false } : labelled, channel);
}

/** A live folder loops on the server (8 s hold); the server refuses an empty one. */
export function mediaFolderTakeMessage(item: Pick<MediaItemMeta, "id">, channel: PanelChannel): ClientMessage {
  return { type: "media_folder_take", id: item.id, channel };
}

/**
 * Items the panel offers: photos, videos and live folders (not deleted),
 * matching `query` by name and `folder` ("" or "all" = any; NO_FOLDER = none).
 */
export function filterPanelItems<T extends MediaItemMeta>(items: T[], query: string, folder: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (m) =>
      !m.deletedAt &&
      (m.kind === "live-folder" || (!!m.assetUrl && !!m.mediaType)) &&
      (!q || m.name.toLowerCase().includes(q)) &&
      (!folder || folder === "all" || (folder === NO_FOLDER ? !m.folder : m.folder === folder)),
  );
}

/** "program" / "preview" when the panel's take of this item is in that channel's media slot. */
export function panelAirState(
  item: Pick<MediaItemMeta, "id" | "kind">,
  channelStates: Record<string, ChannelState | undefined>,
): PanelChannel | null {
  const rowId = panelRowId(item);
  if (channelStates["program"]?.media?.rowId === rowId) return "program";
  if (channelStates["preview"]?.media?.rowId === rowId) return "preview";
  return null;
}
