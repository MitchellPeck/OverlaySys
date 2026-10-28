import { SongSchema, type Song } from "./song";
import { emitSections, type RawSection } from "./sectionEmit";

const HEADER_RE = /^\s*\[(.+?)\]\s*$/;

function tokenize(text: string): {
  sections: RawSection[];
  headerless: boolean;
} {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let buffer: string[] = [];
  // Lines seen before any header; become "Intro" (or "Verse 1" if no header at all).
  let orphan: RawSection | null = null;

  function flushSlide() {
    const target = current ?? orphan;
    if (!target) return;
    if (buffer.length === 0) return;
    target.blocks.push(buffer);
    buffer = [];
  }

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      flushSlide();
      if (current) sections.push(current);
      current = { header: (m[1] ?? "").trim(), blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current && !orphan) orphan = { header: "Intro", blocks: [] };
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  if (orphan) {
    if (sections.length === 0) {
      orphan.header = "Verse 1";
      return { sections: [orphan], headerless: true };
    }
    sections.unshift(orphan);
  }
  return { sections, headerless: false };
}

export type SongTextParse = { song: Song; notice: string | null };

export const HEADERLESS_NOTICE =
  "No section headers found, so everything was imported as Verse 1. Add [Verse 1], [Chorus] headers to split it.";

export function parseSongTextWithNotice(
  id: string,
  title: string,
  text: string,
): SongTextParse {
  if (text.trim() === "") throw new Error("Paste some lyrics first.");
  const { sections: raw, headerless } = tokenize(text);
  const { sections, defaultArrangement } = emitSections(raw);
  const song = SongSchema.parse({ id, title, sections, defaultArrangement });
  return { song, notice: headerless ? HEADERLESS_NOTICE : null };
}

export function parseSongFromText(
  id: string,
  title: string,
  text: string,
): Song {
  return parseSongTextWithNotice(id, title, text).song;
}
