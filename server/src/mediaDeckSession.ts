import type { Deck, LiveFolderFile, MediaDeckSlide, SlidesSessionSummary } from "@overlaysys/core";
import { mediaDeckSlidesFromDeck, nextFolderOrder, resolveFolderDeckSlides } from "@overlaysys/core";
import * as channels from "./channels";
import { listLiveFolderFiles, onLiveFolderChange } from "./liveFolders";

/**
 * Media-only decks (every slide full-screen media, or a live folder) play in
 * the channel's media slot, beneath graphics, on a server-side timer. Graphics
 * taken on top leave the loop running; anything that takes the media slot
 * (another media take, a media clear, another media deck) stops it.
 */

export const EMPTY_MEDIA_DECK_MESSAGE = "This folder has no photos or videos yet.";

const PREVIEW = "preview";

export type StartArgs = { rowId: string; showId?: string; deck: Deck; slideIdx?: number };
export type StartResult = { ok: true } | { ok: false; error: string };

type FolderOrder = NonNullable<Deck["folderOrder"]>;

interface Session {
  channel: string;
  rowId: string;
  showId?: string;
  deck: Deck;
  /** Marks this session's own media takes, so any other take stops it. */
  owner: string;
  /** Live-folder decks: the play order this session has seen (new files join at the wrap). */
  order?: FolderOrder;
  slides: MediaDeckSlide[];
  idx: number;
  atEnd: boolean;
  /** Every folder file is gone: holding what's on air until files return. */
  starved: boolean;
  /** Media takenAt of the current slide, so a late `ended` from an earlier slide is ignored. */
  takenAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  nextAdvanceAt?: number;
}

const sessions = new Map<string, Session>();

type SummaryListener = (channel: string, summary: SlidesSessionSummary | null) => void;
const summaryListeners = new Set<SummaryListener>();

/** Fires whenever a channel's media-deck summary changes (null when the session stops). */
export function onSummaryChange(cb: SummaryListener): () => void {
  summaryListeners.add(cb);
  return () => {
    summaryListeners.delete(cb);
  };
}

function resolveSlides(deck: Deck, order: Deck["folderOrder"]): { order?: FolderOrder; slides: MediaDeckSlide[] } {
  if (!deck.liveFolderId) return { slides: mediaDeckSlidesFromDeck(deck) };
  const files = listLiveFolderFiles(deck.liveFolderId);
  const next = nextFolderOrder(order, files);
  return { order: next, slides: resolveFolderDeckSlides(next, files, deck.defaultHoldSec, deck.liveFolderId) };
}

/** Which slides can still play: every slide, except a live-folder file that has gone. */
function presence(s: Session): (slide: MediaDeckSlide) => boolean {
  if (!s.deck.liveFolderId) return () => true;
  const names = new Set(listLiveFolderFiles(s.deck.liveFolderId).map((f) => f.name));
  return (slide) => names.has(slide.key);
}

function holdMs(s: Session, slide: MediaDeckSlide): number | undefined {
  const sec =
    slide.mediaType === "image" ? (slide.holdSec ?? s.deck.defaultHoldSec) : slide.advanceOnEnd ? undefined : slide.holdSec;
  return sec !== undefined && sec > 0 ? sec * 1000 : undefined;
}

function summarize(s: Session): SlidesSessionSummary {
  const cur = s.slides[s.idx]!;
  const next = s.slides[s.idx + 1];
  return {
    rowId: s.rowId,
    deckId: s.deck.id,
    title: s.deck.name,
    slideIdx: s.idx,
    slideCount: s.slides.length,
    ...(cur.label ? { label: cur.label } : {}),
    lines: [],
    ...(next?.label ? { nextLabel: next.label } : {}),
    blanked: false,
    atEnd: s.atEnd,
    ...(s.nextAdvanceAt !== undefined ? { nextAdvanceAt: s.nextAdvanceAt } : {}),
    loops: s.deck.loop === true,
    slot: "media",
  };
}

function publish(channel: string, summary: SlidesSessionSummary | null, options?: { deferEmit?: boolean }): void {
  channels.setMediaDeckSummary(channel, summary, options);
  for (const l of [...summaryListeners]) {
    try {
      l(channel, summary);
    } catch (err) {
      console.warn("[mediaDeckSession] summary listener failed", err);
    }
  }
}

function stopTimer(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  delete s.nextAdvanceAt;
}

/** (Re)start the hold timer for the current slide. Never on preview, at the end, or while starved. */
function arm(s: Session): void {
  stopTimer(s);
  if (s.channel === PREVIEW || s.atEnd || s.starved) return;
  const ms = holdMs(s, s.slides[s.idx]!);
  if (ms === undefined) return;
  s.nextAdvanceAt = Date.now() + ms;
  s.timer = setTimeout(() => {
    s.timer = null;
    if (sessions.get(s.channel) !== s) return;
    forward(s, false);
  }, ms);
}

/** Put the current slide on air and restart its timer: one channel emit carries both. */
function show(s: Session, withShowId = false): void {
  const slide = s.slides[s.idx]!;
  arm(s);
  publish(s.channel, summarize(s), { deferEmit: true });
  channels.mediaTake(s.channel, {
    rowId: s.rowId,
    ...(withShowId && s.showId ? { showId: s.showId } : {}),
    assetUrl: slide.assetUrl,
    ...(slide.label !== undefined ? { label: slide.label } : {}),
    volume: 1,
    endAction: "hold",
    mediaType: slide.mediaType,
    ...(slide.mediaType === "image" ? { fit: "cover" as const } : {}),
    loop: false,
    muted: slide.muted,
    owner: s.owner,
  });
  s.takenAt = channels.getState(s.channel).media?.takenAt ?? 0;
}

