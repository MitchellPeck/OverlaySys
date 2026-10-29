// "Convert to slide deck": build a deck from a song, rewrite the song's rows
// in UPCOMING shows to slides rows, remember the PCO mapping and tombstone
// the song. Past shows and any row live on air are left alone. Undo is kept
// in memory for the life of the process.
//
// Failure safety: the deck, the show rewrites and the mapping keys are
// computed before the first write, and the undo record is registered before
// the first write and filled in as each write lands. A failure partway
// through rolls back what landed; if the rollback itself fails, the record
// stays so Undo can be retried. Undo keeps its record until it has finished.
//
// Concurrency: other clients (save_show, cloud pulls) can write between our
// awaits. Each show and the song are re-read immediately before they are
// written (no await in between), and a show that changed since planning is
// re-planned from the fresh copy, so a concurrent edit is never overwritten.
// Undo likewise only puts back a show or the song that still holds exactly
// what convert wrote.

import { randomUUID } from "node:crypto";
import {
  CONVERTED_TO_DECK_KEY,
  PCO_SONG_ID_KEY,
  deckFromSong,
  isUpcomingShow,
  mappingKeysFor,
  resolveIntroTake,
  songRowToSlidesRow,
  toISODate,
  type Deck,
  type DeckLicensing,
  type PcoItemMapping,
  type RundownRow,
  type Show,
  type Song,
  type SongRow,
  type Template,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as decks from "./decks";
import * as itemMappings from "./pco/itemMappings";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";

/** The song to convert doesn't exist (or is already deleted). */
export class SongNotFoundError extends Error {
  constructor(songId: string) {
    super(`Song not found: ${songId}`);
    this.name = "SongNotFoundError";
  }
}

/** Convert failed partway and was rolled back. `showIds`: shows written then restored. */
export class ConvertFailedError extends Error {
  constructor(
    message: string,
    readonly showIds: string[],
  ) {
    super(message);
    this.name = "ConvertFailedError";
  }
}

/** Convert failed partway and the automatic rollback failed too; Undo with `conversionId`. */
export class ConvertRollbackError extends Error {
  constructor(
    readonly conversionId: string,
    readonly songId: string,
    cause: unknown,
    /** Shows the convert wrote (some may have been put back). */
    readonly showIds: string[],
  ) {
    super(`Convert failed and could not be rolled back (${String(cause)}); undo ${conversionId} to retry`);
    this.name = "ConvertRollbackError";
  }
}

/** A second Undo for the same conversion while the first is still running. */
export class UndoInProgressError extends Error {
  constructor(conversionId: string) {
    super(`Undo of ${conversionId} is already running`);
    this.name = "UndoInProgressError";
  }
}

type ShowSnapshot = { before: Show; after: Show; restored?: boolean };
type MappingSnapshot = { key: string; previous: PcoItemMapping | "absent" };
type ConversionSnapshot = {
  /** The song as it was just before convert wrote it. */
  song: Song;
  deckId: string;
  /** Filled in as each write lands. */
  deckSaved: boolean;
  shows: ShowSnapshot[];
  mappings: MappingSnapshot[];
  /** `updatedAt` of every song version convert wrote (pointer save, tombstone). */
  songWrites: string[];
  /** Show ids whose rows changed on disk at some point (for re-sending to clients). */
  touchedShowIds: Set<string>;
};

const CONVERSIONS = new Map<string, ConversionSnapshot>();
const UNDOING = new Set<string>();

/** Every show a conversion has written or restored, for re-sending to clients after a failure. */
export function conversionShowIds(conversionId: string): string[] {
  return [...(CONVERSIONS.get(conversionId)?.touchedShowIds ?? [])];
}

/** Rows on air right now: a channel whose live row is set and still showing something. */
function rowsOnAir(): Set<string> {
  const out = new Set<string>();
  for (const s of channels.allStates()) {
    if (!s.liveRow) continue;
    if (!s.active && !s.songSession) continue;
    out.add(`${s.liveRow.showId}\u0000${s.liveRow.rowId}`);
  }
  return out;
}

type ShowPlan = { next: Show; rows: number; warnings: string[] };

/** The rewrite of one show, or null when it has nothing to convert. */
function planShow(
  current: Show,
  song: Song,
  deck: Deck,
  sectionSlideIds: Record<string, string[]>,
  allTemplates: Template[],
  onAir: Set<string>,
  today: string,
): ShowPlan | null {
  if (!isUpcomingShow(current, today)) return null;
  if (!current.rows.some((r) => r.kind === "song" && r.songId === song.id)) return null;
  const showSong = current.songs.find((s) => s.songId === song.id);
  const warnings: string[] = [];
  let changed = 0;
  const rows: RundownRow[] = current.rows.map((r) => {
    if (r.kind !== "song" || r.songId !== song.id) return r;
    if (onAir.has(`${current.id}\u0000${r.id}`)) {
      warnings.push(`${current.name}: a row is on air, so it stays a song row`);
      return r;
    }
    const lyricTemplate = allTemplates.find((t) => t.id === r.lyricTemplateId);
    const out = songRowToSlidesRow(r, showSong, song, deck, sectionSlideIds, lyricTemplate);
    if (out.warning) warnings.push(`${current.name}: ${out.warning}`);
    changed++;
    return out.row;
  });
  if (changed === 0) return null;
  const stillUsed = rows.some((r) => r.kind === "song" && r.songId === song.id);
  return {
    next: {
      ...current,
      rows,
      songs: stillUsed ? current.songs : current.songs.filter((s) => s.songId !== song.id),
    },
    rows: changed,
    warnings,
  };
}

function sameShow(a: Show, b: Show): boolean {
  return a.updatedAt === b.updatedAt && JSON.stringify(a) === JSON.stringify(b);
}

/** The song record as stored, tombstoned or not. */
async function currentSongRecord(id: string): Promise<Song | null> {
  return (await songs.getSong(id)) ?? (await songs.listDeletedSongs()).find((s) => s.id === id) ?? null;
}

export async function convertSongToDeck(
  songId: string,
  opts: { titleSlide: boolean; licensing?: DeckLicensing; today?: string },
): Promise<{
  conversionId: string;
  deck: Deck;
  rows: number;
  shows: number;
  warnings: string[];
  /** Ids of the shows that were rewritten (for broadcasting). */
  changedShowIds: string[];
}> {
  const song = await songs.getSong(songId);
  if (!song) throw new SongNotFoundError(songId);
  const today = opts.today ?? toISODate(new Date());
  const allTemplates = await templates.listTemplates();

  // ── Plan: compute everything before writing anything. ──
  let titleSlide: { templateId: string; data: Record<string, string> } | undefined;
  if (opts.titleSlide) {
    const syntheticRow: SongRow = {
      kind: "song",
      id: "convert-title",
      songId: song.id,
      lyricTemplateId: song.defaultLyricTemplateId ?? "",
    };
    const take = resolveIntroTake(syntheticRow, undefined, song, allTemplates);
    if (take) titleSlide = { templateId: take.templateId, data: take.fieldValues };
  }

  const built = deckFromSong(song, {
    id: `deck-${randomUUID().slice(0, 8)}`,
    now: new Date().toISOString(),
    newId: () => randomUUID(),
    ...(opts.licensing ? { licensing: opts.licensing } : {}),
    ...(titleSlide ? { titleSlide } : {}),
    ...(allTemplates[0] ? { fallbackTemplateId: allTemplates[0].id } : {}),
  });

  const onAir = rowsOnAir();
  const plan = (s: Show) => planShow(s, song, built.deck, built.sectionSlideIds, allTemplates, onAir, today);
  const planned: { before: Show; plan: ShowPlan }[] = [];
  for (const meta of await shows.listShowMetas()) {
    const current = await shows.getShow(meta.id);
    const p = current ? plan(current) : null;
    if (current && p) planned.push({ before: current, plan: p });
  }

  const pcoSongId = song.customFields[PCO_SONG_ID_KEY];
  const { songKey, titleKey } = mappingKeysFor({
    title: song.title,
    ...(pcoSongId ? { song: { id: pcoSongId } } : {}),
  } as Parameters<typeof mappingKeysFor>[0]);
  const keys = songKey ? [titleKey, songKey] : [titleKey];
  const existing = await itemMappings.listItemMappings({ includeDeleted: true });

  // ── Write: the undo record exists before the first write. ──
  const conversionId = randomUUID();
  const snap: ConversionSnapshot = {
    song,
    deckId: built.deck.id,
    deckSaved: false,
    shows: [],
    mappings: [],
    songWrites: [],
    touchedShowIds: new Set(),
  };
  CONVERSIONS.set(conversionId, snap);

  const warnings: string[] = [];
  let deck: Deck;
  let rowCount = 0;
  try {
    deck = await decks.saveDeck(built.deck);
    snap.deckSaved = true;
    for (const { before, plan: planAtStart } of planned) {
      // Re-read right before the save (no await in between): never write a stale copy.
      const fresh = await shows.getShow(before.id);
      const p = fresh && (sameShow(fresh, before) ? planAtStart : plan(fresh));
      if (!fresh || !p) continue;
      snap.touchedShowIds.add(fresh.id);
      const after = await shows.saveShow(p.next);
      snap.shows.push({ before: fresh, after });
      warnings.push(...p.warnings);
      rowCount += p.rows;
    }
    for (const key of keys) {
      const prev = existing.find((m) => m.id === key);
      snap.mappings.push({ key, previous: prev ? { ...prev } : "absent" });
      await itemMappings.upsertItemMapping({ key, kind: "slides", deckId: deck.id });
    }
    // Save the song once with the pointer, then tombstone it. Base it on a
    // fresh read so a concurrent song edit isn't overwritten.
    const freshSong = await songs.getSong(song.id);
    if (!freshSong) throw new SongNotFoundError(song.id);
    snap.song = freshSong;
    const pointed = await songs.saveSong({
      ...freshSong,
      customFields: { ...freshSong.customFields, [CONVERTED_TO_DECK_KEY]: deck.id },
    });
    if (pointed.updatedAt) snap.songWrites.push(pointed.updatedAt);
    await songs.deleteSong(song.id);
    const dead = await currentSongRecord(song.id);
    if (dead?.updatedAt) snap.songWrites.push(dead.updatedAt);
  } catch (err) {
    const touched = [...snap.touchedShowIds];
    try {
      await undoConversion(conversionId);
    } catch (rollbackErr) {
      throw new ConvertRollbackError(conversionId, song.id, rollbackErr, touched);
    }
    if (err instanceof SongNotFoundError) throw err;
    throw new ConvertFailedError(err instanceof Error ? err.message : String(err), touched);
  }

  return {
    conversionId,
    deck,
    rows: rowCount,
    shows: snap.shows.length,
    warnings,
    changedShowIds: snap.shows.map((s) => s.after.id),
  };
}

export async function undoConversion(conversionId: string): Promise<{
  songId: string;
  restoredShows: number;
  skippedShows: number;
  /** Ids of the shows that were put back (for broadcasting). */
  restoredShowIds: string[];
} | null> {
  const snap = CONVERSIONS.get(conversionId);
  if (!snap) return null;
  if (UNDOING.has(conversionId)) throw new UndoInProgressError(conversionId);
  UNDOING.add(conversionId);
  try {
    // The song comes back only while it still holds a version convert wrote:
    // a song restored and edited since keeps that edit.
    if (snap.songWrites.length > 0) {
      const current = await currentSongRecord(snap.song.id);
      if (current?.updatedAt && snap.songWrites.includes(current.updatedAt)) {
        await songs.saveSong(snap.song);
      }
    }

    const restoredShowIds: string[] = [];
    let skippedShows = 0;
    for (const s of snap.shows) {
      if (s.restored) {
        // Put back by an earlier attempt that failed later on.
        restoredShowIds.push(s.before.id);
        continue;
      }
      const current = await shows.getShow(s.before.id);
      if (!current || !sameShow(current, s.after)) {
        skippedShows++;
        continue;
      }
      await shows.saveShow(s.before);
      s.restored = true;
      restoredShowIds.push(s.before.id);
    }

    const now = new Date().toISOString();
    const live = await itemMappings.listItemMappings({ includeDeleted: true });
    for (const { key, previous } of snap.mappings) {
      const current = live.find((m) => m.id === key);
      // Never written, already put back, or re-pointed since: leave it.
      if (!current || current.deletedAt || current.deckId !== snap.deckId) continue;
      if (previous === "absent") await itemMappings.deleteItemMapping(key);
      else await itemMappings.putItemMapping({ ...previous, updatedAt: now });
    }

    // The deck goes only when no live show still has a row on it (a skipped
    // show, or one that picked the deck up after the conversion).
    if (snap.deckSaved && !(await deckInUse(snap.deckId))) await decks.deleteDeck(snap.deckId);

    CONVERSIONS.delete(conversionId);
    return {
      songId: snap.song.id,
      restoredShows: restoredShowIds.length,
      skippedShows,
      restoredShowIds,
    };
  } finally {
    UNDOING.delete(conversionId);
  }
}

async function deckInUse(deckId: string): Promise<boolean> {
  for (const meta of await shows.listShowMetas()) {
    const s = await shows.getShow(meta.id);
    if (s?.rows.some((r) => r.kind === "slides" && r.deckId === deckId)) return true;
  }
  return false;
}
