import { DEFAULT_MEDIA_TRANSITION, type ImageRow, type MediaItem, type MediaRef, type VideoRow } from "@overlaysys/core";

export type PickAccept = "image" | "video" | "any";
/** What the library picker hands back: a reference plus the item's name for display. */
export type PickedMedia = MediaRef & { name: string };

/** File items the picker offers for `accept`, matching `query` by name. Live folders and deleted items are left out. */
export function pickableItems<T extends MediaItem>(items: T[], accept: PickAccept, query = ""): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (m) =>
      m.kind === "file" &&
      !m.deletedAt &&
      !!m.assetUrl &&
      !!m.mediaType &&
      (accept === "any" || m.mediaType === accept) &&
      (!q || m.name.toLowerCase().includes(q)),
  );
}

/** The pick for a file item (call only with items from `pickableItems`). */
export function pickFromItem(m: MediaItem): PickedMedia {
  return { mediaItemId: m.id, assetUrl: m.assetUrl ?? "", mediaType: m.mediaType ?? "image", name: m.name };
}

/**
 * A new rundown row for a pick. Videos stay `kind: "video"` and hold their last
 * frame by default; photos are `kind: "media"` and cover the frame.
 */
export function newMediaRowFromPick(ref: MediaRef, id: string): VideoRow | ImageRow {
  const link = ref.mediaItemId ? { mediaItemId: ref.mediaItemId } : {};
  if (ref.mediaType === "video") {
    return {
      kind: "video",
      id,
      assetUrl: ref.assetUrl,
      ...link,
      volume: 1,
      endAction: "hold",
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
    transitionIn: DEFAULT_MEDIA_TRANSITION,
    transitionOut: DEFAULT_MEDIA_TRANSITION,
  };
}
