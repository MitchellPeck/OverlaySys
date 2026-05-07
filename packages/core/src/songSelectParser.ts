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

export function parseSongSelectText(_text: string): SongSelectParseResult {
  throw new Error("parseSongSelectText: not yet implemented");
}
