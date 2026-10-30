import type { MediaItem, MediaItemMeta } from "@overlaysys/core";
import * as store from "./mediaStore";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";
import { listShowMetas, getShow } from "./shows";
import { listDecks } from "./decks";
import { rewriteMediaRefs } from "./mediaRefs";

const REGISTRY = new Map<string, MediaItem>();
let loaded = false;

export async function reloadMedia(): Promise<void> {
  const all = await store.loadAllMedia();
  REGISTRY.clear();
  for (const m of all) REGISTRY.set(m.id, m);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadMedia();
}

/** Number of live places that reference each media item id: show rows, deck slides, and live-folder decks. */
async function usageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const bump = (ids: Set<string>): void => {
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const meta of await listShowMetas()) {
    const show = await getShow(meta.id);
    if (!show) continue;
    const used = new Set<string>();
    for (const r of show.rows) {
      if ((r.kind === "media" || r.kind === "video") && r.mediaItemId) used.add(r.mediaItemId);
    }
    bump(used);
  }
  for (const deck of await listDecks()) {
    const used = new Set<string>();
    for (const s of deck.slides) if (s.media?.mediaItemId) used.add(s.media.mediaItemId);
    if (deck.liveFolderId) used.add(deck.liveFolderId);
    bump(used);
  }
  return counts;
}

export async function listMediaMetas(): Promise<MediaItemMeta[]> {
  await ensureLoaded();
  const counts = await usageCounts();
  return liveOnly(REGISTRY.values()).map((m) => ({ ...m, usedBy: counts.get(m.id) ?? 0 }));
}

export async function getMediaItem(id: string): Promise<MediaItem | null> {
  await ensureLoaded();
  const m = REGISTRY.get(id);
  return m && isLive(m) ? m : null;
}

export async function saveMediaItem(item: MediaItem): Promise<MediaItem> {
  await ensureLoaded();
  // createdAt is stamped only for an id the registry has never seen.
  const existing = REGISTRY.get(item.id);
  if (existing && isLive(existing) && existing.kind === "file" && item.kind === "file" && existing.mediaType !== item.mediaType) {
    throw Object.assign(new Error("Replace a photo with a photo, or a video with a video."), { statusCode: 400 });
  }
  const createdAt = existing ? existing.createdAt : item.createdAt || new Date().toISOString();
  const stamped = stampWrite({ ...item, createdAt });
  await store.writeMediaItem(stamped);
  REGISTRY.set(stamped.id, stamped);
  // Replacing the file updates every show row and deck slide that uses this item.
  if (existing && stamped.assetUrl && stamped.mediaType && existing.assetUrl !== stamped.assetUrl) {
    await rewriteMediaRefs(stamped.id, stamped.assetUrl, stamped.mediaType);
  }
  return stamped;
}

export async function deleteMediaItem(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await store.writeMediaItem(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function restoreMediaItem(id: string): Promise<MediaItem | null> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || isLive(current)) return null;
  const restored = stampWrite(current);
  await store.writeMediaItem(restored);
  REGISTRY.set(id, restored);
  return restored;
}

/** Ids of the live (not deleted) live-folder items. Cheap: no usage counting. */
export async function listLiveFolderItemIds(): Promise<string[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values())
    .filter((m) => m.kind === "live-folder")
    .map((m) => m.id);
}
