import { describe, expect, it } from "vitest";
import { guessScriptureReference, parseReference } from "./reference";
import { ScriptureRefError } from "./types";

describe("parseReference — single verse", () => {
  it("parses 'John 3:16'", () => {
    expect(parseReference("John 3:16")).toEqual([
      {
        book: "JHN",
        ranges: [{ chapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }],
      },
    ]);
  });

  it("accepts alternate book aliases", () => {
    expect(parseReference("Jn 3:16")[0]!.book).toBe("JHN");
    expect(parseReference("1 Cor 13:4")[0]!.book).toBe("1CO");
    expect(parseReference("1Cor 13:4")[0]!.book).toBe("1CO");
    expect(parseReference("Ps 23:1")[0]!.book).toBe("PSA");
  });

  it("tolerates extra whitespace", () => {
    expect(parseReference("  John   3:16  ")[0]!.ranges[0]).toEqual({
      chapter: 3, startVerse: 16, endChapter: 3, endVerse: 16,
    });
  });
});

describe("parseReference — ranges", () => {
  it("parses same-chapter range 'John 3:16-18'", () => {
    expect(parseReference("John 3:16-18")[0]!.ranges).toEqual([
      { chapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 },
    ]);
  });

  it("parses cross-chapter range 'John 3:16-4:2'", () => {
    expect(parseReference("John 3:16-4:2")[0]!.ranges).toEqual([
      { chapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 },
    ]);
  });

  it("rejects descending ranges within a chapter", () => {
    expect(() => parseReference("John 3:18-16")).toThrow(ScriptureRefError);
  });

  it("rejects descending cross-chapter ranges", () => {
    expect(() => parseReference("John 4:2-3:16")).toThrow(ScriptureRefError);
  });
});

describe("parseReference — multi-passage", () => {
  it("parses semicolon-separated passages", () => {
    const parsed = parseReference("Rom 8:28; 1 Cor 13:4-7");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.book).toBe("ROM");
    expect(parsed[0]!.ranges[0]).toEqual({
      chapter: 8, startVerse: 28, endChapter: 8, endVerse: 28,
    });
    expect(parsed[1]!.book).toBe("1CO");
    expect(parsed[1]!.ranges[0]).toEqual({
      chapter: 13, startVerse: 4, endChapter: 13, endVerse: 7,
    });
  });

  it("ignores trailing semicolons / empty segments", () => {
    expect(parseReference("Rom 8:28;")).toHaveLength(1);
    expect(parseReference("Rom 8:28;;1 Cor 13:4")).toHaveLength(2);
  });
});

describe("parseReference — errors", () => {
  it("rejects empty input", () => {
    expect(() => parseReference("")).toThrow(ScriptureRefError);
    expect(() => parseReference("   ")).toThrow(ScriptureRefError);
  });

  it("rejects unknown book", () => {
    const err = (() => {
      try { parseReference("Foobar 1:1"); return null; }
      catch (e) { return e as ScriptureRefError; }
    })();
    expect(err).toBeInstanceOf(ScriptureRefError);
    expect(err!.hint.toLowerCase()).toContain("book");
  });

  it("rejects missing chapter/verse", () => {
    expect(() => parseReference("John")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3")).toThrow(ScriptureRefError);
  });

  it("rejects non-numeric chapter or verse", () => {
    expect(() => parseReference("John foo:1")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3:bar")).toThrow(ScriptureRefError);
  });

  it("rejects zero or negative chapter/verse", () => {
    expect(() => parseReference("John 0:1")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3:0")).toThrow(ScriptureRefError);
    expect(() => parseReference("John -1:1")).toThrow(ScriptureRefError);
  });
});

describe("guessScriptureReference", () => {
  it("accepts a title that is itself a reference", () => {
    expect(guessScriptureReference("John 3:16")).toBe("John 3:16");
    expect(guessScriptureReference("  John 3:16  ")).toBe("John 3:16");
  });

  it("strips a leading label before a colon", () => {
    expect(guessScriptureReference("Scripture: John 3:16-18")).toBe("John 3:16-18");
    expect(guessScriptureReference("Sermon text - Romans 8:28")).toBe("Romans 8:28");
  });

  it("uses the text after a dash separator", () => {
    expect(guessScriptureReference("Reading – Romans 8:28")).toBe("Romans 8:28");
    expect(guessScriptureReference("Reading — Romans 8:28-30")).toBe("Romans 8:28-30");
    expect(guessScriptureReference("Reading - 1 Cor 13:4-7")).toBe("1 Cor 13:4-7");
  });

  it("returns null for non-references", () => {
    expect(guessScriptureReference("Welcome")).toBeNull();
    expect(guessScriptureReference("Announcements: Week 3")).toBeNull();
    expect(guessScriptureReference("")).toBeNull();
  });

  it("returns null for whole-chapter refs (parseReference needs a verse)", () => {
    expect(guessScriptureReference("Psalm 23")).toBeNull();
  });
});
