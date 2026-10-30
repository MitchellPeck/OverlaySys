import type { DeckLicensing, ResolvedSlide, SlidesSessionSummary, Template } from "@overlaysys/core";
import { slideAirData, slideTextLines } from "@overlaysys/core";
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
  /** Auto-advance: seconds each slide holds (undefined waits for the operator), and whether the deck wraps. */
  timing?: {
    holdSecs: (number | undefined)[];
    loop: boolean;
    /** Video slides that move on when the video ends (as in a media-only deck) instead of on a hold. */
    advanceOnEnd?: boolean[];
  };
};

interface Session {
  channel: string;
  args: StartArgs;
  idx: number;
  blanked: boolean;
  atEnd: boolean;
  /** The timer (not the operator) reached the end of a non-looping deck. */
  autoEnded: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  nextAdvanceAt?: number;
  /** takenAt of the video this session put on air, so only its own "ended" advances. */
  mediaTakenAt?: number;
  /** This playthrough already advanced; cleared by a new take or a "playing" report. */
  playthroughEnded?: boolean;
}

const PREVIEW = "preview";

const sessions = new Map<string, Session>();

const loops = (s: Session): boolean => s.args.timing?.loop === true;

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
    ...(s.nextAdvanceAt !== undefined ? { nextAdvanceAt: s.nextAdvanceAt } : {}),
    loops: loops(s),
    slot: "graphics",
    ...(s.autoEnded ? { autoEnded: true } : {}),
  };
}

function stopTimer(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  delete s.nextAdvanceAt;
}

/** (Re)start the current slide's hold. Never on preview, while blanked, or at the end. */
function arm(s: Session): void {
  stopTimer(s);
  if (s.channel === PREVIEW || s.blanked || s.atEnd || advancesOnEnd(s)) return;
  const sec = s.args.timing?.holdSecs[s.idx];
  if (sec === undefined || !(sec > 0)) return;
  const ms = sec * 1000;
  s.nextAdvanceAt = Date.now() + ms;
  s.timer = setTimeout(() => {
    s.timer = null;
    delete s.nextAdvanceAt;
    if (sessions.get(s.channel) !== s) return;
    guardedAutoAdvance(s);
  }, ms);
}

/** The current slide is a video that moves on when it ends. */
function advancesOnEnd(s: Session): boolean {
  return s.args.slides[s.idx]?.media?.mediaType === "video" && s.args.timing?.advanceOnEnd?.[s.idx] === true;
}

/** Auto-advance (timer or a video's end); a failure holds the slide on air instead of crashing. */
function guardedAutoAdvance(s: Session): void {
  const onAir = s.idx;
  try {
    autoAdvance(s);
  } catch (err) {
    // Never leave a timer re-firing a failing render on air: hold here until the operator moves.
    stopTimer(s);
    console.warn("[slidesSession] auto-advance failed", err);
    // Back to the slide actually on air, so the summary and the next step agree with the screen.
    s.idx = onAir;
    try {
      channels.setSlidesSessionSummary(s.channel, summarize(s));
    } catch (e) {
      console.warn("[slidesSession] summary after a failed auto-advance failed", e);
    }
  }
}

/** The hold ran out: next slide, wrap when the deck loops, else hold the last slide at the end. */
function autoAdvance(s: Session): void {
  if (s.idx < s.args.slides.length - 1) {
    s.idx += 1;
  } else if (loops(s)) {
    s.idx = 0;
  } else {
    s.atEnd = true;
    s.autoEnded = true;
    channels.setSlidesSessionSummary(s.channel, summarize(s));
    return;
  }
  arm(s);
  render(s, false);
}

/** Marks the media this session's photo/video slides put in the media slot. */
const mediaOwner = (s: Session): string => `slidesDeck:${s.args.rowId}`;

/** True while the channel's media slot still shows what this session put there. */
function ownsMedia(s: Session): boolean {
  return channels.getState(s.channel).media?.owner === mediaOwner(s);
}

/** Take this session's media off air; media someone else took since is left alone. */
function releaseMedia(s: Session): void {
  if (ownsMedia(s)) channels.mediaClear(s.channel);
}

/** A photo/video slide airs full-frame in the media slot (beneath graphics); the deck's graphic goes. */
function renderMedia(s: Session, media: NonNullable<ResolvedSlide["media"]>, label: string | undefined): void {
  channels.mediaTake(s.channel, {
    rowId: s.args.rowId,
    assetUrl: media.assetUrl,
    ...(label !== undefined ? { label } : {}),
    volume: 1,
    endAction: "hold",
    mediaType: media.mediaType,
    ...(media.fit ? { fit: media.fit } : {}),
    ...(media.position ? { position: media.position } : {}),
    loop: false,
    muted: media.muted === true,
    owner: mediaOwner(s),
  });
  s.mediaTakenAt = channels.getState(s.channel).media?.takenAt;
  s.playthroughEnded = false;
  const cur = channels.getState(s.channel).active;
  if (cur && cur.phase !== "out") channels.clearInternal(s.channel);
}

