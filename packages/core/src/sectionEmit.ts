import type { Section, SectionKind, Slide } from "./song";

export interface RawSection {
  header: string;
  blocks: string[][]; // each block = lines of one slide
}

const KIND_KEYWORDS: { kind: SectionKind; keywords: string[] }[] = [
  // Order matters: more specific kinds first.
  { kind: "chorus", keywords: ["chorus"] },
  { kind: "verse", keywords: ["verse"] },
  { kind: "bridge", keywords: ["bridge"] },
  { kind: "tag", keywords: ["tag"] },
  { kind: "intro", keywords: ["intro"] },
  { kind: "outro", keywords: ["outro"] },
];

export function inferKind(header: string): SectionKind {
  const lower = header.toLowerCase();
  for (const { kind, keywords } of KIND_KEYWORDS) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower))) {
      if (lower.startsWith("pre-") || lower.startsWith("post-")) {
        return "other";
      }
      return kind;
    }
  }
  return "other";
}

const ID_PREFIX: Record<SectionKind, string> = {
  verse: "v", chorus: "c", bridge: "b", tag: "t",
  intro: "i", outro: "o", other: "x",
};

export function generateSectionId(
  kind: SectionKind,
  kindCounts: Map<SectionKind, number>,
): string {
  const n = (kindCounts.get(kind) ?? 0) + 1;
  kindCounts.set(kind, n);
  return `${ID_PREFIX[kind]}${n}`;
}

export function emitSections(raw: RawSection[]): {
  sections: Section[];
  defaultArrangement: string[];
} {
  const kindCounts = new Map<SectionKind, number>();
  const sections: Section[] = raw.map((rs) => {
    const kind = inferKind(rs.header);
    const sid = generateSectionId(kind, kindCounts);
    const slides: Slide[] =
      rs.blocks.length === 0
        ? [{ id: `${sid}s1`, lines: [""] }]
        : rs.blocks.map((lines, i) => ({ id: `${sid}s${i + 1}`, lines }));
    return { id: sid, kind, label: rs.header, slides };
  });
  return { sections, defaultArrangement: sections.map((s) => s.id) };
}
