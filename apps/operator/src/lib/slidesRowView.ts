import type {
  ChannelState,
  Deck,
  LiveFolderFile,
  ResolvedSlide,
  SlidesRowFields,
  SlidesRowView as CoreSlidesRowView,
  SlidesSessionSummary,
} from "@overlaysys/core";
import { SLIDES_END_OF_DECK, isMediaOnlyDeck, liveFolderFileUrl, resolveFolderDeckSlides, slidesRowView } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { useStore } from "./store";
import { useDeck } from "../app/slides/useDeck";
import type { RowLike } from "./rowLike";
import type { AirState } from "./rowAirState";
import { slidesRowTakeMessage } from "./slidesLive";

/**
 * Slides adapter (contracts §9). Live and the show editor reach slides rows
 * only through this file.
 */

/** Whether the show editor's "+ Add item" offers Slides. */
export const slidesAddItemEnabled = true;

/** The deck cache, keyed by deck id. */
export function useDeckCache(): Record<string, Deck> {
  return useStore((s) => s.deckCache);
}

/** The deck a slides row points at: undefined = not loaded, null = missing or deleted. */
export function useDeckFor(row: RowLike): Deck | null | undefined {
  const id = row.kind === "slides" ? row.deckId : undefined;
  const d = useDeck(id);
  if (!id) return null;
  return d?.deletedAt ? null : d;
}

/** The store's live-folder answers, keyed by folder id. */
export type LiveFolderMap = Record<string, { files: LiveFolderFile[]; configured: boolean } | undefined>;

/** A slide on Live; photo/video slides (and a live folder's graphics) carry `media` instead of a design. */
export type OperatorResolvedSlide = ResolvedSlide;

/**
 * The operator's slides row view. `blockedReason` says plainly why a deck
 * with no slides can't be taken (a live folder that's empty or not on this computer).
 */
export type SlidesRowView = Omit<CoreSlidesRowView, "slides"> & { slides: OperatorResolvedSlide[]; blockedReason?: string };

export const FOLDER_EMPTY_REASON = "This folder has no photos or videos yet.";
export const FOLDER_ELSEWHERE_REASON = "These graphics are on the show computer.";

/**
 * A live-folder deck's row view: its slides are the folder's files in play
 * order (the deck has none of its own). `folder` undefined = not loaded yet.
 */
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
const graphicsDetail = (n: number) => `${n} graphic${n === 1 ? "" : "s"}`;

export function folderSlidesRowView(
  row: RowLike,
  deck: Deck,
  folder: { files: LiveFolderFile[]; configured: boolean } | undefined,
  session?: SlidesSessionSummary,
): SlidesRowView {
  const base = { title: deck.name, missingDeck: false, missingSlides: 0, licensing: deck.licensing.kind };
  // On air (or cued), the server plays its own list, frozen until the loop wraps:
  // index that list, so the highlight and a thumb click hit the graphic actually playing.
  if (session?.slideKeys) {
    const types = new Map((folder?.files ?? []).map((f) => [f.name, f.mediaType] as const));
    const slides: OperatorResolvedSlide[] = session.slideKeys.map((file, position) => ({
      key: `${row.id}:${position}:${file}`,
      slideId: file,
      position,
      templateId: "",
      data: {},
      label: file,
      media: {
        assetUrl: liveFolderFileUrl(deck.liveFolderId!, file),
        mediaType: types.get(file) ?? (VIDEO_FILE.test(file) ? "video" : "image"),
      },
    }));
    return { ...base, detail: graphicsDetail(slides.length), slides };
  }
  if (!folder) return { ...base, detail: "Loading…", slides: [] };
  if (!folder.configured) return { ...base, detail: "Live folder", slides: [], blockedReason: FOLDER_ELSEWHERE_REASON };
  const resolved = resolveFolderDeckSlides(deck.folderOrder, folder.files, deck.defaultHoldSec, deck.liveFolderId!);
  if (resolved.length === 0) return { ...base, detail: "Live folder", slides: [], blockedReason: FOLDER_EMPTY_REASON };
  const slides: OperatorResolvedSlide[] = resolved.map((m, position) => ({
    key: `${row.id}:${position}:${m.key}`,
    slideId: m.key,
    position,
    templateId: "",
    data: {},
    ...(m.label !== undefined ? { label: m.label } : {}),
    media: { assetUrl: m.assetUrl, mediaType: m.mediaType },
  }));
  return { ...base, detail: graphicsDetail(slides.length), slides };
}

