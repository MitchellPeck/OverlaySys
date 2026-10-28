import {
  emptySections,
  looksLikeChordPro,
  parseChordPro,
  parseSongSelectText,
  parseSongTextWithNotice,
  type Song,
} from "@overlaysys/core";

export type SongPatch =
  & Pick<Song, "sections" | "defaultArrangement">
  & Partial<Pick<Song, "title" | "author" | "ccliNumber" | "copyright">>;

export type LyricsFormat = "chordpro" | "songselect" | "plain";

export const CHORD_TOKEN_RE = /^[A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b]?)?$/;

/** A `[token]` matching CHORD_TOKEN_RE on a line that also has lyric text. */
export function hasInlineChords(text: string): boolean {
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.replace(/\[[^\]]*\]/g, "").trim()) continue;
    for (const m of line.matchAll(/\[([^\]]*)\]/g)) {
      if (CHORD_TOKEN_RE.test(m[1] ?? "")) return true;
    }
  }
  return false;
}

export function looksLikeSongSelect(text: string): boolean {
  if (/^CCLI Song #/im.test(text)) return true;
  if (/^For use solely with the SongSelect/im.test(text)) return true;
  if (/^©/m.test(text)) return true;
  if (/^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/im.test(text))
    return true;
  if (hasInlineChords(text)) return true;
  return false;
}

export function detectLyricsFormat(text: string, fileName?: string): LyricsFormat {
  if (fileName && /\.(cho|chordpro|chopro)$/i.test(fileName)) return "chordpro";
  if (looksLikeChordPro(text)) return "chordpro";
  if (looksLikeSongSelect(text)) return "songselect";
  return "plain";
}

export type LyricsParse =
  | { ok: true; patch: SongPatch; format: LyricsFormat; notice: string | null; warnings: string[] }
  | { ok: false; error: string; format: LyricsFormat };

const NO_SECTIONS = "Couldn't find any verses or choruses in this file.";

/**
 * Parse pasted lyrics into the patch "Replace song body" would apply. Pure so
 * the paste panel can preview the result before anything is replaced.
 */
export function parsePastedLyrics(
  song: Pick<Song, "id" | "title">,
  text: string,
  updateMeta: boolean,
  fileName?: string,
): LyricsParse {
  const format = detectLyricsFormat(text, fileName);
  if (!text.trim()) return { ok: false, error: "Paste or drop lyrics to preview.", format };
  try {
    let patch: SongPatch;
    let notice: string | null = null;
    if (format === "chordpro" || format === "songselect") {
      const r = format === "chordpro" ? parseChordPro(text) : parseSongSelectText(text);
      patch = { sections: r.sections, defaultArrangement: r.defaultArrangement };
      if (updateMeta) {
        if (r.meta.title) patch.title = r.meta.title;
        const author = "authors" in r.meta ? r.meta.authors?.join(", ") : "artist" in r.meta ? r.meta.artist : undefined;
        if (author) patch.author = author;
        if (r.meta.ccliNumber) patch.ccliNumber = r.meta.ccliNumber;
        if (r.meta.copyright) patch.copyright = r.meta.copyright;
      }
      if (patch.sections.length === 0) return { ok: false, error: NO_SECTIONS, format };
    } else {
      const parsed = parseSongTextWithNotice(song.id, song.title, text);
      patch = { sections: parsed.song.sections, defaultArrangement: parsed.song.defaultArrangement };
      notice = parsed.notice;
    }
    const warnings = emptySections(patch.sections).map(
      (s) => `${s.label} has no lines: it will show a blank slide`,
    );
    return { ok: true, patch, format, notice, warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), format };
  }
}
