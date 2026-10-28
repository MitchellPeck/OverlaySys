import { describe, expect, it } from "vitest";
import type { SongMeta } from "@overlaysys/core";
import { rankSongs } from "./songPicker";

const songs = [
  { id: "s-sub", title: "Bright morning", author: "X" },
  { id: "s-word", title: "A new morning", author: "X" },
  { id: "s-pre", title: "Morning song", author: "X" },
  { id: "s-auth", title: "Other", author: "Mornington" },
  { id: "s-ccli", title: "Zed", ccliNumber: "1234567" },
  { id: "s-b", title: "Beta" },
  { id: "s-a", title: "Alpha" },
] as SongMeta[];

describe("rankSongs", () => {
  it("title prefix > word start > author/ccli", () => {
    // "Bright morning" is also a word-start match, so it ties with "A new morning" (title order breaks it).
    expect(rankSongs(songs, "mor", []).map((s) => s.id)).toEqual(["s-pre", "s-word", "s-sub", "s-auth"]);
  });
  it("recent breaks ties", () => {
    const r = rankSongs([{ id: "1", title: "Grace one" }, { id: "2", title: "Grace two" }] as SongMeta[], "grace", ["2"]);
    expect(r[0]!.id).toBe("2");
  });
  it("empty query: recent first, then title", () => {
    expect(rankSongs(songs, "", ["s-b"]).map((s) => s.id).slice(0, 3)).toEqual(["s-b", "s-word", "s-a"]);
  });
  it("matches CCLI number", () => expect(rankSongs(songs, "1234567", [])[0]!.id).toBe("s-ccli"));
  it("subsequence matches rank last", () => {
    expect(rankSongs(songs, "bgm", []).map((s) => s.id)).toEqual(["s-sub"]);
    expect(rankSongs(songs, "xyz", [])).toEqual([]);
  });
});
