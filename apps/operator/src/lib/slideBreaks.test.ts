import { describe, expect, it } from "vitest";
import {
  addBreak, removeBreak, moveBreak, nudgeTarget, isVerseBoundary,
  slideStarts, slideCharCounts, stableSlideIds, lyricSlideStats, LYRIC_SLIDE_BUDGET,
} from "./slideBreaks";

// verse 0: "a b c" (words 0-2), verse 1: "d e" (words 3-4), verse 2: "f" (word 5)
const words = [
  { verseIdx: 0, text: "a" }, { verseIdx: 0, text: "b" }, { verseIdx: 0, text: "c" },
  { verseIdx: 1, text: "d" }, { verseIdx: 1, text: "e" },
  { verseIdx: 2, text: "f" },
];
const N = words.length;

describe("addBreak / removeBreak", () => {
  it("adds a break inside the passage", () => {
    expect([...addBreak(new Set(), 2, N)]).toEqual([2]);
  });
  it("rejects index 0 and >= wordCount (no empty slides)", () => {
    expect(addBreak(new Set(), 0, N).size).toBe(0);
    expect(addBreak(new Set(), N, N).size).toBe(0);
  });
  it("does not mutate input", () => {
    const b = new Set([1]);
    addBreak(b, 2, N);
    removeBreak(b, 1);
    expect([...b]).toEqual([1]);
  });
  it("removes a break", () => {
    expect(removeBreak(new Set([1, 3]), 1)).toEqual(new Set([3]));
  });
});

describe("moveBreak", () => {
  it("moves to a free gap", () => {
    expect(moveBreak(new Set([3]), 3, 1, N)).toEqual(new Set([1]));
  });
  it("refuses to land on an existing break or out of range", () => {
    expect(moveBreak(new Set([1, 3]), 3, 1, N)).toEqual(new Set([1, 3]));
    expect(moveBreak(new Set([3]), 3, 0, N)).toEqual(new Set([3]));
    expect(moveBreak(new Set([3]), 3, N, N)).toEqual(new Set([3]));
  });
});

describe("nudgeTarget", () => {
  it("moves one word", () => {
    expect(nudgeTarget(words, 3, -1, "word")).toBe(2);
    expect(nudgeTarget(words, 3, 1, "word")).toBe(4);
  });
  it("returns null at the edges", () => {
    expect(nudgeTarget(words, 1, -1, "word")).toBeNull();
    expect(nudgeTarget(words, N - 1, 1, "word")).toBeNull();
  });
  it("jumps to the previous/next verse boundary", () => {
    expect(nudgeTarget(words, 4, -1, "verse")).toBe(3);
    expect(nudgeTarget(words, 3, 1, "verse")).toBe(5);
    expect(nudgeTarget(words, 1, 1, "verse")).toBe(3);
    expect(nudgeTarget(words, 3, -1, "verse")).toBeNull();
  });
});

describe("helpers", () => {
  it("isVerseBoundary", () => {
    expect(isVerseBoundary(words, 3)).toBe(true);
    expect(isVerseBoundary(words, 2)).toBe(false);
    expect(isVerseBoundary(words, 0)).toBe(false);
  });
  it("slideStarts sorts breaks after 0", () => {
    expect(slideStarts(new Set([5, 2]))).toEqual([0, 2, 5]);
  });
  it("slideCharCounts counts word lengths plus single spaces per slide", () => {
    expect(slideCharCounts(words, new Set([3]))).toEqual([5, 5]); // "a b c" | "d e f"
  });
  it("stableSlideIds keeps ids whose start is unchanged and mints unique new ones", () => {
    const ids = stableSlideIds(["slide-0", "slide-1"], [0, 3], [0, 2, 3]);
    expect(ids[0]).toBe("slide-0");
    expect(ids[2]).toBe("slide-1");
    expect(new Set(ids).size).toBe(3);
  });
});

describe("lyricSlideStats", () => {
  it("counts chars with line breaks as one space and ignores trailing empty lines", () => {
    expect(lyricSlideStats(["abc", "de", ""])).toEqual({ chars: 6, lines: 2, overChars: false, overLines: false });
  });
  it("reports an empty slide as zero", () => {
    expect(lyricSlideStats([""])).toMatchObject({ chars: 0, lines: 0 });
  });
  it("flags lines and chars over budget", () => {
    expect(lyricSlideStats(["a", "b", "c"], { maxChars: 4, maxLines: 2 })).toMatchObject({
      overChars: true,
      overLines: true,
    });
  });
  it("defaults to the lyric budget", () => {
    expect(lyricSlideStats(["x".repeat(LYRIC_SLIDE_BUDGET.maxChars + 1)]).overChars).toBe(true);
    expect(lyricSlideStats(["x".repeat(LYRIC_SLIDE_BUDGET.maxChars)]).overChars).toBe(false);
  });
});
