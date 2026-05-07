import type { Song, SongSessionSummary } from "@overlaysys/core";
import * as channels from "./channels";

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

function render(s: InternalSession): void {
  channels.setSongSessionSummary(s.channel, summarize(s));
  if (s.blanked) {
    // Use setActiveNull for synchronous clearing — channels.clear() has a
    // 1.5s async grace period before nulling active, which would break tests
    // that immediately check active === null after blank().
    channels.setActiveNull(s.channel);
    return;
  }
  const text = currentSlideText(s);
  if (text === null) return;
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
  render(internal);
}

export function getSession(channel: string): SongSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

export function advance(channel: string, delta: number): void {
  const s = sessions.get(channel);
  if (!s) return;
  let { sectionIdx, slideIdx } = s.cursor;
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
  s.cursor = { sectionIdx, slideIdx };
  render(s);
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
  render(s);
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
  const s = sessions.get(channel);
  if (!s) return;
  sessions.delete(channel);
  channels.setSongSessionSummary(channel, null);
  channels.clear(channel);
}

/**
 * Test helper. Drops every active session without notifying channels — used
 * by unit tests to reset state between cases.
 */
export function endAll(): void {
  for (const ch of Array.from(sessions.keys())) end(ch);
}
