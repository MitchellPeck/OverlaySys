import { SongSchema, type Song, type Section, type Slide, type SectionKind } from "./song";

const HEADER_RE = /^\s*\[(.+?)\]\s*$/;

const KIND_KEYWORDS: { kind: SectionKind; keywords: string[] }[] = [
  // Order matters: more specific kinds first.
  { kind: "chorus", keywords: ["chorus"] },
  { kind: "verse", keywords: ["verse"] },
  { kind: "bridge", keywords: ["bridge"] },
  { kind: "tag", keywords: ["tag"] },
  { kind: "intro", keywords: ["intro"] },
  { kind: "outro", keywords: ["outro"] },
];

function inferKind(header: string): SectionKind {
  const lower = header.toLowerCase();
  // "Pre-Chorus" should NOT match "chorus" — guard with word boundary.
  for (const { kind, keywords } of KIND_KEYWORDS) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower))) {
      // pre-chorus / post-chorus etc. fall through to "other"
      if (lower.startsWith("pre-") || lower.startsWith("post-")) {
        return "other";
      }
      return kind;
    }
  }
  return "other";
}

function generateId(kind: SectionKind, kindCounts: Map<SectionKind, number>): string {
  const n = (kindCounts.get(kind) ?? 0) + 1;
  kindCounts.set(kind, n);
  const prefix: Record<SectionKind, string> = {
    verse: "v", chorus: "c", bridge: "b", tag: "t",
    intro: "i", outro: "o", other: "x",
  };
  return `${prefix[kind]}${n}`;
}

interface RawSection {
  header: string;
  blocks: string[][]; // each block = lines of one slide
}

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
      current = { header: m[1].trim(), blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current) {
      // Lines before any header — ignore.
      continue;
    }
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
  const kindCounts = new Map<SectionKind, number>();
  const sections: Section[] = raw.map((rs) => {
    const kind = inferKind(rs.header);
    const sid = generateId(kind, kindCounts);
    const slides: Slide[] = rs.blocks.length === 0
      ? [{ id: `${sid}s1`, lines: [""] }]
      : rs.blocks.map((lines, i) => ({ id: `${sid}s${i + 1}`, lines }));
    return {
      id: sid,
      kind,
      label: rs.header,
      slides,
    };
  });

  return SongSchema.parse({
    id,
    title,
    sections,
    defaultArrangement: sections.map((s) => s.id),
  });
}
