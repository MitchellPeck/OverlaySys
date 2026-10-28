import { describe, expect, it } from "vitest";
import { mergeLibrary, songMatches, sortLibrary, type LibraryRow } from "./librarySearch";

const rows: LibraryRow[] = [
  { id: "b", title: "Oceans (Where Feet May Fail)", author: "Hillsong", ccliNumber: "6428767", updatedAt: "2026-10-01T00:00:00Z" },
  { id: "a", title: "Amazing Grace", author: "John Newton", ccliNumber: "22025", lyrics: "how sweet the sound" },
  { id: "c", title: "Été", updatedAt: "2026-10-20T00:00:00Z" },
];

describe("songMatches", () => {
  it("matches title words ignoring punctuation and case", () => {
    expect(songMatches(rows[0]!, "oceans where")).toBe(true);
  });
  it("matches author, CCLI and lyrics", () => {
    expect(songMatches(rows[1]!, "newton")).toBe(true);
    expect(songMatches(rows[1]!, "22025")).toBe(true);
    expect(songMatches(rows[1]!, "sweet sound")).toBe(true);
  });
  it("requires every term and ignores diacritics", () => {
    expect(songMatches(rows[1]!, "grace hillsong")).toBe(false);
    expect(songMatches(rows[2]!, "ete")).toBe(true);
  });
  it("matches everything for a blank query", () => {
    expect(songMatches(rows[0]!, "  ")).toBe(true);
  });
});

describe("sortLibrary", () => {
  it("sorts A–Z", () => {
    expect(sortLibrary(rows, "title").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts recently edited first, unstamped last", () => {
    expect(sortLibrary(rows, "recent").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("mergeLibrary", () => {
  it("keeps the WS list as the set of songs and adds HTTP details", () => {
    const merged = mergeLibrary(
      [{ id: "a", title: "Amazing Grace (renamed)" }, { id: "new", title: "New" }],
      [{ id: "a", title: "Amazing Grace", usedIn: 3 }, { id: "gone", title: "Gone" }],
    );
    expect(merged).toEqual([
      { id: "a", title: "Amazing Grace (renamed)", usedIn: 3, updatedAt: undefined },
      { id: "new", title: "New" },
    ]);
  });
});
