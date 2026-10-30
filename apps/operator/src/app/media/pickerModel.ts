import {
  DEFAULT_MEDIA_TRANSITION,
  liveFolderFileUrl,
  type LiveFolderFile,
  type ImageRow,
  type MediaItem,
  type MediaRef,
  type PartialMediaPlacement,
  type VideoRow,
} from "@overlaysys/core";
import { ownPlacement } from "../../lib/mediaPlacement";

export type PickAccept = "image" | "video" | "any";
/** What the library picker hands back: a reference, the item's name for display, and its own size/position. */
export type PickedMedia = MediaRef & PartialMediaPlacement & { name: string; liveFolderId?: string };

/** File items and live folders the picker offers for `accept`, matching `query` by name. Deleted items are left out; a folder's files are filtered when it's opened. */
export function pickableItems<T extends MediaItem>(items: T[], accept: PickAccept, query = ""): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (m) =>
      !m.deletedAt &&
      (m.kind === "live-folder" || (!!m.assetUrl && !!m.mediaType && (accept === "any" || m.mediaType === accept))) &&
      (!q || m.name.toLowerCase().includes(q)),
  );
}

/** The pick for a file item (call only with items from `pickableItems`). */
export function pickFromItem(m: MediaItem): PickedMedia {
  return { mediaItemId: m.id, assetUrl: m.assetUrl ?? "", mediaType: m.mediaType ?? "image", name: m.name, ...ownPlacement(m) };
}

export const LIVE_FOLDER_REMOTE_NOTE = "These graphics are on the show computer.";
export const LIVE_FOLDER_PICK_NOTE = "If a file is removed or renamed in the folder, it shows nothing.";

/** The files to list when a live folder is open, plus a one-line message when there are none to show. */
export function liveFolderChoices(
  entry: { files: LiveFolderFile[]; configured: boolean } | undefined,
  accept: PickAccept,
): { files: LiveFolderFile[]; message: string | null } {
  if (!entry) return { files: [], message: "Looking in the folder…" };
  if (!entry.configured) return { files: [], message: LIVE_FOLDER_REMOTE_NOTE };
  const files = entry.files.filter((f) => accept === "any" || f.mediaType === accept);
  if (files.length > 0) return { files, message: null };
  const what = accept === "image" ? "photos" : accept === "video" ? "videos" : "photos or videos";
  return { files, message: `No ${what} in this folder yet.` };
}

/** The pick for one file in a live folder: it plays from the folder, so there's no library item or placement. */
export function pickFromLiveFile(folderId: string, file: LiveFolderFile): PickedMedia {
  return { assetUrl: liveFolderFileUrl(folderId, file.name), mediaType: file.mediaType, name: file.name, liveFolderId: folderId };
}

/**
 * A new rundown row for a pick. Videos stay `kind: "video"` and hold their last
 * frame by default; photos are `kind: "media"` and cover the frame. The
 * item's own size/position (if any) is the row's starting value.
 */
export function newMediaRowFromPick(ref: MediaRef & PartialMediaPlacement, id: string): VideoRow | ImageRow {
  const link = ref.mediaItemId ? { mediaItemId: ref.mediaItemId } : {};
  const placed = ownPlacement(ref);
  if (ref.mediaType === "video") {
    return {
      kind: "video",
      id,
      assetUrl: ref.assetUrl,
      ...link,
      volume: 1,
      endAction: "hold",
      ...placed,
      transitionIn: DEFAULT_MEDIA_TRANSITION,
      transitionOut: DEFAULT_MEDIA_TRANSITION,
    };
  }
  return {
    kind: "media",
    mediaType: "image",
    id,
    assetUrl: ref.assetUrl,
    ...link,
    fit: "cover",
    ...placed,
    transitionIn: DEFAULT_MEDIA_TRANSITION,
    transitionOut: DEFAULT_MEDIA_TRANSITION,
  };
}
