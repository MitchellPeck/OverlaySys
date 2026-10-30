import type { Deck, DeckSlide, LiveFolderFile, MediaDeckSlide, SlidesRowFields, SlidesSessionSummary } from "@overlaysys/core";
import { isMediaOnlyDeck, mediaDeckSlidesFromDeck, nextFolderOrder, resolveFolderDeckSlides } from "@overlaysys/core";
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
  /** Nothing left to play (folder emptied, or every slide failed): holding what's on air. */
  starved: boolean;
  /** Slides whose media reported an error: skipped like a missing file for the rest of the session. */
  failed: Set<string>;
  /** Media takenAt of the current slide, so a late `ended` from an earlier slide is ignored. */
  takenAt: number;
  /** The slide this session last put on air (still up while starved, even if its file has gone). */
  onAir?: MediaDeckSlide;
  /** The on-air media reported an error: a wrap back onto it must take it again, not replay it. */
  onAirFailed: boolean;
  /** This video playthrough already advanced; cleared by a new take or a "playing" report. */
  playthroughEnded: boolean;
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

/**
 * The deck a Slides row plays in the media slot, or null when it isn't a
 * media-only deck. A live-folder deck plays its folder and ignores the row's
 * selection; any other deck (or the row's one-off local slides) honours the
 * row's `slideIds` the way template decks do, repeats included.
 */
export function mediaDeckForRow(row: SlidesRowFields, deck: Deck | null): Deck | null {
  if (row.deckId) {
    if (!deck) return null;
    if (deck.liveFolderId) return deck;
  } else if (!row.localSlides) {
    return null;
  }
  const source: DeckSlide[] = row.deckId ? deck!.slides : row.localSlides!;
  const byId = new Map(source.map((sl) => [sl.id, sl] as const));
  const slides = (row.slideIds ?? source.map((sl) => sl.id)).flatMap((id) => {
    const sl = byId.get(id);
    return sl ? [sl] : [];
  });
  const base: Deck = row.deckId
    ? deck!
    : { id: "", name: "One-off slides", tags: [], defaultTemplateId: "", licensing: { kind: "own" }, slides: [], createdAt: "" };
  const out: Deck = { ...base, slides };
  return isMediaOnlyDeck(out) ? out : null;
}

function resolveSlides(deck: Deck, order: Deck["folderOrder"]): { order?: FolderOrder; slides: MediaDeckSlide[] } {
  if (!deck.liveFolderId) return { slides: mediaDeckSlidesFromDeck(deck) };
  const files = listLiveFolderFiles(deck.liveFolderId);
  const next = nextFolderOrder(order, files);
  return { order: next, slides: resolveFolderDeckSlides(next, files, deck.defaultHoldSec, deck.liveFolderId) };
}

/** Which slides can still play: not failed, and (live folder) its file is still there. */
function presence(s: Session): (slide: MediaDeckSlide) => boolean {
  if (!s.deck.liveFolderId) return (slide) => !s.failed.has(slide.key);
  const names = new Set(listLiveFolderFiles(s.deck.liveFolderId).map((f) => f.name));
  return (slide) => names.has(slide.key) && !s.failed.has(slide.key);
}

function holdMs(s: Session, slide: MediaDeckSlide): number | undefined {
  const sec =
    slide.mediaType === "image" ? (slide.holdSec ?? s.deck.defaultHoldSec) : slide.advanceOnEnd ? undefined : slide.holdSec;
  return sec !== undefined && sec > 0 ? sec * 1000 : undefined;
}

/** Index of the first playable slide in `from..end`, then (wrapping) `0..from-1`; -1 when none. */
function playableFrom(s: Session, from: number, wrap: boolean): number {
  const present = presence(s);
  const n = s.slides.length;
  for (let k = 0; k < n; k++) {
    const i = from + k;
    if (i >= n && !wrap) break;
    if (present(s.slides[i % n]!)) return i % n;
  }
  return -1;
}

/** The slide that will actually play next (missing and failed ones skipped). */
function nextPlayable(s: Session): MediaDeckSlide | undefined {
  const i = playableFrom(s, s.idx + 1, s.deck.loop === true);
  return i >= 0 ? s.slides[i] : undefined;
}

