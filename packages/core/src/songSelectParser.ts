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

export const _internal = { splitFooter };

export function parseSongSelectText(_text: string): SongSelectParseResult {
  throw new Error("parseSongSelectText: not yet implemented");
}
