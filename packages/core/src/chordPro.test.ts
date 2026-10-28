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
  it("recall re-uses the most recent chorus even when labels match", () => {
    const r = parseChordPro("{soc}\nChorus body alpha\n{eoc}\n{sov}\nVerse body\n{eov}\n{soc}\nChorus body beta\n{eoc}\n{chorus}");
    expect(r.sections.map((s) => s.id)).toEqual(["c1", "v1", "c2"]);
    expect(r.defaultArrangement).toEqual(["c1", "v1", "c2", "c2"]);
  });
  it("chorus recall before any chorus is ignored", () => {
    const r = parseChordPro("{chorus}\n{sov}\nVerse body\n{eov}");
    expect(r.defaultArrangement).toEqual(["v1"]);
  });
  it("explicit verse labels advance the counter", () => {
    const r = parseChordPro("{sov: Verse 2}\nbody a\n{eov}\n{sov}\nbody b\n{eov}");
    expect(r.sections.map((s) => s.label)).toEqual(["Verse 2", "Verse 3"]);
  });
  it("lyrics outside any block use the next free verse number", () => {
    const r = parseChordPro("{sov}\nbody a\n{eov}\nloose line\n");
    expect(r.sections.map((s) => s.label)).toEqual(["Verse 1", "Verse 2"]);
  });
});