/** This row's media session: the one on air (any non-preview output), else the one cued on preview. */
function rowMediaSession(row: RowLike, channelStates: Record<string, ChannelState | undefined> | undefined) {
  if (!channelStates) return undefined;
  const ch = slidesLiveChannel(row, channelStates);
  const live = ch ? channelStates[ch]?.slidesSession : undefined;
  if (live?.slot === "media") return live;
  const cued = channelStates.preview?.slidesSession;
  return cued?.rowId === row.id && cued.slot === "media" ? cued : undefined;
}

/**
 * The row's view. A live-folder deck reads its slides from the row's media
 * session when it has one (`channelStates`), else from `folders` (the store's liveFolderFiles).
 */
export function slidesRowViewFor(
  row: RowLike,
  deck: Deck | null | undefined,
  folders?: LiveFolderMap,
  channelStates?: Record<string, ChannelState | undefined>,
): SlidesRowView | null {
  if (row.kind !== "slides") return null;
  const d = deck?.deletedAt ? null : deck;
  if (d?.liveFolderId) return folderSlidesRowView(row, d, folders?.[d.liveFolderId], rowMediaSession(row, channelStates));
  return slidesRowView(row as SlidesRowFields, d);
}

/**
 * The output this slides row is on air on: program first, then the row's
 * own routed output (channelHint), then any other non-preview output whose
 * session is this row's. Preview never counts. Null when not on air.
 */
export function slidesLiveChannel(row: RowLike, channelStates: Record<string, ChannelState | undefined>): string | null {
  const hint = (row as { channelHint?: string }).channelHint;
  const order = ["program", ...(hint && hint !== "program" ? [hint] : []), ...Object.keys(channelStates)];
  for (const ch of order) {
    if (ch === "preview") continue;
    if (channelStates[ch]?.slidesSession?.rowId === row.id) return ch;
  }
  return null;
}

/** ON AIR on any non-preview output reads "program" (as songs routed elsewhere do); else cued on preview. */
export function slidesAirState(row: RowLike, channelStates: Record<string, ChannelState>): AirState {
  if (slidesLiveChannel(row, channelStates)) return "program";
  if (channelStates.preview?.slidesSession?.rowId === row.id) return "preview";
  return null;
}

export function slidesThumbState(
  row: RowLike,
  position: number,
  channelStates: Record<string, ChannelState>,
): "live" | "cued" | null {
  const ch = slidesLiveChannel(row, channelStates);
  const p = ch ? channelStates[ch]?.slidesSession : undefined;
  if (p && p.slideIdx === position) return "live";
  const v = channelStates.preview?.slidesSession;
  if (v?.rowId === row.id && v.slideIdx === position) return "cued";
  return null;
}

/** A thumbnail click: jump the live session on its own output, else cue that slide on preview. */
export function slidesThumbMessages(
  showId: string,
  row: RowLike,
  position: number,
  target: "preview" | "program-live",
  liveChannel = "program",
  /** A media session's slide key: the server goes by it, since its list can differ from a stale index. */
  key?: string,
): ClientMessage[] | null {
  if (target === "program-live") {
    return [{ type: "slides_goto", channel: liveChannel, slideIdx: position, ...(key !== undefined ? { key } : {}) }];
  }
  return [{ type: "slides_take", showId, rowId: row.id, slideIdx: position, channel: "preview" }];
}

