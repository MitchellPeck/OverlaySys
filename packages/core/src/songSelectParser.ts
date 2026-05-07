import type { Section } from "./song";

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

export const _internal = { splitFooter, extractMeta, extractTitle };

export function parseSongSelectText(_text: string): SongSelectParseResult {
  throw new Error("parseSongSelectText: not yet implemented");
}
