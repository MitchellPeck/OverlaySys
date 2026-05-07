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