/** cue → preview, take → row.channelHint ?? "program". */
export function slidesRowTakeMessages(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage[] | null {
  return [slidesRowTakeMessage(showId, row, action)];
}

/** Whether a deck moves on by itself: a deck hold, any slide hold, a live folder, or videos that advance when they end. */
export function deckAutoAdvances(deck: Deck): boolean {
  if (deck.defaultHoldSec !== undefined) return true;
  // A live folder with auto-advance off moves on only where a graphic has its own hold.
  if (deck.liveFolderId) return (deck.folderOrder ?? []).some((o) => o.holdSec !== undefined);
  if (deck.slides.some((s) => s.holdSec !== undefined)) return true;
  return isMediaOnlyDeck(deck) && deck.slides.some((s) => s.media?.mediaType === "video" && s.advanceOnEnd !== false);
}

/**
 * The Live timing note for a slides row on air (never preview): "auto · loops"
 * or "auto", plus when the next slide comes (server clock). Null for a manual deck.
 */
export function slidesAutoInfo(
  row: RowLike,
  channelStates: Record<string, ChannelState | undefined>,
  deck: Deck | null | undefined,
): { text: string; nextAdvanceAt?: number } | null {
  const ch = slidesLiveChannel(row, channelStates);
  const s = ch ? channelStates[ch]?.slidesSession : undefined;
  if (!s) return null;
  const auto = s.nextAdvanceAt !== undefined || (!!deck && !deck.deletedAt && deckAutoAdvances(deck));
  if (!auto) return null;
  return { text: s.loops ? "auto · loops" : "auto", ...(s.nextAdvanceAt !== undefined ? { nextAdvanceAt: s.nextAdvanceAt } : {}) };
}

/** Whole seconds until `nextAdvanceAt` (server clock), rounded up; `serverOffsetMs` = server − local. Never negative. */
export function slidesCountdownSec(nextAdvanceAt: number, nowMs: number, serverOffsetMs: number): number {
  return Math.max(0, Math.ceil((nextAdvanceAt - (nowMs + serverOffsetMs)) / 1000));
}

export function slidesStripNotice(
  row: RowLike,
  view: SlidesRowView,
  channelStates: Record<string, ChannelState>,
): string | null {
  const atEnd = Object.values(channelStates).some(
    (c) => c?.slidesSession?.rowId === row.id && c.slidesSession.atEnd,
  );
  if (atEnd) return SLIDES_END_OF_DECK;
  if (view.blockedReason) return view.blockedReason;
  if (view.missingDeck) return "Missing deck — restore it from Slides";
  if (view.missingSlides > 0) {
    return `${view.missingSlides} slide${view.missingSlides === 1 ? "" : "s"} no longer in the deck were skipped`;
  }
  return null;
}

/**
 * The output Space / Shift+Space / B drive in slides key mode: a program
 * slides session, else one on another non-preview output (a row routed
 * there). Preview never drives keys.
 */
export function slidesKeyChannel(channelStates: Record<string, ChannelState | undefined>): string | null {
  if (channelStates.program?.slidesSession) return "program";
  for (const [ch, st] of Object.entries(channelStates)) {
    if (ch !== "preview" && st?.slidesSession) return ch;
  }
  return null;
}

export function slidesAdvanceMessage(delta: 1 | -1, channel = "program"): ClientMessage | null {
  return { type: "slides_advance", channel, delta };
}

/** B while keyMode is "slides". */
export function slidesBlankMessage(channel = "program"): ClientMessage | null {
  return { type: "slides_blank", channel };
}

/**
 * Header Cue / Take for a slides row: enabled only when the deck is loaded and
 * has slides (same rule as the rundown buttons and the Enter / Space keys).
 * A missing deck says so in the tooltip.
 */
export const MISSING_DECK_TITLE = "Missing deck — restore it from Slides";
export function slidesControlState(
  row: RowLike,
  c: {
    deckCache: Record<string, Deck>;
    deckNotFound?: Record<string, true>;
    liveFolderFiles?: LiveFolderMap;
    channelStates?: Record<string, ChannelState | undefined>;
  },
): { enabled: boolean; title?: string } {
  const deckId = (row as { deckId?: string }).deckId;
  const view = slidesRowViewFor(row, deckId ? (c.deckNotFound?.[deckId] ? null : c.deckCache[deckId]) : null, c.liveFolderFiles, c.channelStates);
  if (view && !view.missingDeck && view.slides.length > 0) return { enabled: true };
  if (view?.missingDeck) return { enabled: false, title: MISSING_DECK_TITLE };
  return view?.blockedReason ? { enabled: false, title: view.blockedReason } : { enabled: false };
}
