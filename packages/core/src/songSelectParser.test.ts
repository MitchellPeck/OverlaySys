import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSongSelectText, slugifyTitle, _internal } from "./songSelectParser";

const __dirname = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(
    join(__dirname, "__fixtures__", "songselect", name),
    "utf8",
  );
}

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Amazing Grace")).toBe("amazing-grace");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugifyTitle("Amazing Grace!! (Newton)")).toBe(
      "amazing-grace-newton",
    );
  });
  it("strips diacritics", () => {
    expect(slugifyTitle("Café Olé")).toBe("cafe-ole");
  });
  it("falls back to 'untitled' for empty input", () => {
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
  });
});

describe("parseSongSelectText", () => {
  it("throws when no sections are detected", () => {
    expect(() => parseSongSelectText("just prose, no section header at all"))
      .toThrow(/no sections/i);
    expect(() => parseSongSelectText("")).toThrow(/no sections/i);
  });

  it("parses a complete plain-lyrics file (public-domain Amazing Grace)", () => {
    const text = [
      "Amazing Grace",
      "",
      "Verse 1",
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
      "",
      "Verse 2",
      "Twas grace that taught my heart to fear",
      "And grace my fears relieved",
      "",
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
      "CCLI License # 9999999",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.meta.ccliNumber).toBe("22025");
    expect(result.meta.authors).toEqual(["John Newton"]);
    expect(result.meta.copyright).toBe("© Public Domain");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.kind).toBe("verse");
    expect(result.sections[0]!.label).toBe("Verse 1");
    expect(result.sections[0]!.id).toBe("v1");
    expect(result.sections[1]!.id).toBe("v2");
    expect(result.defaultArrangement).toEqual(["v1", "v2"]);
    // License # leak guard
    const all = JSON.stringify(result);
    expect(all).not.toContain("9999999");
    expect(all).not.toContain("License");
  });

  it("parses a ChordPro file by stripping chords from body lines", () => {
    const text = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "[G]Amazing [C]grace [G]how sweet the [D]sound",
      "[G]That saved [Em]a wretch like [D]me",
      "",
      "CCLI Song # 22025",
      "© Public Domain",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.sections[0]!.slides[0]!.lines).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
  });

  it("preserves a parenthetical title", () => {
    const text = [
      "Amazing Grace (My Chains Are Gone)",
      "",
      "Verse 1",
      "Amazing grace how sweet the sound",
      "",
      "CCLI Song # 4768151",
      "© 2006 Worship Together",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.title).toBe("Amazing Grace (My Chains Are Gone)");
  });

  it("parses multiple authors split on ' | '", () => {
    const text = [
      "Build My Life",
      "",
      "Verse 1",
      "Worthy of every song we could ever sing",
      "",
      "CCLI Song # 7070345",
      "Pat Barrett | Brett Younker | Karl Martin | Kirby Kaple | Matt Redman",
      "© 2016 Said And Done Music",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.authors).toEqual([
      "Pat Barrett",
      "Brett Younker",
      "Karl Martin",
      "Kirby Kaple",
      "Matt Redman",
    ]);
  });

  it("succeeds with no footer (meta fields just undefined)", () => {
    const text = [
      "[Verse 1]",
      "Amazing grace how sweet the sound",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.sections).toHaveLength(1);
    expect(result.meta.ccliNumber).toBeUndefined();
    expect(result.meta.copyright).toBeUndefined();
    expect(result.meta.title).toBeUndefined();
  });
});

describe("_internal.splitFooter", () => {
  it("splits at first 'CCLI Song #' line", () => {
    const lines = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "Amazing grace how sweet the sound",
      "",
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.body).toEqual(lines.slice(0, 5));
    expect(out.footer).toEqual(lines.slice(5));
  });

  it("splits at a copyright line if no CCLI marker", () => {
    const lines = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "foo",
      "© 2026 Some Publisher",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.footer).toEqual(["© 2026 Some Publisher"]);
  });

  it("returns empty footer when no markers present", () => {
    const lines = ["[Verse 1]", "foo", "bar"];
    const out = _internal.splitFooter(lines);
    expect(out.body).toEqual(lines);
    expect(out.footer).toEqual([]);
  });

  it("matches 'For use solely with the SongSelect' as a footer marker", () => {
    const lines = [
      "[Verse 1]",
      "foo",
      "For use solely with the SongSelect Terms of Use.",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.footer).toEqual([lines[2]]);
  });
});

