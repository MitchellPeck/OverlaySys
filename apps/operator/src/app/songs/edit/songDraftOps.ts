import type { Section, SectionKind, Slide, Song } from "@overlaysys/core";

// Pure helpers behind the song editor page and SongDraftEditor.

export const SECTION_ID_PREFIX: Record<SectionKind, string> = {
  verse: "v",
  chorus: "c",
  bridge: "b",
  tag: "tag",
  intro: "intro",
  outro: "outro",
  other: "s",
};

const KIND_NAME: Record<SectionKind, string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  tag: "Tag",
  intro: "Intro",
  outro: "Outro",
  other: "Section",
};

const AUTO_LABEL = /^(Verse|Chorus|Bridge|Tag|Intro|Outro|Other|Section)(?: (\d+))?$/;

/** `label`, or `label 2`, `label 3`… when another section already has it. */
export function uniqueLabel(song: Song, label: string, exceptId?: string): string {
  const taken = new Set(song.sections.filter((s) => s.id !== exceptId).map((s) => s.label));
  if (!taken.has(label)) return label;
  let n = 2;
  while (taken.has(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}

/** Append a new one-slide section of `kind` to sections and the arrangement. */
export function addSongSection(song: Song, kind: SectionKind): { song: Song; sectionId: string } {
  const prefix = SECTION_ID_PREFIX[kind];
  let n = song.sections.filter((s) => s.kind === kind).length + 1;
  let id = `${prefix}${n}`;
  while (song.sections.some((s) => s.id === id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  const section: Section = {
    id,
    kind,
    label: uniqueLabel(song, `${KIND_NAME[kind]} ${n}`),
    slides: [{ id: `${id}s1`, lines: [""] }],
  };
  return {
    song: {
      ...song,
      sections: [...song.sections, section],
      defaultArrangement: [...(song.defaultArrangement ?? []), id],
    },
    sectionId: id,
  };
}

/** Section ids that never appear in the default arrangement, in song order. */
export function sectionsNotInArrangement(song: Song): string[] {
  const used = new Set(song.defaultArrangement ?? []);
  return song.sections.filter((s) => !used.has(s.id)).map((s) => s.id);
}

export function appendToArrangement(song: Song, sectionId: string): Song {
  return { ...song, defaultArrangement: [...(song.defaultArrangement ?? []), sectionId] };
}

export function moveArrangementChip(song: Song, from: number, to: number): Song {
  const arr = (song.defaultArrangement ?? []).slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) {
    return { ...song, defaultArrangement: arr };
  }
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item as string);
  return { ...song, defaultArrangement: arr };
}

export function removeArrangementAt(song: Song, index: number): Song {
  return {
    ...song,
    defaultArrangement: (song.defaultArrangement ?? []).filter((_, i) => i !== index),
  };
}

/** Change a section's kind; relabel only when the label was auto-generated. */
export function setSectionKind(song: Song, sectionId: string, kind: SectionKind): Song {
  const sections = song.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;
    const m = AUTO_LABEL.exec(sec.label);
    if (!m) return { ...sec, kind };
    const base = KIND_NAME[kind];
    const label = uniqueLabel(song, m[2] ? `${base} ${m[2]}` : base, sectionId);
    return { ...sec, kind, label };
  });
  return { ...song, sections };
}

/** First non-empty line of the section's slides, "" if none. */
export function firstLine(section: Section): string {
  for (const slide of section.slides) {
    for (const line of slide.lines) if (line.trim() !== "") return line;
  }
  return "";
}

export type RemovedSlide = { sectionId: string; index: number; slide: Slide };

/** Remove a slide (never a section's last one: the schema needs at least 1). */
export function removeSlide(
  song: Song,
  sectionId: string,
  slideId: string,
): { song: Song; removed: RemovedSlide | null } {
  const sec = song.sections.find((s) => s.id === sectionId);
  const index = sec ? sec.slides.findIndex((sl) => sl.id === slideId) : -1;
  if (!sec || index < 0 || sec.slides.length <= 1) return { song, removed: null };
  const slide = sec.slides[index] as Slide;
  return {
    song: {
      ...song,
      sections: song.sections.map((s) =>
        s.id === sectionId ? { ...s, slides: s.slides.filter((_, i) => i !== index) } : s,
      ),
    },
    removed: { sectionId, index, slide },
  };
}

