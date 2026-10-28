import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PCO_SONG_ID_KEY, type Show, type Song, type Template } from "@overlaysys/core";

// CCLI usage logging writes to the data dir; keep tests off disk.
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

import * as channels from "./channels";
import * as decks from "./decks";
import { convertSongToDeck, undoConversion } from "./decksConvert";
import * as itemMappings from "./pco/itemMappings";
import * as shows from "./shows";
import * as songSession from "./songSession";
import * as songs from "./songs";
import * as templates from "./templates";

let tmpDir: string;
let prevData: string | undefined;
let prevFix: string | undefined;

const TODAY = "2026-10-28";

// Placeholder lyrics only.
const song: Song = {
  id: "song-1",
  title: "Placeholder Song",
  ccliNumber: "123",
  defaultLyricTemplateId: "lyric-t",
  sections: [
    { id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "a", lines: ["Line A1", "Line A2"] }] },
    { id: "c", kind: "chorus", label: "Chorus", slides: [{ id: "b", lines: ["Line B1"] }] },
  ],
  defaultArrangement: ["v1", "c"],
  customFields: { [PCO_SONG_ID_KEY]: "pco-77" },
};

function show(id: string, scheduledFor: string | undefined, extraRows: Show["rows"] = []): Show {
  return {
    id,
    name: id,
    projectId: "default",
    ...(scheduledFor ? { scheduledFor } : {}),
    rows: [
      { kind: "song", id: `${id}-r1`, songId: song.id, lyricTemplateId: "lyric-t", lengthSec: 200 },
      ...extraRows,
    ],
    songs: [{ songId: song.id, channelOverride: "program" }],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-conv-"));
  prevData = process.env["OVERLAYSYS_DATA_DIR"];
  prevFix = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await songs.reloadSongs();
  await shows.reloadShows();
  await decks.reloadDecks();
  await templates.reloadTemplates();
  await itemMappings.reloadItemMappings();
  songSession.endAll();
  channels.setActiveNull("program");
  await songs.saveSong(song);
  await shows.saveShow(show("past", "2026-10-20"));
  await shows.saveShow(show("next", "2026-11-01"));
  await shows.saveShow(show("undated", undefined));
});