/** Hold what's on air with no timer (end of a non-looping deck, or an emptied folder). */
function hold(s: Session): void {
  arm(s);
  publish(s.channel, summarize(s));
}

function forward(s: Session, manual: boolean): void {
  const present = presence(s);
  for (let i = s.idx + 1; i < s.slides.length; i++) {
    if (!present(s.slides[i]!)) continue;
    s.idx = i;
    s.atEnd = false;
    show(s);
    return;
  }
  if (s.deck.loop) {
    // The wrap: a live folder re-reads its files here, so new ones join now.
    const r = resolveSlides(s.deck, s.order);
    if (r.slides.length === 0) {
      s.starved = true;
      hold(s);
      return;
    }
    if (r.order) s.order = r.order;
    s.slides = r.slides;
    s.idx = 0;
    s.atEnd = false;
    s.starved = false;
    show(s);
    return;
  }
  if (!s.atEnd) {
    s.atEnd = true;
    hold(s);
    return;
  }
  // Next again at the end of a non-looping deck ends it (as Slides rows do).
  if (manual) end(s.channel);
}

function back(s: Session): void {
  const present = presence(s);
  for (let i = s.idx - 1; i >= 0; i--) {
    if (!present(s.slides[i]!)) continue;
    s.idx = i;
    s.atEnd = false;
    s.starved = false;
    show(s);
    return;
  }
  if (s.atEnd) {
    s.atEnd = false;
    show(s);
  }
}

let folderWatch: (() => void) | null = null;

function onFolderChange(id: string, files: LiveFolderFile[]): void {
  if (files.length === 0) return;
  for (const s of [...sessions.values()]) {
    if (!s.starved || s.deck.liveFolderId !== id || sessions.get(s.channel) !== s) continue;
    const r = resolveSlides(s.deck, s.order);
    if (r.slides.length === 0) continue;
    if (r.order) s.order = r.order;
    s.slides = r.slides;
    s.idx = 0;
    s.atEnd = false;
    s.starved = false;
    show(s);
  }
}

export function start(channel: string, args: StartArgs): StartResult {
  const r = resolveSlides(args.deck, args.deck.folderOrder);
  // Refused takes leave whatever is on air alone.
  if (r.slides.length === 0) return { ok: false, error: EMPTY_MEDIA_DECK_MESSAGE };
  const idx = args.slideIdx ?? 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= r.slides.length) return { ok: false, error: `slide ${idx}` };
  if (!folderWatch) folderWatch = onLiveFolderChange(onFolderChange);
  dropAll(channel, { deferEmit: true });
  const s: Session = {
    channel,
    rowId: args.rowId,
    ...(args.showId ? { showId: args.showId } : {}),
    deck: args.deck,
    owner: `mediaDeck:${args.rowId}`,
    ...(r.order ? { order: r.order } : {}),
    slides: r.slides,
    idx,
    atEnd: false,
    starved: false,
    takenAt: 0,
    timer: null,
  };
  sessions.set(channel, s);
  show(s, true);
  return { ok: true };
}

export function has(channel: string): boolean {
  return sessions.has(channel);
}

/** Manual next/previous; restarts the hold timer from the new slide. */
export function step(channel: string, delta: 1 | -1): void {
  const s = sessions.get(channel);
  if (!s) return;
  if (delta > 0) forward(s, true);
  else back(s);
}

export function goTo(channel: string, idx: number): boolean {
  const s = sessions.get(channel);
  if (!s || !Number.isInteger(idx) || idx < 0 || idx >= s.slides.length) return false;
  if (!presence(s)(s.slides[idx]!)) return false;
  s.idx = idx;
  s.atEnd = false;
  s.starved = false;
  show(s);
  return true;
}

/** Stop the deck and clear the media slot. */
export function end(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  stopTimer(s);
  sessions.delete(channel);
  const hasMedia = !!channels.getState(channel).media;
  publish(channel, null, { deferEmit: hasMedia });
  channels.mediaClear(channel);
}

/** Forget the session without touching the media slot (an external media take/clear, panic clear). */
export function dropAll(channel: string, options?: { deferEmit?: boolean }): boolean {
  const s = sessions.get(channel);
  if (!s) return false;
  stopTimer(s);
  sessions.delete(channel);
  publish(channel, null, options);
  return true;
}

/** A media take is about to land: a session it doesn't belong to stops. */
export function releaseForMediaTake(channel: string, owner: string | undefined): boolean {
  const s = sessions.get(channel);
  if (!s || s.owner === owner) return false;
  return dropAll(channel, { deferEmit: true });
}

/** The renderer reported the media on this channel ended. */
export function mediaEnded(channel: string, takenAt: number): void {
  const s = sessions.get(channel);
  if (!s || channel === PREVIEW || s.takenAt !== takenAt || s.atEnd || s.starved) return;
  const slide = s.slides[s.idx]!;
  if (slide.mediaType !== "video" || !slide.advanceOnEnd) return;
  forward(s, false);
}

/** Preview → program: the deck goes on air from its current slide and its timer starts. */
export function promote(from: string, to: string): boolean {
  const src = sessions.get(from);
  if (!src) return false;
  dropAll(to, { deferEmit: true });
  const s: Session = {
    ...src,
    channel: to,
    starved: false,
    takenAt: 0,
    timer: null,
  };
  delete s.nextAdvanceAt;
  sessions.set(to, s);
  show(s, true);
  end(from);
  return true;
}

export function summary(channel: string): SlidesSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

export function resetAll(): void {
  for (const s of sessions.values()) stopTimer(s);
  sessions.clear();
}
