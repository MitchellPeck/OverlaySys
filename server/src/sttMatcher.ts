import type { Song } from "@overlaysys/core";
import { lyricTokens } from "@overlaysys/core";

export const MIN_EMIT_THRESHOLD = 0.30;
export const AUTO_TAKE_THRESHOLD = 0.65;

/**
 * Coverage-based pre-emption: when ≥ this fraction of the current slide's
 * unique content tokens have been heard within COVERAGE_WINDOW_MS, the
 * matcher treats the current slide as "complete enough" and considers
 * advancing to the next slide. Coverage is computed over phonetically-folded
 * tokens minus stop words (see lyricTokens), so connectives like "the" and
 * "of" don't inflate the signal.
 */
export const COVERAGE_THRESHOLD = 0.55;
export const COVERAGE_WINDOW_MS = 8000;
/**
 * Skip coverage-based advance for very short slides — a 2-word slide hits
 * full coverage with a single matching token, which is too easy to false-
 * positive on similar-sounding earlier tokens.
 */
export const COVERAGE_MIN_TOKENS = 3;

/**
 * Confidence floor for an audible (section-start jump outside the cursor
 * neighborhood). Above-floor matches must also beat the best neighborhood
 * candidate by AUDIBLE_MARGIN to fire — this prevents "amazing grace"
 * (shared across verses) from teleporting on a partial hypothesis.
 */
export const AUDIBLE_THRESHOLD = 0.85;
export const AUDIBLE_MARGIN = 0.20;
export const AUDIBLE_MIN_TOKENS = 3;

interface BoundSession {
  channel: string;
  song: Song;
  arrangement: string[];
  // Sliding window of FOLDED tokens from FINAL hypotheses, with timestamps
  // for pruning. Reset on cursor move.
  recentTokens: { token: string; t: number }[];
  // Tokens from the most recent PARTIAL hypothesis. Whisper emits many
  // partials per step (\r overdraws) then one final (\n). Treating them
  // like finals would multi-count the same words; ignoring them entirely
  // means coverage only ticks up every ~500ms (whisper's step size),
  // which makes trust-mode auto-advance feel sluggish. So we keep the
  // latest partial as a single replaceable snapshot — it contributes
  // to coverage but doesn't accumulate.
  latestPartialTokens: string[];
  lastSeenCursor: { sectionIdx: number; slideIdx: number } | null;
}

export type MatchStrategy = "coverage" | "neighborhood" | "audible";

export interface MatchResult {
  sectionIdx: number;
  slideIdx: number;
  confidence: number;
  strategy: MatchStrategy;
  // Folded slide tokens that were matched against the recent window or
  // hypothesis. Empty for strategies that don't track per-token matches.
  matchedTokens: string[];
  // Coverage of the CURRENT cursor slide, [0..1]. Reported regardless of
  // which strategy fired so the operator overlay can show progress.
  coverage: number;
}

const boundSessions = new Map<string, BoundSession>();
const slideTokenCache = new Map<string, string[]>();

export function bindSession(channel: string, song: Song, arrangement: string[]): void {
  boundSessions.set(channel, {
    channel,
    song,
    arrangement: arrangement.slice(),
    recentTokens: [],
    latestPartialTokens: [],
    lastSeenCursor: null,
  });
}

