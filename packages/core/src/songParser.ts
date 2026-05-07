import { SongSchema, type Song } from "./song";
import { emitSections, type RawSection } from "./sectionEmit";

const HEADER_RE = /^\s*\[(.+?)\]\s*$/;

function tokenize(text: string): RawSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
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
    if (!current) continue;
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  return sections;
}

export function parseSongFromText(
  id: string,
  title: string,
  text: string,
): Song {
  const raw = tokenize(text);
  if (raw.length === 0) {
    throw new Error("song text contains no [Section] headers");
  }
  const { sections, defaultArrangement } = emitSections(raw);
  return SongSchema.parse({ id, title, sections, defaultArrangement });
}
