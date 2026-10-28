import { describe, expect, it } from "vitest";
import { parseSongFromText, parseSongTextWithNotice } from "./songParser";
import { parsePlainLyrics } from "./parsePlainLyrics";
import { parseSongSelectText } from "./songSelectParser";

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

  it("imports input with no section headers as Verse 1", () => {
    const song = parseSongFromText("x", "X", "just some lines\nno header");
    expect(song.sections.map((x) => x.label)).toEqual(["Verse 1"]);
  });

  it("reuses the earlier section for a repeated empty header (SONGS-1)", () => {
    const song = parseSongFromText("x", "X", `[Verse 1]
Verse line one
[Chorus]
Chorus line one
[Verse 2]
Verse line two
[Chorus]
[Bridge]
Bridge line one
[Chorus]
[Verse 1]`);
    expect(song.sections.map((s) => s.id)).toEqual(["v1", "c1", "v2", "b1"]);
    expect(song.defaultArrangement).toEqual(["v1", "c1", "v2", "c1", "b1", "c1", "v1"]);
  });

  it("keeps an empty header with no earlier match as an empty section", () => {
    const song = parseSongFromText("x", "X", "[Chorus]\n[Verse 1]\na");
    expect(song.sections.map((s) => s.id)).toEqual(["c1", "v1"]);
  });

  it("makes a repeated header with a different body a new section", () => {
    const song = parseSongFromText("x", "X", "[Chorus]\na\n[Chorus]\nb");
    expect(song.sections.map((s) => s.id)).toEqual(["c1", "c2"]);
  });
});

describe("headerless and orphan handling", () => {
  it("headerless text becomes Verse 1 with slides at blank lines, with a notice", () => {
    const r = parseSongTextWithNotice("id", "T", "Line one\nLine two\n\nLine three");
    expect(r.song.sections).toEqual([{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["Line one", "Line two"] }, { id: "v1s2", lines: ["Line three"] }] }]);
    expect(r.notice).toBe("No section headers found, so everything was imported as Verse 1. Add [Verse 1], [Chorus] headers to split it.");
  });
  it("orphan lines before the first header become Intro", () => {
    const r = parseSongTextWithNotice("id", "T", "Lead line\n\n[Verse 1]\nLine one");
    expect(r.song.sections.map((x) => x.kind)).toEqual(["intro", "verse"]);
    expect(r.notice).toBeNull();
  });
  it("empty text throws", () => {
    expect(() => parseSongTextWithNotice("id", "T", "  \n")).toThrow("Paste some lyrics first.");
  });
  it("repeated empty header still references the earlier section (SONGS-1 regression)", () => {
    const t = "[Verse 1]\na\n[Chorus]\nb\n[Verse 2]\nc\n[Chorus]\n[Bridge]\nd\n[Chorus]";
    const want = ["v1", "c1", "v2", "c1", "b1", "c1"];
    expect(parseSongTextWithNotice("i", "T", t).song.defaultArrangement).toEqual(want);
    const p = parsePlainLyrics(t);
    expect(p.sections).toHaveLength(4);
    expect(p.defaultArrangement).toEqual(want);
    const ss = parseSongSelectText(t);
    expect(ss.sections).toHaveLength(4);
    expect(ss.defaultArrangement).toEqual(want);
  });
});
