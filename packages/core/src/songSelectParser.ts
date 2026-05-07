import type { Section } from "./song";
import type { RawSection } from "./sectionEmit";

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
      return { body: lines.slice(0, i), footer: lines.slice(i) };
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

  // Track which footer line contains ©, then the line above it (if any) is
  // the author line, when it contains alpha content.
  let copyrightIdx = -1;
  for (let i = 0; i < footer.length; i++) {
    const line = footer[i]!.trim();
    if (CCLI_LICENSE_RE.test(line)) continue; // explicitly ignored
    const ccli = CCLI_SONG_RE.exec(line);
    if (ccli && !meta.ccliNumber) meta.ccliNumber = ccli[1];
    if (line.startsWith("©") && copyrightIdx === -1) {
      copyrightIdx = i;
      meta.copyright = line;
    }
  }

  // Author line: line directly above copyright, if it contains letters.
  if (copyrightIdx > 0) {
    const candidate = footer[copyrightIdx - 1]!.trim();
    const isAuthorish =
      candidate &&
      /[A-Za-z]/.test(candidate) &&
      !CCLI_SONG_RE.test(candidate) &&
      !CCLI_LICENSE_RE.test(candidate);
    if (isAuthorish) {
      meta.authors = candidate.includes(" | ")
        ? candidate.split(" | ").map((s) => s.trim()).filter(Boolean)
        : [candidate];
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

export const _internal = {
  splitFooter,
  extractMeta,
  extractTitle,
  stripChords,
  isHeaderLine,
  tokenizeBody,
};

export function parseSongSelectText(_text: string): SongSelectParseResult {
  throw new Error("parseSongSelectText: not yet implemented");
}