afterEach(async () => {
  songSession.endAll();
  channels.setActiveNull("program");
  if (prevData === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevData;
  if (prevFix === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFix;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("convertSongToDeck", () => {
  it("rewrites upcoming shows only, records mappings, tombstones the song with the pointer", async () => {
    const res = await convertSongToDeck(song.id, { titleSlide: false, today: TODAY });
    expect(res.shows).toBe(2);
    expect(res.rows).toBe(2);
    expect(res.deck.name).toBe("Placeholder Song");
    expect(res.deck.licensing).toEqual({ kind: "ccli", ccliNumber: "123" });
    expect(await decks.getDeck(res.deck.id)).not.toBeNull();

    const past = (await shows.getShow("past"))!;
    expect(past.rows[0]).toMatchObject({ kind: "song", songId: song.id });
    expect(past.songs).toHaveLength(1);

    for (const id of ["next", "undated"]) {
      const s = (await shows.getShow(id))!;
      expect(s.rows[0]).toEqual({ kind: "slides", id: `${id}-r1`, deckId: res.deck.id, lengthSec: 200 });
      expect(s.songs).toEqual([]);
    }

    const maps = await itemMappings.listItemMappings();
    expect(maps.map((m) => m.key).sort()).toEqual(["pcoSong:pco-77", "title:placeholder song"]);
    expect(maps.every((m) => m.deckId === res.deck.id && m.kind === "slides")).toBe(true);

    expect(await songs.getSong(song.id)).toBeNull();
    const dead = (await songs.listDeletedSongs()).find((s) => s.id === song.id)!;
    expect(dead.customFields["converted_to_deck"]).toBe(res.deck.id);
  });

  it("keeps the ShowSong entry when another row still uses the song", async () => {
    // A second song row that is live on program stays a song row.
    await shows.saveShow(
      show("next", "2026-11-01", [{ kind: "song", id: "next-r2", songId: song.id, lyricTemplateId: "lyric-t" }]),
    );
    channels.setLiveRow("program", { showId: "next", rowId: "next-r2" });
    songSession.start("program", {
      song,
      lyricTemplateId: "lyric-t",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    const res = await convertSongToDeck(song.id, { titleSlide: false, today: TODAY });
    const s = (await shows.getShow("next"))!;
    expect(s.rows.map((r) => r.kind)).toEqual(["slides", "song"]);
    expect(s.songs).toHaveLength(1);
    expect(res.warnings.some((w) => w.includes("on air"))).toBe(true);
  });

  it("convert leaves a live song session alone", async () => {
    channels.setLiveRow("program", { showId: "next", rowId: "next-r1" });
    songSession.start("program", {
      song,
      lyricTemplateId: "lyric-t",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    const before = structuredClone(channels.getState("program"));
    await convertSongToDeck(song.id, { titleSlide: false, today: TODAY });
    const after = channels.getState("program");
    expect(after).toEqual(before);
    expect(after.active?.data.text).toBe("Line A1\nLine A2");
    // The live row itself was not rewritten.
    const s = (await shows.getShow("next"))!;
    expect(s.rows[0]).toMatchObject({ kind: "song", id: "next-r1" });
  });

  it("adds a title slide from the song's intro template", async () => {
    const tpl = {
      id: "intro-t",
      name: "Intro",
      size: { w: 1920, h: 1080 },
      fields: [{ key: "title", label: "Title", type: "text" }],
      layers: [],
    } as unknown as Template;
    await templates.saveTemplate(tpl);
    await songs.saveSong({ ...song, defaultIntroTemplateId: "intro-t", defaultIntroFieldMap: { title: "title" } });
    const res = await convertSongToDeck(song.id, { titleSlide: true, today: TODAY });
    expect(res.deck.slides[0]).toMatchObject({ templateId: "intro-t", data: { title: "Placeholder Song" } });
    expect(res.deck.slides).toHaveLength(3);
  });

  it("throws for an unknown song", async () => {
    await expect(convertSongToDeck("nope", { titleSlide: false, today: TODAY })).rejects.toThrow();
  });
});

describe("undoConversion", () => {
  it("undo restores the song, the shows and the mappings, and deletes the deck", async () => {
    await itemMappings.upsertItemMapping({ key: "title:placeholder song", kind: "slides", deckId: "older-deck" });
    const res = await convertSongToDeck(song.id, { titleSlide: false, today: TODAY });
    const out = await undoConversion(res.conversionId);
    expect(out).toMatchObject({ songId: song.id, restoredShows: 2, skippedShows: 0 });

    const restored = (await songs.getSong(song.id))!;
    expect(restored).not.toBeNull();
    expect(restored.customFields["converted_to_deck"]).toBeUndefined();

    for (const id of ["next", "undated"]) {
      const s = (await shows.getShow(id))!;
      expect(s.rows[0]).toMatchObject({ kind: "song", songId: song.id });
      expect(s.songs).toHaveLength(1);
    }

    const maps = await itemMappings.listItemMappings();
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ key: "title:placeholder song", deckId: "older-deck" });

    expect(await decks.getDeck(res.deck.id)).toBeNull();
    // A second undo is a no-op.
    expect(await undoConversion(res.conversionId)).toBeNull();
  });

  it("undo skips a show edited after the conversion", async () => {
    const res = await convertSongToDeck(song.id, { titleSlide: false, today: TODAY });
    expect(res.shows).toBe(2);
    await sleep(5);
    const next = (await shows.getShow("next"))!;
    await shows.saveShow({ ...next, name: "next edited" });

    const out = await undoConversion(res.conversionId);
    expect(out).toMatchObject({ songId: song.id, restoredShows: 1, skippedShows: 1 });
    const kept = (await shows.getShow("next"))!;
    expect(kept.name).toBe("next edited");
    expect(kept.rows[0]).toMatchObject({ kind: "slides", deckId: res.deck.id });
    // The edited show still uses the deck, so the deck stays.
    expect(await decks.getDeck(res.deck.id)).not.toBeNull();
    expect((await shows.getShow("undated"))!.rows[0]).toMatchObject({ kind: "song" });
  });

  it("undo with an unknown id returns null", async () => {
    expect(await undoConversion("nope")).toBeNull();
  });
});
