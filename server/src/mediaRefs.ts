import type { Deck, Show } from "@overlaysys/core";
import { listShowMetas, getShow, saveShow } from "./shows";
import { listDecks, saveDeck } from "./decks";

type MediaType = "image" | "video";

/**
 * Point every show row and deck slide that references library item `mediaItemId` at its new file.
 * Saves through the normal registries so sync picks the change up. Channel state is not touched:
 * media already on air keeps playing the old file. A row keeps its kind, so a row whose kind no longer
 * matches `mediaType` (a photo row after a video replaced the file) is left alone.
 */
export async function rewriteMediaRefs(
  mediaItemId: string,
  assetUrl: string,
  mediaType: MediaType,
): Promise<{ shows: number; decks: number }> {
  let showCount = 0;
  let deckCount = 0;

  for (const meta of await listShowMetas()) {
    const show = await getShow(meta.id);
    if (!show) continue;
    let changed = false;
    const rows = show.rows.map((r) => {
      if (r.kind !== "media" && r.kind !== "video") return r;
      if (r.mediaItemId !== mediaItemId) return r;
      const rowType: MediaType = r.kind === "video" ? "video" : "image";
      if (rowType !== mediaType || r.assetUrl === assetUrl) return r;
      changed = true;
      return { ...r, assetUrl };
    });
    if (!changed) continue;
    await saveShow({ ...show, rows } as Show);
    showCount++;
  }

  for (const deck of await listDecks()) {
    let changed = false;
    const slides = deck.slides.map((s) => {
      if (s.media?.mediaItemId !== mediaItemId) return s;
      if (s.media.assetUrl === assetUrl && s.media.mediaType === mediaType) return s;
      changed = true;
      return { ...s, media: { ...s.media, assetUrl, mediaType } };
    });
    if (!changed) continue;
    await saveDeck({ ...deck, slides } as Deck);
    deckCount++;
  }

  return { shows: showCount, decks: deckCount };
}
