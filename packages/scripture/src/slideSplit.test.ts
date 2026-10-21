import { describe, expect, it } from "vitest";
import { splitIntoSlides, DEFAULT_SLIDE_BUDGET, tokenize, breaksToSlides, slidesToBreaks, splitLongText, SLIDE_SIZE_PRESETS } from "./slideSplit";
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

describe("word/break model", () => {
  const verses = [
    V("JHN", 3, 16, "For God so loved the world"),
    V("JHN", 3, 17, "For God sent not his Son"),
  ];

  it("tokenize tags each word with its verse index and drops empty words", () => {
    const words = tokenize([V("JHN", 3, 16, "  a\n b  "), V("JHN", 3, 17, "c")]);
    expect(words).toEqual([
      { verseIdx: 0, text: "a" },
      { verseIdx: 0, text: "b" },
      { verseIdx: 1, text: "c" },
    ]);
  });

  it("breaksToSlides with no breaks yields one slide of whole verses", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set());
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toEqual(verses);
  });

  it("breaksToSlides splits mid-verse into two portions of the same verse", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set([3])); // after "For God so"
    expect(slides).toHaveLength(2);
    expect(slides[0]!.verses).toEqual([V("JHN", 3, 16, "For God so")]);
    expect(slides[1]!.verses).toEqual([
      V("JHN", 3, 16, "loved the world"),
      V("JHN", 3, 17, "For God sent not his Son"),
    ]);
  });

  it("breaksToSlides ignores out-of-range breaks and never emits empty slides", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set([0, words.length, 99]));
    expect(slides).toHaveLength(1);
  });

  it("slidesToBreaks merges portions of a verse back into one verse", () => {
    const model = slidesToBreaks([
      { verses: [V("JHN", 3, 16, "For God so")] },
      { verses: [V("JHN", 3, 16, "loved the world"), V("JHN", 3, 17, "For God sent not his Son")] },
    ]);
    expect(model.verses).toEqual(verses);
    expect([...model.breaks]).toEqual([3]);
  });

  it("round-trips slides → breaks → slides", () => {
    const original = [
      { verses: [V("JHN", 3, 16, "For God so")] },
      { verses: [V("JHN", 3, 16, "loved the world")] },
      { verses: [V("JHN", 3, 17, "For God sent not his Son")] },
    ];
    const m = slidesToBreaks(original);
    const back = breaksToSlides(m.verses, m.words, m.breaks);
    expect(back.map((s) => s.verses)).toEqual(original.map((s) => s.verses));
  });

  it("slidesToBreaks collapses whitespace-only entries without creating empty slides", () => {
    const m = slidesToBreaks([
      { verses: [V("JHN", 3, 16, "a b")] },
      { verses: [V("JHN", 3, 17, "   ")] },
      { verses: [V("JHN", 3, 18, "c")] },
    ]);
    const back = breaksToSlides(m.verses, m.words, m.breaks);
    expect(back.every((s) => s.verses.length > 0)).toBe(true);
    expect(back.flatMap((s) => s.verses.map((v) => v.text))).toEqual(["a b", "c"]);
  });
});

describe("splitLongText", () => {
  it("cuts at the last clause punctuation within the budget", () => {
    const text = "aaaa aaaa aaaa, bbbb bbbb; cccc cccc cccc cccc";
    expect(splitLongText(text, 26)).toEqual(["aaaa aaaa aaaa, bbbb bbbb;", "cccc cccc cccc cccc"]);
  });

  it("falls back to the last space when there is no usable punctuation", () => {
    expect(splitLongText("aaa bbb ccc ddd", 8)).toEqual(["aaa bbb", "ccc ddd"]);
  });

  it("balances pieces instead of leaving a tiny remainder", () => {
    // 23 chars into 2 pieces → aim for ~11 each, not 16 + 6
    expect(splitLongText("a, bbbbbb cccccc dddddd", 16)).toEqual(["a, bbbbbb", "cccccc dddddd"]);
  });

  it("John 3:16 on the Short preset has no tiny fragment", () => {
    const text =
      "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    const pieces = splitLongText(text, 120);
    expect(pieces).toHaveLength(2);
    for (const p of pieces) expect(p.length).toBeGreaterThanOrEqual(40);
    expect(pieces[0]).toBe("For God so loved the world, that he gave his only begotten Son,");
  });

  it("falls back on any whitespace, not just spaces", () => {
    const text = Array.from({ length: 20 }, () => "word").join("\n");
    const pieces = splitLongText(text, 40);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(40);
  });

  it("keeps a word with no spaces whole", () => {
    const long = "x".repeat(50);
    expect(splitLongText(long, 10)).toEqual([long]);
  });

  it("returns the text unchanged when it fits", () => {
    expect(splitLongText("short", 100)).toEqual(["short"]);
  });
});

describe("splitIntoSlides (mid-verse)", () => {
  it("splits an overlong verse across slides", () => {
    const text = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.";
    const slides = splitIntoSlides([V("JHN", 3, 16, text)], { maxChars: 60 });
    expect(slides.length).toBeGreaterThan(1);
    for (const s of slides) {
      expect(s.verses).toHaveLength(1);
      expect(s.verses[0]!.verse).toBe(16);
      expect(s.verses[0]!.text.length).toBeLessThanOrEqual(60);
    }
    expect(slides.map((s) => s.verses[0]!.text).join(" ")).toBe(text);
  });

  it("never puts two fragments of the same verse on one slide", () => {
    // early comma forces a space-cut; remaining fragments are short enough to pack together
    const text = "a, " + "bbbbbbbbb ".repeat(4) + "c, d";
    const slides = splitIntoSlides([V("JHN", 3, 16, text)], { maxChars: 20 });
    for (const s of slides) {
      const keys = s.verses.map((v) => `${v.chapter}:${v.verse}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("has no verse-count limit when maxLines is omitted", () => {
    const verses = Array.from({ length: 8 }, (_, i) => V("JHN", 3, 16 + i, "a"));
    expect(splitIntoSlides(verses, { maxChars: 1000 })).toHaveLength(1);
  });

  it("presets produce more slides for smaller sizes", () => {
    // 63 chars each → short: 1/slide (8), medium: 3/slide (3), long: 5/slide (2)
    const verses = Array.from({ length: 8 }, (_, i) =>
      V("JHN", 3, 16 + i, "For God so loved the world, that he gave his only begotten Son."),
    );
    const n = (p: keyof typeof SLIDE_SIZE_PRESETS) => splitIntoSlides(verses, SLIDE_SIZE_PRESETS[p]).length;
    expect(n("short")).toBeGreaterThan(n("medium"));
    expect(n("medium")).toBeGreaterThan(n("long"));
    expect(SLIDE_SIZE_PRESETS.medium).toEqual(DEFAULT_SLIDE_BUDGET);
  });
});

describe("splitIntoSlides (separator-aware budget)", () => {
  it("counts the space between verses so a fresh split never exceeds the budget", () => {
    const verses = Array.from({ length: 3 }, (_, i) => V("JHN", 3, 16 + i, "x".repeat(80)));
    const slides = splitIntoSlides(verses, { maxChars: 240 });
    for (const s of slides) {
      expect(s.verses.map((v) => v.text).join(" ").length).toBeLessThanOrEqual(240);
    }
    expect(slides).toHaveLength(2);
  });
});