function summarize(s: Session): SlidesSessionSummary {
  const idx = Math.min(Math.max(s.idx, 0), s.slides.length - 1);
  const cur = s.onAir ?? s.slides[idx];
  const next = nextPlayable(s);
  return {
    rowId: s.rowId,
    ...(s.deck.id ? { deckId: s.deck.id } : {}),
    title: s.deck.name,
    slideIdx: idx,
    slideCount: s.slides.length,
    ...(cur?.label ? { label: cur.label } : {}),
    lines: [],
    ...(next?.label ? { nextLabel: next.label } : {}),
    blanked: false,
    atEnd: s.atEnd,
    ...(s.nextAdvanceAt !== undefined ? { nextAdvanceAt: s.nextAdvanceAt } : {}),
    loops: s.deck.loop === true,
    slot: "media",
    slideKeys: s.slides.map((sl) => sl.key),
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
  s.onAir = slide;
  s.onAirFailed = false;
  s.playthroughEnded = false;
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

/** True when `slide` is the very file this session has on air right now. */
function isOnAir(s: Session, slide: MediaDeckSlide): boolean {
  return (
    !!s.onAir &&
    !s.onAirFailed &&
    s.onAir.key === slide.key &&
    s.onAir.assetUrl === slide.assetUrl &&
    channels.getState(s.channel).media?.takenAt === s.takenAt
  );
}

/**
 * Wrapping onto the slide already on air (a one-file folder, or every other
 * slide gone): no re-take, so no fade or dip. A photo just restarts its hold;
 * a video plays again from the start through the seek path.
 */
function replay(s: Session): void {
  const slide = s.slides[s.idx]!;
  if (slide.mediaType === "video") channels.mediaControl(s.channel, s.takenAt, "restart");
  hold(s);
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
    restartFromTop(s);
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

/**
 * Re-read the slides and play the first playable one. With none, hold what's
 * on air: the old list and index stay, since they describe what's up.
 */
function restartFromTop(s: Session): void {
  const r = resolveSlides(s.deck, s.order);
  const present = presence(s);
  const first = r.slides.findIndex((sl) => present(sl));
  s.atEnd = false;
  if (first < 0) {
    s.starved = true;
    hold(s);
    return;
  }
  if (r.order) s.order = r.order;
  s.slides = r.slides;
  s.idx = first;
  s.starved = false;
  if (isOnAir(s, s.slides[first]!)) replay(s);
  else show(s);
}

function back(s: Session): void {
  const present = presence(s);
  for (let i = Math.min(s.idx, s.slides.length) - 1; i >= 0; i--) {
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
    // Files changed: give previously failed ones another chance.
    s.failed.clear();
    restartFromTop(s);
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
    failed: new Set(),
    takenAt: 0,
    onAirFailed: false,
    playthroughEnded: false,
    timer: null,
  };
  sessions.set(channel, s);
  show(s, true);
  return { ok: true };
}

/** A live folder taken from the Live Media panel holds each photo this long. */
export const FOLDER_TAKE_HOLD_SEC = 8;

export type StartFolderArgs = { folderId: string; name: string; folderOrder?: FolderOrder };

/**
 * Loop a live folder from the Media panel: no show row (so nothing in the
 * show changes), an 8 s hold, and the given saved order (else name order).
 */
export function startFolder(channel: string, args: StartFolderArgs): StartResult {
  const deck: Deck = {
    id: `media-folder:${args.folderId}`,
    name: args.name,
    tags: [],
    defaultTemplateId: "",
    licensing: { kind: "own" },
    slides: [],
    createdAt: "",
    liveFolderId: args.folderId,
    defaultHoldSec: FOLDER_TAKE_HOLD_SEC,
    loop: true,
    ...(args.folderOrder ? { folderOrder: args.folderOrder } : {}),
  };
  return start(channel, { rowId: `media-folder:${args.folderId}`, deck });
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
  // Going to a slide by hand retries it even if it failed before.
  s.failed.delete(s.slides[idx]!.key);
  if (!presence(s)(s.slides[idx]!)) return false;
  s.idx = idx;
  s.atEnd = false;
  s.starved = false;
  show(s);
  return true;
}

/**
 * Go to the slide with `key` in the session's own list. `idxHint` (the
 * client's index) picks among repeats of the same key. False when the key isn't there.
 */
export function goToKey(channel: string, key: string, idxHint?: number): boolean {
  const s = sessions.get(channel);
  if (!s) return false;
  const idx = idxHint !== undefined && s.slides[idxHint]?.key === key ? idxHint : s.slides.findIndex((sl) => sl.key === key);
  return idx >= 0 && goTo(channel, idx);
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
  if (slide.mediaType !== "video" || !slide.advanceOnEnd || s.playthroughEnded) return;
  // A replay in place keeps the takenAt, so a duplicate "ended" must not advance twice.
  s.playthroughEnded = true;
  forward(s, false);
}

/** The renderer reports this channel's media playing: a new playthrough may end (and advance) again. */
export function mediaPlaying(channel: string, takenAt: number): void {
  const s = sessions.get(channel);
  if (s && s.takenAt === takenAt) s.playthroughEnded = false;
}

/** The renderer couldn't play this channel's media: skip it like a missing file. */
export function mediaFailed(channel: string, takenAt: number): void {
  const s = sessions.get(channel);
  if (!s || channel === PREVIEW || s.takenAt !== takenAt || s.starved) return;
  s.failed.add((s.onAir ?? s.slides[s.idx]!).key);
  s.onAirFailed = true;
  forward(s, false);
}

/**
 * Preview → program: the deck goes on air from its current slide and its
 * timer starts. A current slide that can't play (its file gone, or failed)
 * gives way to the next playable one; with none, nothing is promoted.
 */
export function promote(from: string, to: string): boolean {
  const src = sessions.get(from);
  if (!src) return false;
  const s: Session = {
    ...src,
    channel: to,
    starved: false,
    failed: new Set(src.failed),
    takenAt: 0,
    timer: null,
  };
  delete s.nextAdvanceAt;
  delete s.onAir;
  let idx = playableFrom(s, Math.min(s.idx, s.slides.length - 1), true);
  if (idx < 0) {
    // The preview list may be stale (a held, emptied folder): try the folder as it is now.
    const r = resolveSlides(s.deck, s.order);
    const present = presence(s);
    idx = r.slides.findIndex((sl) => present(sl));
    if (idx < 0) return false;
    if (r.order) s.order = r.order;
    s.slides = r.slides;
  }
  if (idx !== s.idx) s.atEnd = false;
  s.idx = idx;
  dropAll(to, { deferEmit: true });
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
