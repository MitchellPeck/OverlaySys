import { describe, expect, it } from "vitest";
import type { Show, Song } from "@overlaysys/core";
import { buildSongLibrary, parseReportRange } from "./songLibraryRoute";

function song(id: string, over: Partial<Song> = {}): Song {
  return {
    id,
    title: id.toUpperCase(),
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["hello", "world"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
    ...over,
  };
}

function songRow(id: string, songId: string): Show["rows"][number] {
  return { kind: "song", id, songId, lyricTemplateId: "t" } as Show["rows"][number];
}

describe("buildSongLibrary", () => {
  it("counts each show once per song and flattens lyrics", () => {
    const lib = buildSongLibrary(
      [song("a", { updatedAt: "2026-10-01T00:00:00.000Z" }), song("b")],
      [song("gone", { deletedAt: "2026-10-02T00:00:00.000Z" })],
      [
        { name: "Sunday", rows: [songRow("r1", "a"), songRow("r2", "a")] },
        { name: "Wednesday", rows: [songRow("r3", "a")] },
      ],
    );
    const a = lib.songs.find((s) => s.id === "a")!;
    expect(a.usedIn).toBe(2);
    expect(a.usedInShows).toEqual(["Sunday", "Wednesday"]);
    expect(a.updatedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(a.lyrics).toContain("hello\nworld");
    expect(lib.songs.find((s) => s.id === "b")!.usedIn).toBe(0);
    expect(lib.deleted).toEqual([
      { id: "gone", title: "GONE", author: undefined, ccliNumber: undefined, deletedAt: "2026-10-02T00:00:00.000Z", customFields: {} },
    ]);
  });
});

describe("buildSongLibrary deleted rows", () => {
  it("passes converted_to_deck through so the editor can name the deck", () => {
    const lib = buildSongLibrary(
      [],
      [song("conv", { deletedAt: "2026-10-02T00:00:00.000Z", customFields: { converted_to_deck: "deck-1" } })],
      [],
    );
    expect(lib.deleted[0]!.customFields).toEqual({ converted_to_deck: "deck-1" });
  });
});

describe("buildSongLibrary createdAt and lastUsed", () => {
  it("passes createdAt through and reports lastUsed as the latest past show date", () => {
    const lib = buildSongLibrary(
      [song("a", { createdAt: "2026-01-02T00:00:00.000Z" }), song("b")],
      [],
      [
        { name: "Old", scheduledFor: "2020-03-01", rows: [songRow("r1", "a")] },
        { name: "Newer", scheduledFor: "2021-04-05", rows: [songRow("r2", "a")] },
        { name: "Future", scheduledFor: "2999-01-01", rows: [songRow("r3", "a"), songRow("r4", "b")] },
        { name: "Undated", rows: [songRow("r5", "b")] },
      ],
    );
    const a = lib.songs.find((s) => s.id === "a")!;
    expect(a.createdAt).toBe("2026-01-02T00:00:00.000Z");
    expect(a.lastUsed).toBe("2021-04-05");
    const b = lib.songs.find((s) => s.id === "b")!;
    expect(b.createdAt).toBeUndefined();
    expect(b.lastUsed).toBeUndefined();
  });
});

describe("parseReportRange", () => {
  it("accepts open ranges", () => {
    expect(parseReportRange(undefined, undefined)).toEqual({});
  });
  it("makes `to` inclusive of the whole day", () => {
    const r = parseReportRange("2026-10-01", "2026-10-31")!;
    expect(r.to!.getTime()).toBe(new Date("2026-11-01T00:00:00").getTime());
  });
  it("rejects malformed dates", () => {
    expect(parseReportRange("10/01/2026", undefined)).toBeNull();
  });
});
