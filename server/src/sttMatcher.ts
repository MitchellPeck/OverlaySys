import type { Song } from "@overlaysys/core";

export const MIN_EMIT_THRESHOLD = 0.30;
export const AUTO_TAKE_THRESHOLD = 0.65;

interface BoundSession {
  channel: string;
  song: Song;
  arrangement: string[];
}

export interface MatchResult {
  sectionIdx: number;
  slideIdx: number;
  confidence: number;
}

const boundSessions = new Map<string, BoundSession>();
// Cache of normalized token sets per slide id.
const slideTokenCache = new Map<string, Set<string>>();

export function bindSession(channel: string, song: Song, arrangement: string[]): void {
  boundSessions.set(channel, { channel, song, arrangement: arrangement.slice() });
  // (The token cache is keyed by `${song.id}:${slide.id}` so different songs
  // with the same slide id don't collide — no explicit invalidation needed.)
}

export function unbindSession(channel: string): void {
  boundSessions.delete(channel);
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

function slideTokens(songId: string, slideId: string, lines: string[]): Set<string> {
  const key = `${songId}:${slideId}`;
  const cached = slideTokenCache.get(key);
  if (cached) return cached;
  const tokens = new Set(normalize(lines.join(" ")));
  slideTokenCache.set(key, tokens);
  return tokens;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function processHypothesis(
  channel: string,
  hypothesisText: string,
  cursor: { sectionIdx: number; slideIdx: number },
): MatchResult | null {
  const session = boundSessions.get(channel);
  if (!session) return null;

  const { song, arrangement } = session;
  const hypTokens = normalize(hypothesisText);

  // Build candidate set: cursor-1, cursor, cursor+1, cursor+2 and first slide
  // of every section.
  const candidates = new Set<string>();
  const candidateList: Array<{ sectionIdx: number; slideIdx: number }> = [];

  function addCandidate(sectionIdx: number, slideIdx: number): void {
    if (sectionIdx < 0 || sectionIdx >= arrangement.length) return;
    const sectionId = arrangement[sectionIdx];
    if (!sectionId) return;
    const section = song.sections.find((sec) => sec.id === sectionId);
    if (!section) return;
    if (slideIdx < 0 || slideIdx >= section.slides.length) return;
    const key = `${sectionIdx}:${slideIdx}`;
    if (candidates.has(key)) return;
    candidates.add(key);
    candidateList.push({ sectionIdx, slideIdx });
  }

  // cursor-1, cursor, cursor+1, cursor+2 (may cross section boundaries)
  // Helper to resolve an absolute position given cursor + offset
  function resolveOffset(baseSectionIdx: number, baseSlideIdx: number, offset: number): Array<{ sectionIdx: number; slideIdx: number }> {
    const results: Array<{ sectionIdx: number; slideIdx: number }> = [];
    let si = baseSectionIdx;
    let sli = baseSlideIdx + offset;
    while (si >= 0 && si < arrangement.length) {
      const sectionId = arrangement[si];
      if (!sectionId) break;
      const section = song.sections.find((sec) => sec.id === sectionId);
      if (!section) break;
      if (sli >= 0 && sli < section.slides.length) {
        results.push({ sectionIdx: si, slideIdx: sli });
        break;
      } else if (sli < 0) {
        si -= 1;
        if (si < 0) break;
        const prevSectionId = arrangement[si];
        if (!prevSectionId) break;
        const prevSection = song.sections.find((sec) => sec.id === prevSectionId);
        if (!prevSection) break;
        sli = prevSection.slides.length - 1;
        results.push({ sectionIdx: si, slideIdx: sli });
        break;
      } else {
        // sli >= section.slides.length: spill to next section
        sli -= section.slides.length;
        si += 1;
      }
    }
    return results;
  }

  // Add cursor-1
  for (const c of resolveOffset(cursor.sectionIdx, cursor.slideIdx, -1)) {
    addCandidate(c.sectionIdx, c.slideIdx);
  }
  // Add cursor
  addCandidate(cursor.sectionIdx, cursor.slideIdx);
  // Add cursor+1
  for (const c of resolveOffset(cursor.sectionIdx, cursor.slideIdx, 1)) {
    addCandidate(c.sectionIdx, c.slideIdx);
  }
  // Add cursor+2
  for (const c of resolveOffset(cursor.sectionIdx, cursor.slideIdx, 2)) {
    addCandidate(c.sectionIdx, c.slideIdx);
  }

  // Add first slide of every section
  for (let si = 0; si < arrangement.length; si++) {
    addCandidate(si, 0);
  }

  // Score each candidate
  let bestScore = -1;
  let bestCandidate: { sectionIdx: number; slideIdx: number } | null = null;

  for (const cand of candidateList) {
    const sectionId = arrangement[cand.sectionIdx];
    if (!sectionId) continue;
    const section = song.sections.find((sec) => sec.id === sectionId);
    if (!section) continue;
    const slide = section.slides[cand.slideIdx];
    if (!slide) continue;

    const sTokens = slideTokens(session.song.id, slide.id, slide.lines);

    let overlap = 0;
    for (const t of hypTokens) {
      if (sTokens.has(t)) overlap++;
    }
    const tokenOverlap = overlap / Math.max(1, hypTokens.length);

    // Forward (at-or-ahead of cursor) gets a bonus; strictly backward gets a
    // penalty large enough that a perfect-overlap backward slide still scores
    // below MIN_EMIT_THRESHOLD, preventing regressions.
    const isForwardOrAtCursor =
      cand.sectionIdx > cursor.sectionIdx ||
      (cand.sectionIdx === cursor.sectionIdx && cand.slideIdx >= cursor.slideIdx);
    const monotonicBonus = isForwardOrAtCursor ? 0.10 : -0.80;

    // Section-start bonus only applies to forward candidates; it's irrelevant
    // for backward slides (we already penalize them heavily).
    const sectionStartBonus = isForwardOrAtCursor && cand.slideIdx === 0 ? 0.05 : 0;

    const score = clamp(tokenOverlap + monotonicBonus + sectionStartBonus, 0, 1);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (bestScore < MIN_EMIT_THRESHOLD || bestCandidate === null) return null;

  return {
    sectionIdx: bestCandidate.sectionIdx,
    slideIdx: bestCandidate.slideIdx,
    confidence: bestScore,
  };
}
