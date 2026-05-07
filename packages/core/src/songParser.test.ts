import { describe, expect, it } from "vitest";
import { parseSongFromText } from "./songParser";

describe("parseSongFromText", () => {
  it("parses a basic verse + chorus", () => {
    const song = parseSongFromText(
      "amazing-grace",
      "Amazing Grace",
      `[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
My chains are gone
I've been set free`,
    );
    expect(song.id).toBe("amazing-grace");
    expect(song.sections).toHaveLength(2);
    expect(song.sections[0]!.kind).toBe("verse");
    expect(song.sections[0]!.label).toBe("Verse 1");
    expect(song.sections[0]!.slides[0]!.lines).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
    expect(song.sections[1]!.kind).toBe("chorus");
  });

  it("splits multiple slides within a section by blank line", () => {
    const song = parseSongFromText("t", "T", `[Verse 1]
Line A1
Line A2

Line B1
Line B2`);
    expect(song.sections[0]!.slides).toHaveLength(2);
    expect(song.sections[0]!.slides[0]!.lines).toEqual(["Line A1", "Line A2"]);
    expect(song.sections[0]!.slides[1]!.lines).toEqual(["Line B1", "Line B2"]);
  });

  it("infers section kind from header text", () => {
    const cases: { header: string; kind: string }[] = [
      { header: "Verse 1", kind: "verse" },
      { header: "verse 2", kind: "verse" },
      { header: "Chorus", kind: "chorus" },
      { header: "Pre-Chorus", kind: "other" },
      { header: "Bridge", kind: "bridge" },
      { header: "Tag", kind: "tag" },
      { header: "Intro", kind: "intro" },
      { header: "Outro", kind: "outro" },
      { header: "Vamp", kind: "other" },
    ];
    for (const c of cases) {
      const song = parseSongFromText("x", "X", `[${c.header}]
foo`);
      expect(song.sections[0]!.kind, c.header).toBe(c.kind);
    }
  });

  it("generates stable section ids per kind", () => {
    const song = parseSongFromText("x", "X", `[Verse 1]
a
[Chorus]
b
[Verse 2]
c`);
    expect(song.sections.map((s) => s.id)).toEqual(["v1", "c1", "v2"]);
  });

  it("seeds defaultArrangement to the parsed order", () => {
    const song = parseSongFromText("x", "X", `[Verse 1]
a
[Chorus]
b`);
    expect(song.defaultArrangement).toEqual(["v1", "c1"]);
  });

  it("trims leading and trailing blank lines and CR characters", () => {
    const song = parseSongFromText("x", "X", "\r\n[Verse 1]\r\nfoo\r\n\r\n");
    expect(song.sections[0]!.slides[0]!.lines).toEqual(["foo"]);
  });

  it("rejects input with no section headers", () => {
    expect(() => parseSongFromText("x", "X", "just some lines\nno header")).toThrow();
  });
});
