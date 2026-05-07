import { describe, expect, it } from "vitest";
import { parseSongSelectText, slugifyTitle, _internal } from "./songSelectParser";

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

describe("parseSongSelectText (skeleton)", () => {
  it("throws on empty input", () => {
    expect(() => parseSongSelectText("")).toThrow();
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
