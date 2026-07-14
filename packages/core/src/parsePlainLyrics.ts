import type { Section } from "./song";
import { emitSections, type RawSection } from "./sectionEmit";

/**
 * Shared plain-text lyric pipeline: header detection → slide chunking →
 * {@link Section}[] emission. Factored out of songSelectParser so other
 * importers (e.g. Planning Center arrangements) can reuse the exact same
 * tokenizer without SongSelect's title/footer/CCLI extraction.
 */

// Matches ChordPro inline chord markers like [G], [Cmaj7], [F#m], [Eb/G],
// [Bb] while deliberately leaving section headers like [Verse 1], [Chorus],
// [Bridge] intact. See the long-form rationale in songSelectParser history:
// a chord token starts with a note letter (A–G), optional accidental, then a
// short/qualified suffix; section labels have 4+ lowercase letters.
const CHORD_RE =
  /\[[A-Ga-g][#b]?(?![a-z]{4,}\])(?:[a-zA-Z0-9]*)(?:\/[A-Ga-g][#b]?)?\]/g;

export function stripChords(line: string): string {
  return line
    .replace(CHORD_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const BRACKET_HEADER_RE = /^\s*\[(.+?)\]\s*$/;
const BARE_HEADER_RE =
  /^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/i;

/**
 * Returns the header label if `line` is a section header (bracketed like
 * `[Verse 1]` or a bare keyword like `Chorus` / `VERSE 2`), else null.
 */
export function isHeaderLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const bracket = BRACKET_HEADER_RE.exec(trimmed);
  if (bracket) return (bracket[1] ?? "").trim();
  if (BARE_HEADER_RE.test(trimmed)) return trimmed;
  return null;
}

export function tokenizeBody(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let buffer: string[] = [];

  function flushSlide() {
    if (!current) return;
    if (buffer.length === 0) return;
    current.blocks.push(buffer);
    buffer = [];
  }

  for (const line of lines) {
    const header = isHeaderLine(line);
    if (header !== null) {
      flushSlide();
      if (current) sections.push(current);
      current = { header, blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current) continue;
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  return sections;
}

const MAX_LINES_PER_SLIDE = 2;

export function rechunkSlides(raw: RawSection[]): RawSection[] {
  return raw.map((rs) => ({
    ...rs,
    blocks: rs.blocks.flatMap((lines) => {
      if (lines.length <= MAX_LINES_PER_SLIDE) return [lines];
      const out: string[][] = [];
      for (let i = 0; i < lines.length; i += MAX_LINES_PER_SLIDE) {
        out.push(lines.slice(i, i + MAX_LINES_PER_SLIDE));
      }
      return out;
    }),
  }));
}

export interface ParsedLyrics {
  sections: Section[];
  defaultArrangement: string[];
}

/**
 * Parse plain-text lyrics (no title/footer) into sections + a default
 * arrangement. Chord markers are stripped from non-header lines.
 *
 * Returns empty arrays when the text has no content. As a safety net, when
 * there is body text but no recognizable section headers, the entire body is
 * emitted as one "Verse 1" section rather than being silently dropped — so an
 * arrangement with unconventional (or missing) headers still imports its lyrics.
 */
export function parsePlainLyrics(text: string): ParsedLyrics {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const stripped = lines.map((line) =>
    isHeaderLine(line) !== null ? line : stripChords(line),
  );

  let raw = tokenizeBody(stripped);
  if (raw.length === 0) {
    const body = stripped.filter((l) => l.trim() !== "");
    if (body.length === 0) return { sections: [], defaultArrangement: [] };
    raw = [{ header: "Verse 1", blocks: [body] }];
  }

  return emitSections(rechunkSlides(raw));
}
