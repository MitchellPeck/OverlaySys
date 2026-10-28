import { describe, expect, it } from "vitest";
import type { Show, Song, SongRow, Template } from "@overlaysys/core";
import { songCueChannel, songRowChannel, songTakeChannel } from "./songChannel";

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
    expect(songCueChannel(row({ channelHint: "lyrics" }), show(), empty)).toBe("lyrics");
  });
});
