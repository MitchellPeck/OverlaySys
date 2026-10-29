import { describe, expect, it } from "vitest";
import { mergeLibrary, addedAt, songSearchText, songSorts, type LibraryRow } from "./librarySearch";

const sortIds = (rs: LibraryRow[], id: string) =>
  rs.slice().sort(songSorts.find((s) => s.id === id)!.compare).map((r) => r.id);

describe("songSorts", () => {
  const rs: LibraryRow[] = [
    { id: "none", title: "Zeta" },
    { id: "edited", title: "Beta", updatedAt: "2026-10-10T00:00:00Z" },
    { id: "created", title: "Alpha", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", lastUsed: "2026-09-01" },
    { id: "none2", title: "Eta" },
  ];
  it("defaults to date added, newest first, falling back to updatedAt, unstamped last by title", () => {
    expect(songSorts[0]!.id).toBe("added-desc");
    expect(sortIds(rs, "added-desc")).toEqual(["created", "edited", "none2", "none"]);
  });
  it("addedAt prefers createdAt then updatedAt", () => {
    expect(addedAt(rs[2]!)).toBe("2026-10-20T00:00:00Z");
    expect(addedAt(rs[1]!)).toBe("2026-10-10T00:00:00Z");
    expect(addedAt(rs[0]!)).toBe("");
  });
  it("offers title, recently edited and last used", () => {
    expect(songSorts.map((s) => s.id)).toEqual(["added-desc", "title-asc", "edited-desc", "used-desc"]);
    expect(sortIds(rs, "title-asc")).toEqual(["created", "edited", "none2", "none"]);
    expect(sortIds(rs, "edited-desc")).toEqual(["created", "edited", "none2", "none"]);
    expect(sortIds(rs, "used-desc")[0]).toBe("created");
  });
});

describe("songSearchText", () => {
  it("includes title, author, CCLI and lyrics when loaded", () => {
    const text = songSearchText({ id: "a", title: "Title One", author: "Au Thor", ccliNumber: "123", lyrics: "line one here" });
    for (const w of ["Title One", "Au Thor", "123", "line one here"]) expect(text).toContain(w);
  });
  it("works without lyrics", () => {
    expect(songSearchText({ id: "a", title: "T" })).toContain("T");
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