function render(s: Session, forceMount: boolean): void {
  channels.setSlidesSessionSummary(s.channel, summarize(s), { deferEmit: true });
  if (s.blanked) {
    // Out animation plays; the session stays alive so unblank can re-show.
    releaseMedia(s);
    channels.clearInternal(s.channel);
    channels.setSlidesSessionSummary(s.channel, summarize(s));
    return;
  }
  const slide = s.args.slides[s.idx]!;
  if (slide.media) {
    renderMedia(s, slide.media, slide.label);
    return;
  }
  releaseMedia(s);
  // Unsupplied text fields go out as "": the design's sample text never airs.
  const data = slideAirData(slide.data, s.args.templates.get(slide.templateId));
  const cur = channels.getState(s.channel).active;
  if (!forceMount && cur && cur.templateId === slide.templateId && cur.phase === "in") {
    channels.update(s.channel, data);
    return;
  }
  channels.takeInternal(s.channel, slide.templateId, data);
}

function noteUse(args: StartArgs, channel: string): void {
  if (channel === "preview" || args.licensing?.kind !== "ccli") return;
  void recordSongUse(
    { id: args.deckId ?? args.rowId, title: args.title, ccliNumber: args.licensing.ccliNumber },
    channel,
  );
}

/** A new session takes over `channel`: the old one's timer stops, and its media goes unless `first` airs media anyway. */
function replaced(channel: string, first: ResolvedSlide): void {
  const prev = sessions.get(channel);
  if (!prev) return;
  stopTimer(prev);
  if (!first.media) releaseMedia(prev);
}

export function start(channel: string, args: StartArgs, slideIdx = 0): boolean {
  if (args.slides.length === 0 || !Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= args.slides.length) {
    return false;
  }
  // A song session on this channel (STT binding, timers) must not outlive the takeover.
  songSession.endSessionOnly(channel);
  songSession.clearQueued(channel);
  replaced(channel, args.slides[slideIdx]!);
  const s: Session = { channel, args, idx: slideIdx, blanked: false, atEnd: false, autoEnded: false, timer: null };
  sessions.set(channel, s);
  arm(s);
  render(s, true);
  channels.setLiveRow(channel, { showId: args.showId, rowId: args.rowId });
  noteUse(args, channel);
  return true;
}

export function advance(channel: string, delta: -1 | 1): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.autoEnded = false;
  const last = s.args.slides.length - 1;
  if (delta > 0) {
    if (s.idx < last) {
      s.idx += 1;
      s.atEnd = false;
    } else if (loops(s)) {
      s.idx = 0;
      s.atEnd = false;
    } else if (!s.atEnd) {
      s.atEnd = true;
      stopTimer(s);
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
  arm(s);
  render(s, wasBlanked);
}

export function goTo(channel: string, slideIdx: number): boolean {
  const s = sessions.get(channel);
  if (!s || !Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= s.args.slides.length) return false;
  const wasBlanked = s.blanked;
  s.autoEnded = false;
  s.idx = slideIdx;
  s.atEnd = false;
  s.blanked = false;
  arm(s);
  render(s, wasBlanked);
  return true;
}

export function blank(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.blanked = !s.blanked;
  // Blanked holds the deck where it is; showing it again restarts the slide's hold.
  arm(s);
  render(s, true);
}

export function end(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  stopTimer(s);
  sessions.delete(channel);
  channels.setSlidesSessionSummary(channel, null, { deferEmit: true });
  releaseMedia(s);
  channels.clear(channel);
  // Blanked: active is already null so clear() emitted nothing.
  if (!channels.getState(channel).active) channels.setSlidesSessionSummary(channel, null);
}

export function promote(from: string, to: string): boolean {
  const src = sessions.get(from);
  if (!src) return false;
  replaced(to, src.args.slides[src.idx]!);
  const s: Session = { channel: to, args: src.args, idx: src.idx, blanked: false, atEnd: src.atEnd, autoEnded: false, timer: null };
  sessions.set(to, s);
  // The timer starts from the promoted slide.
  arm(s);
  render(s, true);
  channels.setLiveRow(to, { showId: s.args.showId, rowId: s.args.rowId });
  noteUse(s.args, to);
  // End the source after the destination is on air.
  end(from);
  return true;
}

/** The renderer reported the channel's media ended: a video slide that advances on its end moves on, once per playthrough. */
export function mediaEnded(channel: string, takenAt: number): void {
  const s = sessions.get(channel);
  if (!s || channel === PREVIEW || s.blanked || s.atEnd || !advancesOnEnd(s)) return;
  if (s.mediaTakenAt !== takenAt || s.playthroughEnded) return;
  s.playthroughEnded = true;
  guardedAutoAdvance(s);
}

/** The renderer reports the channel's media playing: a new playthrough may end (and advance) again. */
export function mediaPlaying(channel: string, takenAt: number): void {
  const s = sessions.get(channel);
  if (s && s.mediaTakenAt === takenAt) s.playthroughEnded = false;
}

/** The channel's session has one of its photo/video slides up in the media slot. */
export function ownsMediaOn(channel: string): boolean {
  const s = sessions.get(channel);
  return !!s && ownsMedia(s);
}

export function getSession(channel: string): SlidesSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

/** Forget the session (external take/clear): its graphic is left to the caller; media it owns is released. */
export function dropAll(channel: string): boolean {
  const s = sessions.get(channel);
  if (!s) return false;
  stopTimer(s);
  sessions.delete(channel);
  releaseMedia(s);
  return true;
}

export function resetAll(): void {
  for (const s of sessions.values()) stopTimer(s);
  sessions.clear();
}
