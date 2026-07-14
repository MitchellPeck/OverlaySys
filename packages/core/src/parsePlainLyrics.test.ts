import { describe, it, expect } from "vitest";
import { parsePlainLyrics } from "./parsePlainLyrics";

describe("parsePlainLyrics", () => {
  it("splits bare headers into kind-inferred sections", () => {
    const { sections, defaultArrangement } = parsePlainLyrics(
      "Verse 1\nAmazing grace\nhow sweet\n\nChorus\nMy chains are gone",
    );
    expect(sections.map((s) => s.kind)).toEqual(["verse", "chorus"]);
    expect(sections[0]!.label).toBe("Verse 1");
    expect(defaultArrangement).toEqual(["v1", "c1"]);
  });

  it("recognizes uppercase PCO-style headers", () => {
    const { sections } = parsePlainLyrics("VERSE 1\nline one\n\nBRIDGE\nline two");
    expect(sections.map((s) => s.kind)).toEqual(["verse", "bridge"]);
  });

  it("chunks slides at two lines", () => {
    const { sections } = parsePlainLyrics("Verse 1\na\nb\nc\nd\ne");
    expect(sections[0]!.slides.map((sl) => sl.lines)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("strips chord markers but keeps bracketed section headers", () => {
    const { sections } = parsePlainLyrics("[Verse 1]\n[G]Amazing [C]grace");
    expect(sections[0]!.label).toBe("Verse 1");
    expect(sections[0]!.slides[0]!.lines).toEqual(["Amazing grace"]);
  });

  it("returns empty for blank input", () => {
    expect(parsePlainLyrics("   \n\n")).toEqual({
      sections: [],
      defaultArrangement: [],
    });
  });

  it("falls back to a single Verse when there are no headers", () => {
    const { sections, defaultArrangement } = parsePlainLyrics(
      "just some\nheaderless lyrics",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe("verse");
    expect(sections[0]!.slides[0]!.lines).toEqual(["just some", "headerless lyrics"]);
    expect(defaultArrangement).toEqual(["v1"]);
  });
});
