// "Convert to slide deck": build a deck from a song, rewrite the song's rows
// in UPCOMING shows to slides rows, remember the PCO mapping and tombstone
// the song. Past shows and any row live on air are left alone. Undo is kept
// in memory for the life of the process.

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
} from "@overlaysys/core";
import * as channels from "./channels";
import * as decks from "./decks";
import * as itemMappings from "./pco/itemMappings";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";

type ShowSnapshot = { before: Show; after: Show };
type MappingSnapshot = { key: string; previous: PcoItemMapping | "absent" };
type ConversionSnapshot = {
  song: Song;
  deckId: string;
  shows: ShowSnapshot[];
  mappings: MappingSnapshot[];
};

const CONVERSIONS = new Map<string, ConversionSnapshot>();

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
  if (!song) throw new Error(`Song not found: ${songId}`);
  const today = opts.today ?? toISODate(new Date());
  const allTemplates = await templates.listTemplates();

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
  const deck = await decks.saveDeck(built.deck);

  // Rewrite upcoming shows.
  const onAir = rowsOnAir();
  const warnings: string[] = [];
  const showSnaps: ShowSnapshot[] = [];
  let rowCount = 0;
  for (const meta of await shows.listShowMetas()) {
    const current = await shows.getShow(meta.id);
    if (!current || !isUpcomingShow(current, today)) continue;
    if (!current.rows.some((r) => r.kind === "song" && r.songId === song.id)) continue;
    const showSong = current.songs.find((s) => s.songId === song.id);
    let changed = 0;
    const rows: RundownRow[] = current.rows.map((r) => {
      if (r.kind !== "song" || r.songId !== song.id) return r;
      if (onAir.has(`${current.id}\u0000${r.id}`)) {
        warnings.push(`${current.name}: a row is on air, so it stays a song row`);
        return r;
      }
      const out = songRowToSlidesRow(r, showSong, song, deck, built.sectionSlideIds);
      if (out.warning) warnings.push(`${current.name}: ${out.warning}`);
      changed++;
      return out.row;
    });
    if (changed === 0) continue;
    const stillUsed = rows.some((r) => r.kind === "song" && r.songId === song.id);
    const next: Show = {
      ...current,
      rows,
      songs: stillUsed ? current.songs : current.songs.filter((s) => s.songId !== song.id),
    };
    const after = await shows.saveShow(next);
    showSnaps.push({ before: current, after });
    rowCount += changed;
  }

  // Remember the PCO mapping.
  const pcoSongId = song.customFields[PCO_SONG_ID_KEY];
  const { songKey, titleKey } = mappingKeysFor({
    title: song.title,
    ...(pcoSongId ? { song: { id: pcoSongId } } : {}),
  } as Parameters<typeof mappingKeysFor>[0]);
  const keys = songKey ? [titleKey, songKey] : [titleKey];
  const existing = await itemMappings.listItemMappings({ includeDeleted: true });
  const mapSnaps: MappingSnapshot[] = [];
  for (const key of keys) {
    const prev = existing.find((m) => m.id === key);
    mapSnaps.push({ key, previous: prev ? { ...prev } : "absent" });
    await itemMappings.upsertItemMapping({ key, kind: "slides", deckId: deck.id });
  }

  // Save the song once with the pointer, then tombstone it.
  await songs.saveSong({ ...song, customFields: { ...song.customFields, [CONVERTED_TO_DECK_KEY]: deck.id } });
  await songs.deleteSong(song.id);

  const conversionId = randomUUID();
  CONVERSIONS.set(conversionId, { song, deckId: deck.id, shows: showSnaps, mappings: mapSnaps });

  return {
    conversionId,
    deck,
    rows: rowCount,
    shows: showSnaps.length,
    warnings,
    changedShowIds: showSnaps.map((s) => s.after.id),
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
  CONVERSIONS.delete(conversionId);

  // The song comes back as it was (saveSong clears the tombstone).
  await songs.saveSong(snap.song);

  const restoredShowIds: string[] = [];
  let skippedShows = 0;
  for (const { before, after } of snap.shows) {
    const current = await shows.getShow(before.id);
    const untouched =
      current !== null &&
      current.updatedAt === after.updatedAt &&
      JSON.stringify(current) === JSON.stringify(after);
    if (!untouched) {
      skippedShows++;
      continue;
    }
    await shows.saveShow(before);
    restoredShowIds.push(before.id);
  }

  const now = new Date().toISOString();
  const live = await itemMappings.listItemMappings({ includeDeleted: true });
  for (const { key, previous } of snap.mappings) {
    const current = live.find((m) => m.id === key);
    // Someone re-pointed the mapping since: leave their choice.
    if (current && current.deckId !== snap.deckId) continue;
    if (previous === "absent") await itemMappings.deleteItemMapping(key);
    else await itemMappings.putItemMapping({ ...previous, updatedAt: now });
  }

  // A skipped show still has rows on the deck, so the deck stays.
  if (skippedShows === 0) await decks.deleteDeck(snap.deckId);

  return {
    songId: snap.song.id,
    restoredShows: restoredShowIds.length,
    skippedShows,
    restoredShowIds,
  };
}
