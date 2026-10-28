// Pure helpers for "Convert to slide deck": build a deck from a song's play
// order and rewrite song rows into slides rows on that deck. No I/O; the
// server (server/src/decksConvert.ts) does the registry writes and the undo.

import type { Deck, DeckLicensing, DeckSlide } from "./deck";
import type { Show, ShowSong, SlidesRow, SongRow } from "./show";
import { resolveShowDate } from "./showSchedule";
import type { Song } from "./song";
import { resolveArrangement, resolveSongChannel } from "./songResolution";
import type { Template } from "./template";

/** customFields key on a converted (tombstoned) song naming its deck. */
export const CONVERTED_TO_DECK_KEY = "converted_to_deck";

export function deckFromSong(
  song: Song,
  opts: {
    id: string;
    now: string;
    newId: () => string;
    licensing?: DeckLicensing;
    titleSlide?: { templateId: string; data: Record<string, string> };
    /** Used when the song has no defaultLyricTemplateId (the first template). */
    fallbackTemplateId?: string;
  },
): { deck: Deck; sectionSlideIds: Record<string, string[]>; droppedSections: string[] } {
  const byId = new Map(song.sections.map((s) => [s.id, s] as const));
  const slides: DeckSlide[] = [];
  const sectionSlideIds: Record<string, string[]> = {};

  if (opts.titleSlide) {
    slides.push({ id: opts.newId(), templateId: opts.titleSlide.templateId, data: { ...opts.titleSlide.data } });
  }

  for (const sectionId of song.defaultArrangement) {
    const section = byId.get(sectionId);
    if (!section) continue; // stale arrangement id
    const ids: string[] = [];
    for (const s of section.slides) {
      const id = opts.newId();
      ids.push(id);
      slides.push({ id, data: { text: s.lines.join("\n") }, label: section.label });
    }
    if (!sectionSlideIds[section.id]) sectionSlideIds[section.id] = ids;
  }

  const inOrder = new Set(song.defaultArrangement);
  const droppedSections = song.sections.filter((s) => !inOrder.has(s.id)).map((s) => s.label);

  const licensing: DeckLicensing =
    opts.licensing ??
    (song.ccliNumber ? { kind: "ccli", ccliNumber: song.ccliNumber } : { kind: "public-domain" });

  const deck: Deck = {
    id: opts.id,
    name: song.title,
    tags: [],
    defaultTemplateId: song.defaultLyricTemplateId ?? opts.fallbackTemplateId ?? "",
    licensing,
    slides,
    createdAt: opts.now,
    convertedFromSongId: song.id,
  };
  return { deck, sectionSlideIds, droppedSections };
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function songRowToSlidesRow(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  deck: Deck,
  sectionSlideIds: Record<string, string[]>,
  /** The row's lyric template: the last step of the song channel cascade. */
  lyricTemplate?: Template,
): { row: SlidesRow; warning?: string } {
  // Slides rows only read channelHint, so pin the channel the song row resolved to.
  const channel = resolveSongChannel(row, showSong, song, lyricTemplate);
  const out: SlidesRow = {
    kind: "slides",
    id: row.id,
    deckId: deck.id,
    ...(row.sectionId !== undefined ? { sectionId: row.sectionId } : {}),
    ...(row.stageLayouts !== undefined ? { stageLayouts: row.stageLayouts } : {}),
    ...(channel !== undefined ? { channelHint: channel } : {}),
    ...(row.notes !== undefined ? { notes: row.notes } : {}),
    ...(row.sermonNotesId !== undefined ? { sermonNotesId: row.sermonNotesId } : {}),
    ...(row.lengthSec !== undefined ? { lengthSec: row.lengthSec } : {}),
    ...(row.lengthSecManual !== undefined ? { lengthSecManual: row.lengthSecManual } : {}),
    ...(row.sourceRef !== undefined ? { sourceRef: row.sourceRef } : {}),
  };
  if (row.lyricTemplateId && row.lyricTemplateId !== deck.defaultTemplateId) {
    out.templateId = row.lyricTemplateId;
  }

  let warning: string | undefined;
  const arrangement = resolveArrangement(row, showSong, song);
  if (!sameOrder(arrangement, song.defaultArrangement)) {
    const labels = new Map(song.sections.map((s) => [s.id, s.label] as const));
    const slideIds: string[] = [];
    const missing: string[] = [];
    for (const sectionId of arrangement) {
      const ids = sectionSlideIds[sectionId];
      if (ids) {
        slideIds.push(...ids);
        continue;
      }
      const label = labels.get(sectionId);
      if (label !== undefined && !missing.includes(label)) missing.push(label);
    }
    out.slideIds = slideIds;
    if (missing.length > 0) {
      warning = missing.map((l) => `Section "${l}" isn't in the deck; skipped`).join("; ");
    }
  }
  return warning ? { row: out, warning } : { row: out };
}

/** A show is upcoming when its date is today or later, or it has no date. */
export function isUpcomingShow(show: Pick<Show, "name" | "scheduledFor">, todayISO: string): boolean {
  const date = resolveShowDate(show);
  return date === null || date >= todayISO;
}

export function convertedDeckId(song: Pick<Song, "customFields">): string | null {
  return song.customFields?.[CONVERTED_TO_DECK_KEY] || null;
}
