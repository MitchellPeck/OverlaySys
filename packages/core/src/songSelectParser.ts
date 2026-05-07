import type { Section } from "./song";
import { emitSections, type RawSection } from "./sectionEmit";

export interface SongSelectMeta {
  title?: string;
  authors?: string[];
  ccliNumber?: string;
  copyright?: string;
}

export interface SongSelectParseResult {
  meta: SongSelectMeta;
  sections: Section[];
  defaultArrangement: string[];
}

export function slugifyTitle(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks (NFKD remnants)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

const FOOTER_MARKER_RE =
  /^(CCLI Song #|CCLI License #|For use solely with the SongSelect)/i;
const COPYRIGHT_LINE_RE = /^©/;

function splitFooter(lines: string[]): { body: string[]; footer: string[] } {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (FOOTER_MARKER_RE.test(t) || COPYRIGHT_LINE_RE.test(t)) {
      let footerStart = i;
      // Walk back through blanks
      let j = i - 1;
      while (j >= 0 && lines[j]!.trim() === "") j--;
      // j now points at a non-blank line or -1
      if (j >= 0) {
        // If line at j is bracketed by blanks (or BOF), include it as part of footer
        if (j === 0 || lines[j - 1]!.trim() === "") {
          footerStart = j;
        }
      }
      return { body: lines.slice(0, footerStart), footer: lines.slice(footerStart) };
    }
  }
  return { body: lines, footer: [] };
}

const CCLI_SONG_RE = /^CCLI Song #\s*(\d+)/i;
const CCLI_LICENSE_RE = /^CCLI License #/i;

function extractTitle(preamble: string[]): string | undefined {
  for (const raw of preamble) {
    const t = raw.trim();
    if (t) return t;
  }
  return undefined;
}

function extractMeta(preamble: string[], footer: string[]): SongSelectMeta {
  const meta: SongSelectMeta = {};
  const title = extractTitle(preamble);
  if (title) meta.title = title;

  for (const raw of footer) {
    const line = raw.trim();
    if (!line) continue;
    if (CCLI_LICENSE_RE.test(line)) continue; // explicitly ignored
    if (/^For use solely with the SongSelect/i.test(line)) continue;

    const ccli = CCLI_SONG_RE.exec(line);
    if (ccli) {
      if (!meta.ccliNumber) meta.ccliNumber = ccli[1];
      continue;
    }
    if (line.startsWith("©")) {
      if (!meta.copyright) meta.copyright = line;
      continue;
    }
    // Anything else: first non-classified line is the author candidate.
    if (!meta.authors && /[A-Za-z]/.test(line)) {
      meta.authors = line.includes(" | ")
        ? line.split(" | ").map((s) => s.trim()).filter(Boolean)
        : [line];
    }
  }
  return meta;
}

// Matches ChordPro inline chord markers like [G], [Cmaj7], [F#m], [Eb/G],
// [Bb] while deliberately leaving section headers like [Verse 1], [Chorus],
// [Bridge] intact.
//
// A chord token starts with a note letter (A–G, case-insensitive), an
// optional accidental (#/b), then a qualifier. Section headers are
// distinguished by having 4+ consecutive pure-lowercase letters with no
// digits in the qualifier (e.g. "horus" in Chorus, "ridge" in Bridge).
// Real chord qualifiers are either short (≤3 chars) or contain a digit
// (maj7, sus4, add9, m7b5, etc.).
//
// The regex uses a negative lookahead: after root+accidental, if the next
// chars are 4+ lowercase letters with no digit before the ']', treat as a
// section label and skip. Otherwise match as a chord.
const CHORD_RE =
  /\[[A-Ga-g][#b]?(?![a-z]{4,}\])(?:[a-zA-Z0-9]*)(?:\/[A-Ga-g][#b]?)?\]/g;

function stripChords(line: string): string {
  return line
    .replace(CHORD_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const BRACKET_HEADER_RE = /^\s*\[(.+?)\]\s*$/;
const BARE_HEADER_RE =
  /^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/i;

function isHeaderLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const bracket = BRACKET_HEADER_RE.exec(trimmed);
  if (bracket) return (bracket[1] ?? "").trim();
  if (BARE_HEADER_RE.test(trimmed)) return trimmed;
  return null;
}

function tokenizeBody(lines: string[]): RawSection[] {
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

function rechunkSlides(raw: RawSection[]): RawSection[] {
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

export const _internal = {
  splitFooter,
  extractMeta,
  extractTitle,
  stripChords,
  isHeaderLine,
  tokenizeBody,
  rechunkSlides,
};

export function parseSongSelectText(text: string): SongSelectParseResult {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines = normalized.split("\n");

  const { body, footer } = splitFooter(allLines);

  // Find where the first header is — everything before it is preamble (for title).
  let firstHeaderIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (isHeaderLine(body[i]!) !== null) {
      firstHeaderIdx = i;
      break;
    }
  }
  const preamble = firstHeaderIdx === -1 ? body : body.slice(0, firstHeaderIdx);
  const bodyAfterPreamble =
    firstHeaderIdx === -1 ? [] : body.slice(firstHeaderIdx);

  // Strip chord markers from non-header body lines.
  const strippedBody = bodyAfterPreamble.map((line) =>
    isHeaderLine(line) !== null ? line : stripChords(line),
  );

  const raw = tokenizeBody(strippedBody);
  if (raw.length === 0) {
    throw new Error("songSelect: no sections detected");
  }

  const meta = extractMeta(preamble, footer);
  const { sections, defaultArrangement } = emitSections(rechunkSlides(raw));
  return { meta, sections, defaultArrangement };
}
