import { describe, expect, it } from "vitest";
import { splitIntoSlides, DEFAULT_SLIDE_BUDGET } from "./slideSplit";
import type { ScriptureVerse } from "./types";

const V = (book: string, chapter: number, verse: number, text: string): ScriptureVerse =>
  ({ book, chapter, verse, text });

describe("splitIntoSlides", () => {
  it("packs short verses onto one slide", () => {
    const verses = [
      V("JHN", 3, 16, "For God so loved the world,"),
      V("JHN", 3, 17, "that he gave his only Son."),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 240, maxLines: 4 });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toEqual(verses);
  });

  it("splits when char budget exceeded", () => {
    const long = "x".repeat(150);
    const verses = [
      V("JHN", 3, 16, long),
      V("JHN", 3, 17, long),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    expect(slides).toHaveLength(2);
    expect(slides[0]!.verses).toHaveLength(1);
    expect(slides[1]!.verses).toHaveLength(1);
  });

  it("splits when line budget exceeded", () => {
    // Each verse is 1 line by default.
    const verses = [
      V("JHN", 3, 16, "a"),
      V("JHN", 3, 17, "b"),
      V("JHN", 3, 18, "c"),
      V("JHN", 3, 19, "d"),
      V("JHN", 3, 20, "e"),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 1000, maxLines: 2 });
    expect(slides).toHaveLength(3);
    expect(slides[0]!.verses.map((v) => v.verse)).toEqual([16, 17]);
    expect(slides[1]!.verses.map((v) => v.verse)).toEqual([18, 19]);
    expect(slides[2]!.verses.map((v) => v.verse)).toEqual([20]);
  });

  it("gives a single overlong verse its own slide rather than splitting it", () => {
    const long = "x".repeat(1000);
    const slides = splitIntoSlides([V("JHN", 3, 16, long)], {
      maxChars: 100,
      maxLines: 4,
    });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toHaveLength(1);
    expect(slides[0]!.verses[0]!.text).toBe(long);
  });

  it("preserves verse order across slides", () => {
    const verses = Array.from({ length: 10 }, (_, i) =>
      V("JHN", 3, 16 + i, "x".repeat(100)),
    );
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    const flat = slides.flatMap((s) => s.verses.map((v) => v.verse));
    expect(flat).toEqual(verses.map((v) => v.verse));
  });

  it("returns an empty array when input is empty", () => {
    expect(splitIntoSlides([], DEFAULT_SLIDE_BUDGET)).toEqual([]);
  });

  it("each slide has a unique id", () => {
    const verses = Array.from({ length: 5 }, (_, i) =>
      V("JHN", 3, 16 + i, "x".repeat(100)),
    );
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    const ids = new Set(slides.map((s) => s.id));
    expect(ids.size).toBe(slides.length);
  });
});