describe("_internal.extractMeta", () => {
  it("extracts ccliNumber from 'CCLI Song #'", () => {
    const meta = _internal.extractMeta(["Amazing Grace"], [
      "CCLI Song # 22025",
    ]);
    expect(meta.ccliNumber).toBe("22025");
  });

  it("extracts copyright from a © line, preserving the symbol", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "© Public Domain",
    ]);
    expect(meta.copyright).toBe("© Public Domain");
  });

  it("extracts a single author when no | separator present", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
    ]);
    expect(meta.authors).toEqual(["John Newton"]);
  });

  it("extracts multiple authors split on ' | '", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 4768151",
      "John Newton | Chris Tomlin | Louie Giglio",
      "© 2006 sixsteps Music",
    ]);
    expect(meta.authors).toEqual(["John Newton", "Chris Tomlin", "Louie Giglio"]);
  });

  it("never includes the CCLI License # in any field", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
      "CCLI License # 9999999",
    ]);
    const all = JSON.stringify(meta);
    expect(all).not.toContain("9999999");
    expect(all).not.toContain("License");
  });

  it("returns undefined fields when footer lacks the markers", () => {
    const meta = _internal.extractMeta([], []);
    expect(meta.ccliNumber).toBeUndefined();
    expect(meta.copyright).toBeUndefined();
    expect(meta.authors).toBeUndefined();
  });
});

describe("_internal.extractTitle", () => {
  it("returns the first non-empty preamble line", () => {
    const preamble = ["", "Amazing Grace", ""];
    expect(_internal.extractTitle(preamble)).toBe("Amazing Grace");
  });
  it("preserves parentheticals in the title", () => {
    expect(
      _internal.extractTitle(["Amazing Grace (My Chains Are Gone)"]),
    ).toBe("Amazing Grace (My Chains Are Gone)");
  });
  it("returns undefined when preamble has no non-empty line", () => {
    expect(_internal.extractTitle([])).toBeUndefined();
    expect(_internal.extractTitle(["", "  "])).toBeUndefined();
  });
});

describe("_internal.stripChords", () => {
  it("removes simple chord markers", () => {
    expect(_internal.stripChords("[G]Amazing [C]grace"))
      .toBe("Amazing grace");
  });
  it("removes complex chord markers", () => {
    expect(_internal.stripChords("[Cmaj7]how [F#m]sweet [Eb/G]the [Bb]sound"))
      .toBe("how sweet the sound");
  });
  it("does NOT remove section header brackets like [Verse 1]", () => {
    expect(_internal.stripChords("[Verse 1]")).toBe("[Verse 1]");
    expect(_internal.stripChords("[Chorus]")).toBe("[Chorus]");
    expect(_internal.stripChords("[Bridge]")).toBe("[Bridge]");
  });
  it("collapses runs of whitespace introduced by stripping", () => {
    expect(_internal.stripChords("[G]   [C]Amazing"))
      .toBe("Amazing");
  });
  it("trims leading/trailing whitespace", () => {
    expect(_internal.stripChords("  [G]hello [C]  ")).toBe("hello");
  });
  it("removes chords with uppercase qualifiers", () => {
    expect(_internal.stripChords("[CMaj7]hello [F#M]world"))
      .toBe("hello world");
  });
});

