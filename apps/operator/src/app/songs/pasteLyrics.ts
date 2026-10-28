import { parseSongFromText, parseSongSelectText, type Song } from "@overlaysys/core";

export type SongPatch =
  & Pick<Song, "sections" | "defaultArrangement">
  & Partial<Pick<Song, "title" | "author" | "ccliNumber" | "copyright">>;

export function looksLikeSongSelect(text: string): boolean {
  if (/^CCLI Song #/im.test(text)) return true;
  if (/^For use solely with the SongSelect/im.test(text)) return true;
  if (/^©/m.test(text)) return true;
  if (/^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/im.test(text))
    return true;
  if (/\[[A-Ga-g][#b]?[A-Za-z0-9]*(?:\/[A-Ga-g][#b]?)?\]/.test(text)) return true;
  return false;
}

export type LyricsParse =
  | { ok: true; patch: SongPatch; songSelect: boolean }
  | { ok: false; error: string; songSelect: boolean };

/**
 * Parse pasted lyrics into the patch "Replace song body" would apply. Pure so
 * the paste panel can preview the result before anything is replaced.
 */
export function parsePastedLyrics(song: Pick<Song, "id" | "title">, text: string, updateMeta: boolean): LyricsParse {
  const songSelect = looksLikeSongSelect(text);
  if (!text.trim()) return { ok: false, error: "Paste or drop lyrics to preview.", songSelect };
  try {
    if (songSelect) {
      const r = parseSongSelectText(text);
      const patch: SongPatch = { sections: r.sections, defaultArrangement: r.defaultArrangement };
      if (updateMeta) {
        if (r.meta.title) patch.title = r.meta.title;
        if (r.meta.authors?.length) patch.author = r.meta.authors.join(", ");
        if (r.meta.ccliNumber) patch.ccliNumber = r.meta.ccliNumber;
        if (r.meta.copyright) patch.copyright = r.meta.copyright;
      }
      if (patch.sections.length === 0) return { ok: false, error: "No sections found.", songSelect };
      return { ok: true, patch, songSelect };
    }
    const parsed = parseSongFromText(song.id, song.title, text);
    return {
      ok: true,
      patch: { sections: parsed.sections, defaultArrangement: parsed.defaultArrangement },
      songSelect,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), songSelect };
  }
}
