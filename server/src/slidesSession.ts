import type { DeckLicensing, ResolvedSlide, SlidesSessionSummary, Template } from "@overlaysys/core";
import { slideTextLines } from "@overlaysys/core";
import * as channels from "./channels";
import { recordSongUse } from "./songUsage";
import * as songSession from "./songSession";

export type StartArgs = {
  showId: string;
  rowId: string;
  deckId?: string;
  title: string;
  slides: ResolvedSlide[];
  licensing: DeckLicensing | null;
  templates: Map<string, Template>;
};

interface Session {
  channel: string;
  args: StartArgs;
  idx: number;
  blanked: boolean;
  atEnd: boolean;
}

const sessions = new Map<string, Session>();

function summarize(s: Session): SlidesSessionSummary {
  const { slides, templates } = s.args;
  const cur = slides[s.idx]!;
  const last = slides.length - 1;
  const next = s.idx < last ? slides[s.idx + 1] : undefined;
  return {
    rowId: s.args.rowId,
    ...(s.args.deckId ? { deckId: s.args.deckId } : {}),
    title: s.args.title,
    slideIdx: s.idx,
    slideCount: slides.length,
    ...(cur.label ? { label: cur.label } : {}),
    lines: slideTextLines(cur.data, templates.get(cur.templateId)),
    ...(next
      ? {
          nextLines: slideTextLines(next.data, templates.get(next.templateId)),
          ...(next.label ? { nextLabel: next.label } : {}),
        }
      : {}),
    blanked: s.blanked,
    atEnd: s.atEnd,
  };
}

function render(s: Session, forceMount: boolean): void {
  channels.setSlidesSessionSummary(s.channel, summarize(s), { deferEmit: true });
  if (s.blanked) {
    // Out animation plays; the session stays alive so unblank can re-show.
    channels.clearInternal(s.channel);
    channels.setSlidesSessionSummary(s.channel, summarize(s));
    return;
  }
  const slide = s.args.slides[s.idx]!;
  const cur = channels.getState(s.channel).active;
  if (!forceMount && cur && cur.templateId === slide.templateId && cur.phase === "in") {
    channels.update(s.channel, slide.data);
    return;
  }
  channels.takeInternal(s.channel, slide.templateId, slide.data);
}

function noteUse(args: StartArgs, channel: string): void {
  if (channel === "preview" || args.licensing?.kind !== "ccli") return;
  void recordSongUse(
    { id: args.deckId ?? args.rowId, title: args.title, ccliNumber: args.licensing.ccliNumber },
    channel,
  );
}

export function start(channel: string, args: StartArgs, slideIdx = 0): boolean {
  if (args.slides.length === 0 || !Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= args.slides.length) {
    return false;
  }
  // A song session on this channel (STT binding, timers) must not outlive the takeover.
  songSession.endSessionOnly(channel);
  songSession.clearQueued(channel);
  const s: Session = { channel, args, idx: slideIdx, blanked: false, atEnd: false };
  sessions.set(channel, s);
  render(s, true);
  channels.setLiveRow(channel, { showId: args.showId, rowId: args.rowId });
  noteUse(args, channel);
  return true;
}

export function advance(channel: string, delta: -1 | 1): void {
  const s = sessions.get(channel);
  if (!s) return;
  const last = s.args.slides.length - 1;
  if (delta > 0) {
    if (s.idx < last) {
      s.idx += 1;
      s.atEnd = false;
    } else if (!s.atEnd) {
      s.atEnd = true;
      channels.setSlidesSessionSummary(channel, summarize(s));
      return;
    } else {
      end(channel);
      return;
    }
  } else {
    const next = Math.max(0, s.idx - 1);
    if (next === s.idx && !s.atEnd) return;
    s.idx = next;
    s.atEnd = false;
  }
  const wasBlanked = s.blanked;
  s.blanked = false;
  render(s, wasBlanked);
}

export function goTo(channel: string, slideIdx: number): boolean {
  const s = sessions.get(channel);
  if (!s || !Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= s.args.slides.length) return false;
  const wasBlanked = s.blanked;
  s.idx = slideIdx;
  s.atEnd = false;
  s.blanked = false;
  render(s, wasBlanked);
  return true;
}

export function blank(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.blanked = !s.blanked;
  render(s, true);
}

export function end(channel: string): void {
  if (!sessions.delete(channel)) return;
  channels.setSlidesSessionSummary(channel, null, { deferEmit: true });
  channels.clear(channel);
  // Blanked: active is already null so clear() emitted nothing.
  if (!channels.getState(channel).active) channels.setSlidesSessionSummary(channel, null);
}

export function promote(from: string, to: string): boolean {
  const src = sessions.get(from);
  if (!src) return false;
  const s: Session = { channel: to, args: src.args, idx: src.idx, blanked: false, atEnd: src.atEnd };
  sessions.set(to, s);
  render(s, true);
  channels.setLiveRow(to, { showId: s.args.showId, rowId: s.args.rowId });
  noteUse(s.args, to);
  // End the source after the destination is on air.
  end(from);
  return true;
}

export function getSession(channel: string): SlidesSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

/** Forget the session without touching channel state (external take/clear). */
export function dropAll(channel: string): boolean {
  return sessions.delete(channel);
}

export function resetAll(): void {
  sessions.clear();
}
