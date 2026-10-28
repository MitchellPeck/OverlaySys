import { describe, expect, it } from "vitest";
import type { Section, Song } from "@overlaysys/core";
import { decideIncomingSong, moveByOne, nextSlideId, sameSongContent } from "./songDraftOps";

function section(id: string, slideIds: string[]): Section {
  return { id, kind: "verse", label: id, slides: slideIds.map((s) => ({ id: s, lines: [s] })) };
}

function song(over: Partial<Song> = {}): Song {
  return {
    id: "s",
    title: "T",
    sections: [section("v1", ["v1s1"])],
    defaultArrangement: ["v1"],
    customFields: {},
    ...over,
  };
}

describe("nextSlideId", () => {
  it("appends the next number", () => {
    const sec = section("v1", ["v1s1", "v1s2"]);
    expect(nextSlideId({ sections: [sec] }, sec)).toBe("v1s3");
  });

  it("skips a suffix still in use after a delete", () => {
    // v1s1, v1s2, v1s3 → delete v1s2 → counting would give v1s3 again.
    const sec = section("v1", ["v1s1", "v1s3"]);
    expect(nextSlideId({ sections: [sec] }, sec)).toBe("v1s4");
  });

  it("avoids ids used by other sections", () => {
    const a = section("v1", ["v1s1"]);
    const b = section("x", ["v1s2"]);
    expect(nextSlideId({ sections: [a, b] }, a)).toBe("v1s3");
  });
});

describe("moveByOne", () => {
  it("moves up and down", () => {
    expect(moveByOne(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveByOne(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("is a no-op at the edges", () => {
    expect(moveByOne(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveByOne(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("decideIncomingSong", () => {
  const base = song();
  const edited = song({ title: "Mine" });
  const remote = song({ title: "Theirs" });

  it("adopts when nothing is loaded yet", () => {
    expect(decideIncomingSong({ draft: null, baseline: null }, base)).toBe("adopt");
  });

  it("adopts another client's change when clean", () => {
    expect(decideIncomingSong({ draft: base, baseline: base }, remote)).toBe("adopt");
  });

  it("treats its own save echo as a rebase, ignoring updatedAt", () => {
    const echo = { ...edited, updatedAt: "2026-01-01T00:00:00.000Z" };
    expect(decideIncomingSong({ draft: edited, baseline: edited }, echo)).toBe("rebase");
  });

  it("rebases on the save echo even when the user typed during the save", () => {
    const typedMore = song({ title: "Mine, more" });
    expect(decideIncomingSong({ draft: typedMore, baseline: edited }, edited)).toBe("rebase");
  });

  it("flags a conflict when dirty and the song changed elsewhere", () => {
    expect(decideIncomingSong({ draft: edited, baseline: base }, remote)).toBe("conflict");
  });

  it("sameSongContent ignores write stamps", () => {
    expect(sameSongContent(base, { ...base, updatedAt: "x" })).toBe(true);
    expect(sameSongContent(base, edited)).toBe(false);
  });
});