describe("_internal.isHeaderLine", () => {
  it("recognizes bracketed headers", () => {
    expect(_internal.isHeaderLine("[Verse 1]")).toBe("Verse 1");
    expect(_internal.isHeaderLine("[Chorus]")).toBe("Chorus");
  });
  it("recognizes bare keyword headers", () => {
    expect(_internal.isHeaderLine("Verse 1")).toBe("Verse 1");
    expect(_internal.isHeaderLine("Chorus")).toBe("Chorus");
    expect(_internal.isHeaderLine("Bridge")).toBe("Bridge");
    expect(_internal.isHeaderLine("Pre-Chorus")).toBe("Pre-Chorus");
    expect(_internal.isHeaderLine("Pre Chorus")).toBe("Pre Chorus");
    expect(_internal.isHeaderLine("Tag")).toBe("Tag");
    expect(_internal.isHeaderLine("Intro")).toBe("Intro");
    expect(_internal.isHeaderLine("Outro")).toBe("Outro");
    expect(_internal.isHeaderLine("Interlude")).toBe("Interlude");
    expect(_internal.isHeaderLine("Ending")).toBe("Ending");
    expect(_internal.isHeaderLine("verse 2")).toBe("verse 2");
    expect(_internal.isHeaderLine("Chorus 2")).toBe("Chorus 2");
  });
  it("does NOT match lyric lines that happen to contain a keyword", () => {
    expect(_internal.isHeaderLine("Verse this is a lyric"))
      .toBeNull();
    expect(_internal.isHeaderLine("On Christ the solid rock I stand"))
      .toBeNull();
    expect(_internal.isHeaderLine("Bridge over troubled water"))
      .toBeNull();
  });
  it("returns null for empty and arbitrary lines", () => {
    expect(_internal.isHeaderLine("")).toBeNull();
    expect(_internal.isHeaderLine("Amazing grace how sweet the sound"))
      .toBeNull();
  });
});

describe("_internal.tokenizeBody (mixed bracketed + bare headers)", () => {
  it("tokenizes a mix of bracketed and bare headers", () => {
    const body = [
      "Verse 1",
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
      "",
      "[Chorus]",
      "How sweet the sound (test)",
      "",
      "Verse 2",
      "Twas grace that taught my heart to fear",
    ];
    const raw = _internal.tokenizeBody(body);
    expect(raw).toHaveLength(3);
    expect(raw[0]!.header).toBe("Verse 1");
    expect(raw[1]!.header).toBe("Chorus");
    expect(raw[2]!.header).toBe("Verse 2");
    expect(raw[0]!.blocks[0]).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
  });

  it("splits multiple slides on blank line within a section", () => {
    const body = [
      "Verse 1",
      "Line A1",
      "Line A2",
      "",
      "Line B1",
      "Line B2",
    ];
    const raw = _internal.tokenizeBody(body);
    expect(raw[0]!.blocks).toHaveLength(2);
  });

  it("ignores text before any header", () => {
    const raw = _internal.tokenizeBody(["preamble line", "", "Verse 1", "x"]);
    expect(raw).toHaveLength(1);
    expect(raw[0]!.header).toBe("Verse 1");
  });
});

describe("parseSongSelectText (file fixtures)", () => {
  it("parses amazing-grace.txt with extracted metadata", () => {
    const result = parseSongSelectText(fixture("amazing-grace.txt"));
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.meta.ccliNumber).toBe("22025");
    expect(result.meta.authors).toEqual(["John Newton"]);
    expect(result.meta.copyright).toBe("© Public Domain");
    expect(result.sections).toHaveLength(3);
    expect(result.sections.map((s) => s.id)).toEqual(["v1", "v2", "v3"]);
    expect(JSON.stringify(result)).not.toContain("9999999");
  });

  it("parses amazing-grace.cho with chords stripped", () => {
    const result = parseSongSelectText(fixture("amazing-grace.cho"));
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.sections[0]!.slides[0]!.lines[0]).not.toContain("[");
    expect(result.sections[0]!.slides[0]!.lines[0]).toMatch(/^Amazing grace/);
  });

  it("parses no-footer.txt and leaves meta fields undefined", () => {
    const result = parseSongSelectText(fixture("no-footer.txt"));
    expect(result.meta.ccliNumber).toBeUndefined();
    expect(result.meta.copyright).toBeUndefined();
    expect(result.sections).toHaveLength(2);
  });

  it("throws on malformed.txt", () => {
    expect(() => parseSongSelectText(fixture("malformed.txt")))
      .toThrow(/no sections/i);
  });
});
