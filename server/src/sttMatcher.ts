import type { Song } from "@overlaysys/core";

export const MIN_EMIT_THRESHOLD = 0.30;
export const AUTO_TAKE_THRESHOLD = 0.65;

/**
 * Coverage-based pre-emption: when ≥ this fraction of the current slide's
 * unique tokens have been heard within COVERAGE_WINDOW_MS, advance to the
 * next slide WITHOUT waiting for any next-slide tokens. This is what lets
 * the operator screen flip ahead of the band rather than chasing them.
 */
export const COVERAGE_THRESHOLD = 0.65;
export const COVERAGE_WINDOW_MS = 8000;
/**
 * Skip coverage-based advance for very short slides — a 2-word slide hits
 * full coverage with a single matching token, which is too easy to false-
 * positive on similar-sounding earlier tokens.
 */
export const COVERAGE_MIN_TOKENS = 3;

interface BoundSession {
  channel: string;
  song: Song;
  arrangement: string[];
  // Sliding window of recently-heard tokens (with timestamps for pruning).
  recentTokens: { token: string; t: number }[];
  // Reset recentTokens when the cursor moves — each slide gets its own
  // coverage window starting from zero.
  lastSeenCursor: { sectionIdx: number; slideIdx: number } | null;
}

export interface MatchResult {
  sectionIdx: number;
  slideIdx: number;
  confidence: number;
}

const boundSessions = new Map<string, BoundSession>();
const slideTokenCache = new Map<string, Set<string>>();

export function bindSession(channel: string, song: Song, arrangement: string[]): void {
  boundSessions.set(channel, {
    channel,
    song,
    arrangement: arrangement.slice(),
    recentTokens: [],
    lastSeenCursor: null,
  });
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

/**
 * Resolve the slide at `cursor + offset` along the arrangement. Returns
 * null if the offset falls outside the arrangement (e.g. last slide of
 * last section + 1).
 */
function resolveOffset(
  session: BoundSession,
  baseSectionIdx: number,
  baseSlideIdx: number,
  offset: number,
): { sectionIdx: number; slideIdx: number } | null {
  const { song, arrangement } = session;
  let si = baseSectionIdx;
  let sli = baseSlideIdx + offset;
  while (si >= 0 && si < arrangement.length) {
    const sectionId = arrangement[si];
    if (!sectionId) return null;
    const section = song.sections.find((sec) => sec.id === sectionId);
    if (!section) return null;
    if (sli >= 0 && sli < section.slides.length) {
      return { sectionIdx: si, slideIdx: sli };
    } else if (sli < 0) {
      si -= 1;
      if (si < 0) return null;
      const prevId = arrangement[si];
      if (!prevId) return null;
      const prev = song.sections.find((sec) => sec.id === prevId);
      if (!prev) return null;
      sli = prev.slides.length - 1;
      return { sectionIdx: si, slideIdx: sli };
    } else {
      sli -= section.slides.length;
      si += 1;
    }
  }
  return null;
}

function getSlideTokens(
  session: BoundSession,
  pos: { sectionIdx: number; slideIdx: number },
): Set<string> | null {
  const sectionId = session.arrangement[pos.sectionIdx];
  if (!sectionId) return null;
  const section = session.song.sections.find((sec) => sec.id === sectionId);
  if (!section) return null;
  const slide = section.slides[pos.slideIdx];
  if (!slide) return null;
  return slideTokens(session.song.id, slide.id, slide.lines);
}

export function processHypothesis(
  channel: string,
  hypothesisText: string,
  cursor: { sectionIdx: number; slideIdx: number },
): MatchResult | null {
  const session = boundSessions.get(channel);
  if (!session) return null;

  const now = Date.now();
  const hypTokens = normalize(hypothesisText);

  // ── Sliding window bookkeeping ────────────────────────────────────────────
  // Reset on cursor move — each slide has its own coverage window.
  const cursorMoved =
    !session.lastSeenCursor ||
    session.lastSeenCursor.sectionIdx !== cursor.sectionIdx ||
    session.lastSeenCursor.slideIdx !== cursor.slideIdx;
  if (cursorMoved) {
    session.recentTokens = [];
    session.lastSeenCursor = { sectionIdx: cursor.sectionIdx, slideIdx: cursor.slideIdx };
  }
  for (const tok of hypTokens) session.recentTokens.push({ token: tok, t: now });
  const cutoff = now - COVERAGE_WINDOW_MS;
  session.recentTokens = session.recentTokens.filter((entry) => entry.t >= cutoff);

  // ── Coverage-based pre-emption ────────────────────────────────────────────
  // If most of the current slide has been heard recently, advance to the
  // next slide WITHOUT waiting for next-slide tokens. This is what makes
  // auto-advance feel proactive rather than chasing the band.
  const currentSlideTokenSet = getSlideTokens(session, cursor);
  if (currentSlideTokenSet && currentSlideTokenSet.size >= COVERAGE_MIN_TOKENS) {
    const recentSet = new Set(session.recentTokens.map((e) => e.token));
    let matched = 0;
    for (const t of currentSlideTokenSet) if (recentSet.has(t)) matched++;
    const coverage = matched / currentSlideTokenSet.size;

    if (coverage >= COVERAGE_THRESHOLD) {
      const next = resolveOffset(session, cursor.sectionIdx, cursor.slideIdx, 1);
      if (next) {
        // Map coverage [0.65..1.0] → confidence [0.70..1.0]. Always clears
        // AUTO_TAKE_THRESHOLD so trust mode auto-advances on this signal.
        const confidence = clamp(
          0.70 + ((coverage - COVERAGE_THRESHOLD) / (1 - COVERAGE_THRESHOLD)) * 0.30,
          0.70,
          1.0,
        );
        return { sectionIdx: next.sectionIdx, slideIdx: next.slideIdx, confidence };
      }
    }
  }

  // ── Fallback: per-hypothesis token-overlap match ──────────────────────────
  // Used for non-monotonic jumps (band drops to bridge, calls a reprise,
  // etc.) and for low-coverage states where no pre-emption signal exists.
  const { song, arrangement } = session;
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

  for (const offset of [-1, 0, 1, 2]) {
    const pos = resolveOffset(session, cursor.sectionIdx, cursor.slideIdx, offset);
    if (pos) addCandidate(pos.sectionIdx, pos.slideIdx);
  }
  for (let si = 0; si < arrangement.length; si++) addCandidate(si, 0);

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
    for (const t of hypTokens) if (sTokens.has(t)) overlap++;
    const tokenOverlap = overlap / Math.max(1, hypTokens.length);

    const isForwardOrAtCursor =
      cand.sectionIdx > cursor.sectionIdx ||
      (cand.sectionIdx === cursor.sectionIdx && cand.slideIdx >= cursor.slideIdx);
    const monotonicBonus = isForwardOrAtCursor ? 0.10 : -0.80;
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
