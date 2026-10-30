import type { Deck } from "./deck";

export type LiveFolderFile = { name: string; mediaType: "image" | "video"; size: number; mtimeMs: number };

export type MediaDeckSlide = {
  key: string;
  assetUrl: string;
  mediaType: "image" | "video";
  holdSec?: number;
  advanceOnEnd: boolean;
  muted: boolean;
  label?: string;
};

export function liveFolderFileUrl(folderId: string, name: string): string {
  return `/media-folders/${folderId}/${encodeURIComponent(name)}`;
}

/** True for a live-folder deck, or a deck whose slides all carry media. */
export function isMediaOnlyDeck(deck: Deck): boolean {
  if (deck.liveFolderId) return true;
  return deck.slides.length > 0 && deck.slides.every((s) => s.media !== undefined);
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Saved order plus newly seen files appended (name-sorted). Missing files keep
 * their saved position so they resume it if they return.
 */
export function nextFolderOrder(
  order: Deck["folderOrder"],
  files: LiveFolderFile[],
): NonNullable<Deck["folderOrder"]> {
  const saved = order ?? [];
  const known = new Set(saved.map((o) => o.file));
  const added = files
    .map((f) => f.name)
    .filter((n) => !known.has(n))
    .sort(byName)
    .map((file) => ({ file }));
  return [...saved, ...added];
}

/** The playable slides of a live-folder deck: ordered, with files that are not present skipped. */
export function resolveFolderDeckSlides(
  order: Deck["folderOrder"],
  files: LiveFolderFile[],
  defaultHoldSec: number | undefined,
  folderId: string,
): MediaDeckSlide[] {
  const present = new Map(files.map((f) => [f.name, f]));
  const out: MediaDeckSlide[] = [];
  for (const entry of nextFolderOrder(order, files)) {
    const file = present.get(entry.file);
    if (!file) continue;
    out.push({
      key: file.name,
      assetUrl: liveFolderFileUrl(folderId, file.name),
      mediaType: file.mediaType,
      holdSec: file.mediaType === "image" ? (entry.holdSec ?? defaultHoldSec) : undefined,
      advanceOnEnd: file.mediaType === "video",
      muted: false,
      label: file.name,
    });
  }
  return out;
}

/** Slides of a non-folder media-only deck. */
export function mediaDeckSlidesFromDeck(deck: Deck): MediaDeckSlide[] {
  const out: MediaDeckSlide[] = [];
  for (const s of deck.slides) {
    if (!s.media) continue;
    const video = s.media.mediaType === "video";
    out.push({
      key: s.id,
      assetUrl: s.media.assetUrl,
      mediaType: s.media.mediaType,
      holdSec: s.holdSec ?? (video ? undefined : deck.defaultHoldSec),
      advanceOnEnd: s.advanceOnEnd ?? video,
      muted: s.muted ?? false,
      label: s.label,
    });
  }
  return out;
}