export function unbindSession(channel: string): void {
  boundSessions.delete(channel);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function slideTokens(songId: string, slideId: string, lines: string[]): string[] {
  const key = `${songId}:${slideId}`;
  const cached = slideTokenCache.get(key);
  if (cached) return cached;
  const arr = lyricTokens(lines.join(" "));
  slideTokenCache.set(key, arr);
  return arr;
}

function uniqueSlideTokenSet(songId: string, slideId: string, lines: string[]): Set<string> {
  return new Set(slideTokens(songId, slideId, lines));
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
): { tokens: string[]; unique: Set<string> } | null {
  const sectionId = session.arrangement[pos.sectionIdx];
  if (!sectionId) return null;
  const section = session.song.sections.find((sec) => sec.id === sectionId);
  if (!section) return null;
  const slide = section.slides[pos.slideIdx];
  if (!slide) return null;
  const tokens = slideTokens(session.song.id, slide.id, slide.lines);
  return { tokens, unique: new Set(tokens) };
}

// ── Confidence scoring ──────────────────────────────────────────────────────
// The previous matcher used a hand-tuned linear formula per strategy.
// We keep that shape but split it so each call site is explicit about its
// inputs — easier to tune and to read in the debug overlay.

function coverageConfidence(coverage: number, hasNextHint: boolean): number {
  // Map coverage [threshold..1.0] linearly into [0.70..1.0]. Always above
  // AUTO_TAKE_THRESHOLD so coverage pre-emption can drive auto-advance —
  // that's the whole point of pre-emption (lead the band, not chase it).
  // A next-slide-token hint, when present, gives a small extra confidence
  // boost so debouncing is tighter on confirmed advances.
  const base = clamp(
    0.70 + ((coverage - COVERAGE_THRESHOLD) / (1 - COVERAGE_THRESHOLD)) * 0.25,
    0.70,
    0.95,
  );
  return clamp(base + (hasNextHint ? 0.05 : 0), 0, 1.0);
}

function overlapConfidence(
  overlap: number,
  isForwardOrAtCursor: boolean,
  sectionStart: boolean,
): number {
  const monotonicBonus = isForwardOrAtCursor ? 0.10 : -0.80;
  const sectionStartBonus = isForwardOrAtCursor && sectionStart ? 0.05 : 0;
  return clamp(overlap + monotonicBonus + sectionStartBonus, 0, 1);
}

// ── Main entry point ────────────────────────────────────────────────────────

export interface ProcessOptions {
  // Whisper-stream emits partial hypotheses (\r overdraws) followed by a
  // final segment (\n). Partials are unstable — letting them drive coverage
  // pre-emption and auto-advance means the operator screen flips as soon as
  // the recognizer's first guess covers the slide, before the band has
  // actually moved on. So we restrict partials to the neighborhood matcher
  // (operator-visible suggestion only), and leave coverage / audibles /
  // window mutation to finals. Defaults true for backward compat with
  // listeners that only emit completed lines.
  isFinal?: boolean;
}

export function processHypothesis(
  channel: string,
  hypothesisText: string,
  cursor: { sectionIdx: number; slideIdx: number },
  opts: ProcessOptions = {},
): MatchResult | null {
  const session = boundSessions.get(channel);
  if (!session) return null;

  const isFinal = opts.isFinal ?? true;
  const now = Date.now();
  const hypTokens = lyricTokens(hypothesisText);

  // ── Sliding-window bookkeeping ─────────────────────────────────────────
  // Reset on cursor move — each slide has its own coverage window.
  const cursorMoved =
    !session.lastSeenCursor ||
    session.lastSeenCursor.sectionIdx !== cursor.sectionIdx ||
    session.lastSeenCursor.slideIdx !== cursor.slideIdx;
  if (cursorMoved) {
    session.recentTokens = [];
    session.latestPartialTokens = [];
    session.lastSeenCursor = { sectionIdx: cursor.sectionIdx, slideIdx: cursor.slideIdx };
  }
  if (isFinal) {
    // Final tokens accumulate into the long-running window and the
    // partial snapshot is cleared (the final supersedes the partials of
    // the same step).
    for (const tok of hypTokens) session.recentTokens.push({ token: tok, t: now });
    session.latestPartialTokens = [];
  } else {
    // Partial REPLACES the previous partial snapshot — each partial is a
    // refinement of the same audio window, so we keep only the latest.
    session.latestPartialTokens = hypTokens;
  }
  const cutoff = now - COVERAGE_WINDOW_MS;
  session.recentTokens = session.recentTokens.filter((entry) => entry.t >= cutoff);
  // Coverage set = finals (windowed) ∪ latest partial snapshot. This gives
  // sub-step responsiveness without multi-counting overdrawn partials.
  const recentSet = new Set(session.recentTokens.map((e) => e.token));
  for (const t of session.latestPartialTokens) recentSet.add(t);

  // ── Compute coverage of current slide (always — used for telemetry) ────
  const currentSlide = getSlideTokens(session, cursor);
  let coverage = 0;
  let coveredTokens: string[] = [];
  if (currentSlide && currentSlide.unique.size > 0) {
    for (const t of currentSlide.unique) {
      if (recentSet.has(t)) coveredTokens.push(t);
    }
    coverage = coveredTokens.length / currentSlide.unique.size;
  }

  // ── Strategy 1: coverage-based pre-emption ─────────────────────────────
  // Fires for both partials and finals. Partials use the replaceable
  // snapshot so coverage can rise mid-step rather than only on the ~500ms
  // final cadence. The songSession layer applies a longer debounce on
  // partial-driven schedules so unstable refinements have time to settle.
  let coverageResult: MatchResult | null = null;
  if (
    currentSlide &&
    currentSlide.unique.size >= COVERAGE_MIN_TOKENS &&
    coverage >= COVERAGE_THRESHOLD
  ) {
    const next = resolveOffset(session, cursor.sectionIdx, cursor.slideIdx, 1);
    if (next) {
      const nextSlide = getSlideTokens(session, next);
      let hasNextHint = false;
      if (nextSlide) {
        // Tokens unique to next slide (NOT shared with current). At least
        // one of these in the recent window confirms the band has actually
        // moved on, rather than just looping the current line.
        for (const t of nextSlide.unique) {
          if (currentSlide.unique.has(t)) continue;
          if (recentSet.has(t)) {
            hasNextHint = true;
            break;
          }
        }
      }
      const confidence = coverageConfidence(coverage, hasNextHint);
      coverageResult = {
        sectionIdx: next.sectionIdx,
        slideIdx: next.slideIdx,
        confidence,
        strategy: "coverage",
        matchedTokens: coveredTokens,
        coverage,
      };
    }
  }

  // ── Strategy 2: per-hypothesis token-overlap match (cursor neighborhood) ─
  // Restricted to cursor−1, cursor, cursor+1. Worship songs share so much
  // vocabulary across verses that anything wider invites misheard-word
  // teleports. Operator-driven jumps via hotkeys (C/B/V1-3/T) bypass this
  // matcher entirely, so non-monotonic moves are still possible — just not
  // STT-driven.
  const candidates: Array<{ sectionIdx: number; slideIdx: number }> = [];
  const seen = new Set<string>();
  function addCandidate(p: { sectionIdx: number; slideIdx: number }): void {
    const key = `${p.sectionIdx}:${p.slideIdx}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(p);
  }
  for (const offset of [-1, 0, 1]) {
    const pos = resolveOffset(session, cursor.sectionIdx, cursor.slideIdx, offset);
    if (pos) addCandidate(pos);
  }

  let neighborhoodResult: MatchResult | null = null;
  let bestNeighborhoodScore = -1;

  if (hypTokens.length > 0) {
    for (const cand of candidates) {
      const sectionId = session.arrangement[cand.sectionIdx];
      if (!sectionId) continue;
      const section = session.song.sections.find((sec) => sec.id === sectionId);
      if (!section) continue;
      const slide = section.slides[cand.slideIdx];
      if (!slide) continue;
      const sUnique = uniqueSlideTokenSet(session.song.id, slide.id, slide.lines);
      let overlap = 0;
      const matched: string[] = [];
      for (const t of hypTokens) {
        if (sUnique.has(t)) {
          overlap += 1;
          matched.push(t);
        }
      }
      const overlapFrac = overlap / Math.max(1, hypTokens.length);
      const isForwardOrAtCursor =
        cand.sectionIdx > cursor.sectionIdx ||
        (cand.sectionIdx === cursor.sectionIdx && cand.slideIdx >= cursor.slideIdx);
      const conf = overlapConfidence(overlapFrac, isForwardOrAtCursor, cand.slideIdx === 0);
      if (conf > bestNeighborhoodScore) {
        bestNeighborhoodScore = conf;
        neighborhoodResult = {
          sectionIdx: cand.sectionIdx,
          slideIdx: cand.slideIdx,
          confidence: conf,
          strategy: "neighborhood",
          matchedTokens: matched,
          coverage,
        };
      }
    }
  }

  // ── Strategy 3: section audibles (operator audibled to a far section) ───
  // Only checks SECTION-START slides outside the cursor neighborhood, with
  // a strict threshold AND a margin over the best neighborhood candidate.
  // Designed for the case where the operator's pre-planned arrangement
  // doesn't match what the band is actually doing — e.g., dropping straight
  // from V1 to bridge. Audibles require finalized hypotheses; a partial
  // mid-line is too unstable to teleport on.
  let audibleResult: MatchResult | null = null;
  if (isFinal && hypTokens.length >= AUDIBLE_MIN_TOKENS) {
    const neighborhoodKeys = new Set(
      candidates.map((c) => `${c.sectionIdx}:${c.slideIdx}`),
    );
    const bestToBeat = bestNeighborhoodScore;

    for (let si = 0; si < session.arrangement.length; si++) {
      const sectionId = session.arrangement[si];
      if (!sectionId) continue;
      const section = session.song.sections.find((sec) => sec.id === sectionId);
      if (!section) continue;
      const slide = section.slides[0];
      if (!slide) continue;
      const key = `${si}:0`;
      if (neighborhoodKeys.has(key)) continue;
      const sUnique = uniqueSlideTokenSet(session.song.id, slide.id, slide.lines);
      if (sUnique.size < AUDIBLE_MIN_TOKENS) continue;
      let overlap = 0;
      const matched: string[] = [];
      for (const t of hypTokens) {
        if (sUnique.has(t)) {
          overlap += 1;
          matched.push(t);
        }
      }
      const overlapFrac = overlap / Math.max(1, hypTokens.length);
      // Audible confidence: same shape as neighborhood + section-start, but
      // gated by a strict floor and a margin over the cursor-neighborhood
      // best so it can't poach a marginally-better match.
      const conf = clamp(overlapFrac + 0.05, 0, 1);
      if (
        conf >= AUDIBLE_THRESHOLD &&
        conf >= bestToBeat + AUDIBLE_MARGIN &&
        (audibleResult === null || conf > audibleResult.confidence)
      ) {
        audibleResult = {
          sectionIdx: si,
          slideIdx: 0,
          confidence: conf,
          strategy: "audible",
          matchedTokens: matched,
          coverage,
        };
      }
    }
  }

  // ── Pick the winner ───────────────────────────────────────────────────
  // Priority is sequential, NOT by raw confidence: coverage pre-empt fires
  // forward of the cursor by design, and a perfect match against the
  // current cursor slide via the neighborhood pass would always score
  // higher than a coverage-driven jump to the *next* slide. Letting that
  // win by confidence would defeat pre-emption entirely. Order:
  //   audible (strict-threshold operator-jump) >
  //   coverage (proactive forward advance) >
  //   neighborhood (cursor-local refinement)
  if (audibleResult) return audibleResult;
  if (coverageResult) return coverageResult;
  if (neighborhoodResult && neighborhoodResult.confidence >= MIN_EMIT_THRESHOLD) {
    return neighborhoodResult;
  }
  return null;
}
