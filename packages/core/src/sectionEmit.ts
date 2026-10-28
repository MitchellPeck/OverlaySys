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
  const sections: Section[] = [];
  const defaultArrangement: string[] = [];
  const byHeader = new Map<string, string>();
  for (const rs of raw) {
    const key = rs.header.trim().toLowerCase();
    const earlier = byHeader.get(key);
    // A repeated header with no body means "sing that section again":
    // reference the earlier section instead of creating an empty one.
    if (rs.blocks.length === 0 && earlier !== undefined) {
      defaultArrangement.push(earlier);
      continue;
    }
    const kind = inferKind(rs.header);
    const sid = generateSectionId(kind, kindCounts);
    const slides: Slide[] =
      rs.blocks.length === 0
        ? [{ id: `${sid}s1`, lines: [""] }]
        : rs.blocks.map((lines, i) => ({ id: `${sid}s${i + 1}`, lines }));
    sections.push({ id: sid, kind, label: rs.header, slides });
    defaultArrangement.push(sid);
    if (!byHeader.has(key)) byHeader.set(key, sid);
  }
  return { sections, defaultArrangement };
}

/** Sections whose every slide is blank lines (nothing to show). */
export function emptySections(sections: Section[]): Section[] {
  return sections.filter((sec) =>
    sec.slides.every((sl) => sl.lines.every((l) => l.trim() === "")),
  );
}
