import { describe, expect, it } from "vitest";
import type { Show, Song, SongRow, Template } from "@overlaysys/core";
import { songCueChannel, songLyricsMessage, songRowChannel, songTakeChannel } from "./songChannel";

const row = (extra: Partial<SongRow> = {}): SongRow =>
  ({ kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lyr", ...extra }) as SongRow;
const show = (channelOverride?: string): Show =>
  ({ id: "show", name: "Show", rows: [], songs: [{ songId: "s1", ...(channelOverride ? { channelOverride } : {}) }] }) as unknown as Show;
const song = (defaultChannel?: string): Song =>
  ({ id: "s1", title: "S", sections: [], defaultArrangement: [], customFields: {}, ...(defaultChannel ? { defaultChannel } : {}) }) as unknown as Song;
const tpl = (defaultChannel?: string): Template => ({ id: "lyr", defaultChannel }) as unknown as Template;

describe("songRowChannel", () => {
  it("uses the full cascade once the song is cached", () => {
    const caches = { songCache: { s1: song() }, templateCache: { lyr: tpl("lyrics") } };
    expect(songRowChannel(row(), show(), caches)).toBe("lyrics");
    expect(songRowChannel(row(), show("side"), caches)).toBe("side");
    expect(songRowChannel(row({ channelHint: "hint" }), show("side"), caches)).toBe("hint");
  });

  it("uses row and show-song levels before the song body arrives", () => {
    const caches = { songCache: {}, templateCache: {} };
    expect(songRowChannel(row(), show("side"), caches)).toBe("side");
    expect(songRowChannel(row(), show(), caches)).toBeUndefined();
  });

  it("takes default to program; cues never go to program", () => {
    const empty = { songCache: {}, templateCache: {} };
    expect(songTakeChannel(row(), show(), empty)).toBe("program");
    expect(songCueChannel(row(), show(), empty)).toBe("preview");
    expect(songCueChannel(row({ channelHint: "program" }), show(), empty)).toBe("preview");
  });

  it("songCueChannel is preview even when the song routes to another output", () => {
    const empty = { songCache: {}, templateCache: {} };
    const r = row({ channelHint: "lyrics-out" });
    expect(songCueChannel(r, show(), empty)).toBe("preview");
    expect(songTakeChannel(r, show(), empty)).toBe("lyrics-out");
  });
});

describe("songLyricsMessage", () => {
  const rowA = { kind: "song", id: "a", songId: "s1", lyricTemplateId: "lyr" } as unknown as SongRow;
  const rowB = { ...rowA, id: "b" } as SongRow;
  const video = { kind: "video", id: "v" };
  const mk = (rows: unknown[]) => ({ id: "sh", rows, songs: [] }) as unknown as Show;
  const sess = { songId: "s1" } as never;
  const st = (rowId?: string, showId = "sh") =>
    ({ program: { channel: "program", active: null, ...(rowId ? { liveRow: { showId, rowId } } : {}) } }) as never;
  const take = (r: SongRow) => ({ type: "song_take", channel: "program", showId: "sh", songRowId: r.id });
  const adv = { type: "song_advance", channel: "program", delta: 1 };

  it("advances only the exact live row", () => {
    expect(songLyricsMessage(rowB, mk([rowA, rowB]), "program", st("b"), sess)).toEqual(adv);
    expect(songLyricsMessage(rowA, mk([rowA, rowB]), "program", st("b"), sess)).toEqual(take(rowA));
  });

  it("reprise after a video take, or with no liveRow: takes the row instead of advancing", () => {
    const show = mk([rowA, video, rowB]);
    expect(songLyricsMessage(rowB, show, "program", st("v"), sess)).toEqual(take(rowB));
    expect(songLyricsMessage(rowB, show, "program", st(), sess)).toEqual(take(rowB));
  });

  it("the song's only row advances without an exact liveRow; another show's session never advances", () => {
    expect(songLyricsMessage(rowA, mk([rowA, video]), "program", st("v"), sess)).toEqual(adv);
    expect(songLyricsMessage(rowA, mk([rowA]), "program", st(), sess)).toEqual(adv);
    expect(songLyricsMessage(rowA, mk([rowA]), "program", st("a", "other"), sess)).toEqual(take(rowA));
  });

  it("no session, or another song: takes", () => {
    expect(songLyricsMessage(rowA, mk([rowA]), "program", st("a"), null)).toEqual(take(rowA));
    expect(songLyricsMessage(rowA, mk([rowA]), "program", st("a"), { songId: "x" } as never)).toEqual(take(rowA));
  });
});