export function restoreSlide(song: Song, removed: RemovedSlide): Song {
  return {
    ...song,
    sections: song.sections.map((s) => {
      if (s.id !== removed.sectionId) return s;
      const slides = s.slides.slice();
      slides.splice(Math.min(removed.index, slides.length), 0, removed.slide);
      return { ...s, slides };
    }),
  };
}

export type RemovedSection = { index: number; section: Section; arrangementIdx: number[] };

/** Remove a section and every arrangement entry that points at it. */
export function removeSection(
  song: Song,
  sectionId: string,
): { song: Song; removed: RemovedSection } {
  const index = song.sections.findIndex((s) => s.id === sectionId);
  const section = song.sections[index] as Section;
  const arrangement = song.defaultArrangement ?? [];
  const arrangementIdx: number[] = [];
  arrangement.forEach((id, i) => {
    if (id === sectionId) arrangementIdx.push(i);
  });
  if (index < 0) return { song, removed: { index, section, arrangementIdx } };
  return {
    song: {
      ...song,
      sections: song.sections.filter((_, i) => i !== index),
      defaultArrangement: arrangement.filter((id) => id !== sectionId),
    },
    removed: { index, section, arrangementIdx },
  };
}

export function restoreSection(song: Song, removed: RemovedSection): Song {
  if (removed.index < 0) return song;
  const sections = song.sections.slice();
  sections.splice(Math.min(removed.index, sections.length), 0, removed.section);
  const arrangement = (song.defaultArrangement ?? []).slice();
  for (const i of removed.arrangementIdx) {
    arrangement.splice(Math.min(i, arrangement.length), 0, removed.section.id);
  }
  return { ...song, sections, defaultArrangement: arrangement };
}

export function slideText(slide: Slide): string {
  return slide.lines.join("\n");
}

/** Split on newlines, drop trailing blank lines; `[""]` when nothing is left. */
export function linesFromText(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines.length > 0 ? lines : [""];
}

/**
 * Id for a new slide appended to `section`: `${section.id}s<N>` with the
 * first N (starting at slides.length + 1) that no slide in the song uses.
 * Counting alone reuses a live id after a delete (s1,s2,s3 → delete s2 →
 * add → "s3" again), which collides as a React key and moves focus.
 */
export function nextSlideId(song: Pick<Song, "sections">, section: Section): string {
  const taken = new Set<string>();
  for (const sec of song.sections) for (const sl of sec.slides) taken.add(sl.id);
  for (const sl of section.slides) taken.add(sl.id);
  let n = section.slides.length + 1;
  while (taken.has(`${section.id}s${n}`)) n += 1;
  return `${section.id}s${n}`;
}

/** Move `arr[from]` one step up (-1) or down (+1). Out-of-range is a no-op copy. */
export function moveByOne<T>(arr: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  const next = arr.slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// ── Save / echo bookkeeping for the song editor page ─────────────────────────

/** Song content, ignoring the server-stamped write metadata. */
export function songContentKey(song: Song): string {
  const { updatedAt: _u, deletedAt: _d, ...rest } = song;
  void _u;
  void _d;
  return JSON.stringify(rest);
}

export function sameSongContent(a: Song | null | undefined, b: Song | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a === b || songContentKey(a) === songContentKey(b);
}

/**
 * What the editor does with a copy of its song that arrived from the server
 * (a load reply, its own save echo, or another client's save):
 *  - "adopt": take it as both draft and baseline (nothing local to lose);
 *  - "rebase": content matches what we have — move the baseline only;
 *  - "conflict": the user has unsaved edits and someone else changed the
 *    song — ask before overwriting.
 */
export type IncomingDecision = "adopt" | "rebase" | "conflict";

export function decideIncomingSong(
  state: { draft: Song | null; baseline: Song | null },
  incoming: Song,
): IncomingDecision {
  const { draft, baseline } = state;
  if (!draft || !baseline) return "adopt";
  // Our own save echo (or an identical save elsewhere): nothing changed.
  if (sameSongContent(incoming, baseline) || sameSongContent(incoming, draft)) return "rebase";
  const dirty = !sameSongContent(draft, baseline);
  return dirty ? "conflict" : "adopt";
}

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; reason: string };

/** How long to wait for the server's save ack before reporting failure. */
export const SAVE_ACK_TIMEOUT_MS = 8000;
