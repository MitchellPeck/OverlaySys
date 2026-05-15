import type { Song, SongSessionSummary } from "@overlaysys/core";
import * as channels from "./channels";
import * as sttMatcher from "./sttMatcher";
import type { MatchResult } from "./sttMatcher";

// Channel that drives Whisper prompt biasing. Bias only follows the program
// session — preview cues shouldn't restart the recognizer.
const PROGRAM_CHANNEL = "program";

type ProgramBiasListener = (biasText: string | null) => void;
const programBiasListeners = new Set<ProgramBiasListener>();
let lastProgramBias: string | null = null;

export function onProgramBiasChange(fn: ProgramBiasListener): () => void {
  programBiasListeners.add(fn);
  return () => {
    programBiasListeners.delete(fn);
  };
}

function songBiasText(song: Song): string {
  const parts: string[] = [];
  for (const sec of song.sections) {
    for (const slide of sec.slides) {
      for (const line of slide.lines) parts.push(line);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function refreshProgramBias(): void {
  const s = sessions.get(PROGRAM_CHANNEL);
  const next = s ? songBiasText(s.song) : null;
  if (next === lastProgramBias) return;
  lastProgramBias = next;
  for (const fn of programBiasListeners) fn(next);
}

interface StartArgs {
  song: Song;
  lyricTemplateId: string;
  arrangement: string[];
  trustMode: boolean;
}

interface InternalSession {
  channel: string;
  song: Song;
  lyricTemplateId: string;
  arrangement: string[];
  cursor: { sectionIdx: number; slideIdx: number };
  blanked: boolean;
  trustMode: boolean;
  startedAt: number;
}

const sessions = new Map<string, InternalSession>();

function summarize(s: InternalSession): SongSessionSummary {
  return {
    songId: s.song.id,
    lyricTemplateId: s.lyricTemplateId,
    arrangement: s.arrangement.slice(),
    cursor: { ...s.cursor },
    blanked: s.blanked,
    trustMode: s.trustMode,
    startedAt: s.startedAt,
  };
}

function sectionAt(s: InternalSession, sectionIdx: number) {
  const sectionId = s.arrangement[sectionIdx];
  return s.song.sections.find((sec) => sec.id === sectionId) ?? null;
}

function currentSlideText(s: InternalSession): string | null {
  const sec = sectionAt(s, s.cursor.sectionIdx);
  if (!sec) return null;
  const slide = sec.slides[s.cursor.slideIdx];
  if (!slide) return null;
  return slide.lines.join("\n");
}

function render(s: InternalSession, forceMount: boolean = false): void {
  channels.setSongSessionSummary(s.channel, summarize(s));
  if (s.blanked) {
    // Use clearInternal so the renderer plays its out animation; the session
    // itself stays alive so unblank can re-mount the same slide cleanly.
    channels.clearInternal(s.channel);
    return;
  }
  const text = currentSlideText(s);
  if (text === null) return;

  // Slide advances within a single live session use update() so the same
  // template instance keeps its in-phase and the lyrics swap content
  // without replaying the entrance animation. Session start and promotion
  // pass `forceMount` so the renderer runs the previous mount's OUT and
  // the new template's IN transitions — even when the previously-active
  // template happens to be the same lyric template (e.g. starting song B
  // while song A is live and both use the same lyric template).
  if (!forceMount) {
    const current = channels.getState(s.channel).active;
    const liveMount =
      current !== null &&
      current.templateId === s.lyricTemplateId &&
      current.phase === "in";
    if (liveMount) {
      channels.update(s.channel, { text });
      return;
    }
  }
  channels.takeInternal(s.channel, s.lyricTemplateId, { text });
}

export function start(channel: string, args: StartArgs): void {
  const internal: InternalSession = {
    channel,
    song: args.song,
    lyricTemplateId: args.lyricTemplateId,
    arrangement: args.arrangement.slice(),
    cursor: { sectionIdx: 0, slideIdx: 0 },
    blanked: false,
    trustMode: args.trustMode,
    startedAt: Date.now(),
  };
  sessions.set(channel, internal);
  render(internal, /* forceMount */ true);
  sttMatcher.bindSession(channel, args.song, args.arrangement);
  if (channel === PROGRAM_CHANNEL) refreshProgramBias();
}

/**
 * Promote a session from one channel to another. If `fromChannel` has an
 * active session for the same song, copies its cursor + arrangement +
 * trustMode to a fresh session on `toChannel`, then ends the source. If
 * `fromChannel` has no matching session, starts a fresh session on
 * `toChannel` at slide 0 with the given args (the typical flow when the
 * operator double-clicks a song row to take directly to program without
 * cueing first).
 */
export function promoteTo(
  fromChannel: string,
  toChannel: string,
  args: StartArgs,
): void {
  const src = sessions.get(fromChannel);
  // Copy cursor + arrangement only if the source is for the same song.
  const reuseFromSource = src && src.song.id === args.song.id;

  const internal: InternalSession = {
    channel: toChannel,
    song: args.song,
    lyricTemplateId: args.lyricTemplateId,
    arrangement: reuseFromSource ? src.arrangement.slice() : args.arrangement.slice(),
    cursor: reuseFromSource ? { ...src.cursor } : { sectionIdx: 0, slideIdx: 0 },
    blanked: false,
    trustMode: reuseFromSource ? src.trustMode : args.trustMode,
    startedAt: Date.now(),
  };
  sessions.set(toChannel, internal);
  render(internal, /* forceMount */ true);
  sttMatcher.bindSession(toChannel, args.song, internal.arrangement);

  // End the source AFTER the destination is rendered, so there's never a
  // gap with neither channel showing the song.
  if (src) end(fromChannel);
  if (toChannel === PROGRAM_CHANNEL || fromChannel === PROGRAM_CHANNEL) {
    refreshProgramBias();
  }
}

export function getSession(channel: string): SongSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

export function advance(channel: string, delta: number): void {
  const s = sessions.get(channel);
  if (!s) return;
  const startSection = s.cursor.sectionIdx;
  const startSlide = s.cursor.slideIdx;
  let sectionIdx = startSection;
  let slideIdx = startSlide;
  let remaining = delta;

  const step = remaining > 0 ? 1 : -1;
  while (remaining !== 0) {
    const sec = sectionAt(s, sectionIdx);
    if (!sec) break;
    const nextSlide = slideIdx + step;
    if (nextSlide >= 0 && nextSlide < sec.slides.length) {
      slideIdx = nextSlide;
    } else {
      const nextSection = sectionIdx + step;
      if (nextSection < 0 || nextSection >= s.arrangement.length) break;
      sectionIdx = nextSection;
      const newSec = sectionAt(s, sectionIdx);
      if (!newSec) break;
      slideIdx = step > 0 ? 0 : newSec.slides.length - 1;
    }
    remaining -= step;
  }
  // If the cursor didn't move (operator hit advance at the last slide, or
  // back at the first), do nothing — including no re-render. Re-rendering
  // would replay the IN animation in place, which reads as a glitch.
  if (sectionIdx === startSection && slideIdx === startSlide) return;
  s.cursor = { sectionIdx, slideIdx };
  render(s, /* forceMount */ true);
}

export function jump(
  channel: string,
  sectionId: string,
  slideIdx: number = 0,
): void {
  const s = sessions.get(channel);
  if (!s) return;
  // If the section already exists in the arrangement, jump there. Otherwise
  // append it (handles "drop to bridge" audibles).
  let sectionIdx = s.arrangement.indexOf(sectionId);
  if (sectionIdx < 0) {
    if (!s.song.sections.some((sec) => sec.id === sectionId)) return;
    s.arrangement.push(sectionId);
    sectionIdx = s.arrangement.length - 1;
  }
  s.cursor = { sectionIdx, slideIdx };
  render(s, /* forceMount */ true);
}

/**
 * Resolve a section by `kind` ordinal. Used by hotkeys that don't know the
 * section id: `V2` → second section with kind === "verse".
 *   - kind: "verse" | "chorus" | "bridge" | "tag" | ...
 *   - ordinal: 1-based (V1 → ordinal 1)
 */
export function jumpByKindOrdinal(
  channel: string,
  kind: string,
  ordinal: number,
): void {
  const s = sessions.get(channel);
  if (!s) return;
  let n = 0;
  for (const sec of s.song.sections) {
    if (sec.kind === kind) {
      n += 1;
      if (n === ordinal) {
        jump(channel, sec.id);
        return;
      }
    }
  }
}

export function blank(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.blanked = !s.blanked;
  render(s);
}

export function setTrust(channel: string, trustMode: boolean): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.trustMode = trustMode;
  channels.setSongSessionSummary(channel, summarize(s));
}

export function end(channel: string): void {
  if (!tearDownSession(channel)) return;
  // Defer the songSession-cleared emit so it coalesces with the phase=out
  // emit from channels.clear. That single combined state event lets the
  // renderer distinguish "session ended" (active.phase=out) from "session
  // ended because a take replaced it" (active.phase=in, emitted by
  // channels.take's coalesced path).
  channels.setSongSessionSummary(channel, null, { deferEmit: true });
  channels.clear(channel);
}

/**
 * Tear down internal session state (timers, STT binding, session map, bias).
 * Does NOT touch channel state — the caller is responsible for clearing
 * songSession + emitting. Returns true if a session was actually torn down.
 *
 * Used by channels.take when a song session is live and the operator is
 * taking a graphic over it: the take needs the "session went away" delta and
 * the "new active mount" delta to land in a single state event so the
 * renderer's session-end stage fade doesn't hide the new template's IN
 * animation (which manifests as the new template "snapping in").
 *
 * Safe to call when no session is active (returns false).
 */
export function tearDownSession(channel: string): boolean {
  const s = sessions.get(channel);
  if (!s) return false;
  const timer = autoAdvanceTimers.get(channel);
  if (timer) {
    clearTimeout(timer);
    autoAdvanceTimers.delete(channel);
  }
  sttMatcher.unbindSession(channel);
  sessions.delete(channel);
  if (channel === PROGRAM_CHANNEL) refreshProgramBias();
  return true;
}

/**
 * Tear down the session AND publish the cleared songSession on the channel
 * state (emits). Use for end-of-song operator actions where no follow-up
 * take is coming; for the take-replaces-song flow use {@link tearDownSession}
 * so the caller can coalesce the channel update with its new active mount.
 */
export function endSessionOnly(channel: string): boolean {
  if (!tearDownSession(channel)) return false;
  channels.setSongSessionSummary(channel, null);
  return true;
}

/**
 * Test helper. Drops every active session without notifying channels — used
 * by unit tests to reset state between cases.
 */
export function endAll(): void {
  for (const ch of Array.from(sessions.keys())) end(ch);
}

// ───── STT match integration ─────────────────────────────────────────────────

export interface MatchMeta {
  // Listener-side timestamp of the originating hypothesis (ms epoch).
  hypothesisT: number;
  // Server-measured latency from `hypothesisT` to the moment the match was
  // computed. Useful for telling the operator whether the system is leading
  // the band or chasing it.
  latencyMs: number;
  // True for finalized hypotheses (whisper-stream LF), false for partials.
  isFinal: boolean;
}

type MatchListener = (
  channel: string,
  result: MatchResult | null,
  hypothesis: string,
  meta: MatchMeta,
) => void;
const matchListeners = new Set<MatchListener>();

export function onMatch(fn: MatchListener): () => void {
  matchListeners.add(fn);
  return () => {
    matchListeners.delete(fn);
  };
}

const autoAdvanceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Pick a debounce delay based on match confidence AND whether the source
 * was a final or partial hypothesis. Partials use a longer safety window
 * so unstable refinements have time to settle; finals snap quickly. The
 * combined effect: trust mode reacts mid-step (no waiting for the ~500ms
 * whisper final cadence) while still resisting spurious early fires.
 */
function debounceDelayMs(confidence: number, isFinal: boolean): number {
  if (isFinal) {
    if (confidence >= 0.90) return 80;
    if (confidence >= 0.75) return 140;
    return 220;
  }
  // Partial — add a settling cushion. A newer partial/final within this
  // window will replace this timer (scheduleAutoAdvance always cancels
  // the existing timer before installing a new one).
  if (confidence >= 0.90) return 250;
  if (confidence >= 0.75) return 320;
  return 400;
}

function scheduleAutoAdvance(channel: string, target: MatchResult, isFinal: boolean): void {
  const existing = autoAdvanceTimers.get(channel);
  if (existing) clearTimeout(existing);
  const delay = debounceDelayMs(target.confidence, isFinal);
  const timer = setTimeout(() => {
    autoAdvanceTimers.delete(channel);
    const s = sessions.get(channel);
    if (!s) return;
    // Re-check: cursor may have moved during the debounce. Only advance if
    // the target is still forward of the (possibly updated) cursor.
    const stillForward =
      target.sectionIdx > s.cursor.sectionIdx ||
      (target.sectionIdx === s.cursor.sectionIdx && target.slideIdx > s.cursor.slideIdx);
    if (!stillForward) return;
    s.cursor = { sectionIdx: target.sectionIdx, slideIdx: target.slideIdx };
    // Re-mount so the renderer plays OUT/IN, matching manual advance().
    // The debounce above already coalesces rapid partials, so this fires
    // at most once per settled hypothesis — no cascade of re-mounts.
    render(s, /* forceMount */ true);
  }, delay);
  autoAdvanceTimers.set(channel, timer);
}

export function processSttHypothesis(
  channel: string,
  text: string,
  hypothesisT: number,
  isFinal: boolean = true,
): void {
  const s = sessions.get(channel);
  if (!s) return;
  const result = sttMatcher.processHypothesis(channel, text, s.cursor, { isFinal });
  const latencyMs = Math.max(0, Date.now() - hypothesisT);
  const meta: MatchMeta = { hypothesisT, latencyMs, isFinal };
  // Always emit stt_match (even null) so the UI can clear stale highlights.
  for (const fn of matchListeners) fn(channel, result, text, meta);
  if (!result) return;

  // Both partials and finals can schedule auto-advance. Each subsequent
  // hypothesis cancels the prior timer (scheduleAutoAdvance does this for
  // us), so an unstable partial that gets revised before its longer
  // debounce expires is harmlessly replaced. Finals snap fast; partials
  // pay a cushion. See debounceDelayMs.
  if (s.trustMode && result.confidence >= sttMatcher.AUTO_TAKE_THRESHOLD) {
    // Only auto-advance if the candidate is monotonically forward (strictly ahead).
    const isForward =
      result.sectionIdx > s.cursor.sectionIdx ||
      (result.sectionIdx === s.cursor.sectionIdx && result.slideIdx > s.cursor.slideIdx);
    if (isForward) scheduleAutoAdvance(channel, result, isFinal);
  }
}

export function getChannelsWithSessions(): string[] {
  return Array.from(sessions.keys());
}
