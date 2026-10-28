import type { SectionKind, Song, SongSessionSummary } from "@overlaysys/core";

type Sections = Pick<Song, "sections">["sections"];

/**
 * Slides to advance (negative = back) to land on slide 1 of arrangement entry
 * `targetIdx`. Lets the operator pick a specific occurrence of a repeated
 * section (the second chorus, not the first) with one `song_advance`, since
 * `song_jump` only names a section id. Null when a section the walk crosses
 * isn't in the song (the server's advance stops there too).
 */
export function slideDeltaTo(
  arrangement: string[],
  sections: Sections,
  cursor: SongSessionSummary["cursor"],
  targetIdx: number,
): number | null {
  const slidesAt = (i: number): number | null => {
    const sec = sections.find((s) => s.id === arrangement[i]);
    return sec ? sec.slides.length : null;
  };
  if (targetIdx < 0 || targetIdx >= arrangement.length) return null;
  if (targetIdx === cursor.sectionIdx) return -cursor.slideIdx;
  if (targetIdx > cursor.sectionIdx) {
    const here = slidesAt(cursor.sectionIdx);
    if (here == null) return null;
    let delta = here - cursor.slideIdx;
    for (let i = cursor.sectionIdx + 1; i < targetIdx; i++) {
      const n = slidesAt(i);
      if (n == null) return null;
      delta += n;
    }
    return delta;
  }
  let delta = -cursor.slideIdx;
  for (let i = cursor.sectionIdx - 1; i >= targetIdx; i--) {
    const n = slidesAt(i);
    if (n == null) return null;
    delta -= n;
  }
  return delta;
}

/**
 * Whether the arrangement holds the `ordinal`-th (1-based) section of `kind`
 * that exists in the song; the C/B/T and 1-9 keys use it to skip dead jumps.
 */
export function sectionAvailable(
  song: Pick<Song, "sections">,
  arrangement: string[],
  kind: SectionKind,
  ordinal: number,
): boolean {
  let n = 0;
  for (const id of arrangement) {
    if (song.sections.find((s) => s.id === id)?.kind === kind && ++n >= ordinal) return true;
  }
  return false;
}

/** The next `count` slides after the cursor, in arrangement order. */
export function upcomingSlides(
  arrangement: string[],
  sections: Sections,
  cursor: SongSessionSummary["cursor"],
  count: number,
): { label: string; lines: string[] }[] {
  const items: { label: string; lines: string[] }[] = [];
  let { sectionIdx, slideIdx } = cursor;
  const step = () => {
    const sec = sections.find((s) => s.id === arrangement[sectionIdx]);
    if (sec && slideIdx + 1 < sec.slides.length) slideIdx += 1;
    else {
      sectionIdx += 1;
      slideIdx = 0;
    }
  };
  step(); // the cursor's own slide is already on screen
  while (items.length < count && sectionIdx < arrangement.length) {
    const sec = sections.find((s) => s.id === arrangement[sectionIdx]);
    if (!sec) break;
    const slide = sec.slides[slideIdx];
    if (!slide) break;
    items.push({ label: `${sec.label} · slide ${slideIdx + 1}`, lines: slide.lines });
    step();
  }
  return items;
}

/** localStorage flag that shows the STT matcher's internals (strategy, coverage, latency). */
export const STT_DEBUG_KEY = "overlaysys:sttDebug";

export function sttDebugEnabled(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(STT_DEBUG_KEY) === "1";
}
