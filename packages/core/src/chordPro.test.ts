import { describe, expect, it } from "vitest";
import { looksLikeChordPro, parseChordPro } from "./chordPro";

describe("chordPro", () => {
  it("parses directives, sections, chorus recall and strips chords", () => {
    const r = parseChordPro("{title: Placeholder Song}\n{artist: A. Writer}\n{ccli: 1234567}\n{start_of_verse}\n[G]Line one of [C]verse one\n{end_of_verse}\n{soc}\nLine one of chorus\n{eoc}\n{start_of_verse}\nLine one of verse two\n{end_of_verse}\n{chorus}");
    expect(r.meta).toEqual({ title: "Placeholder Song", artist: "A. Writer", ccliNumber: "1234567" });
    expect(r.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus", "Verse 2"]);
    expect(r.sections[0]!.slides[0]!.lines).toEqual(["Line one of verse one"]);
    expect(r.defaultArrangement).toEqual(["v1", "c1", "v2", "c1"]);
  });
  it("uses labels and comment headers, ignores other comments, skips tab blocks", () => {
    const r = parseChordPro("{sov: Verse A}\nx one\n{eov}\n{sot}\ne|--0--|\n{eot}\n{c: Bridge}\ny two\n{c: random note}\n{sob}\nz\n{eob}");
    expect(r.sections.map((s) => s.label)).toEqual(["Verse A", "Bridge", "Bridge"]);
    expect(r.sections.flatMap((s) => s.slides.flatMap((x) => x.lines))).not.toContain("e|--0--|");
  });
  it("looksLikeChordPro", () => {
    expect(looksLikeChordPro("{soc}\nx\n{eoc}")).toBe(true);
    expect(looksLikeChordPro("[Verse 1]\nx")).toBe(false);
  });
});
