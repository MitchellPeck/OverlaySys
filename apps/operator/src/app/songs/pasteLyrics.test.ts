import { describe, expect, it } from "vitest";
import { detectLyricsFormat, hasInlineChords, parsePastedLyrics } from "./pasteLyrics";

const song = { id: "s1", title: "Song" };

describe("parsePastedLyrics", () => {
  it("rejects empty text without throwing", () => {
    const r = parsePastedLyrics(song, "   ", false);
    expect(r.ok).toBe(false);
  });

  it("parses bracketed plain text into sections and slides", () => {
    const r = parsePastedLyrics(song, "[Verse 1]\nline a\nline b\n\nline c\n\n[Chorus]\nhey", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.sections.length).toBe(2);
    expect(r.patch.sections[0]!.slides.length).toBe(2);
    expect(r.patch.defaultArrangement.length).toBeGreaterThan(0);
  });

  it("reports a parse error instead of throwing", () => {
    const r = parsePastedLyrics(song, "   ", false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/lyrics/i);
  });

  it("imports headerless text as one Verse 1 section", () => {
    const r = parsePastedLyrics(song, "Line one\nLine two\n\nLine three", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.sections.map((x) => x.label)).toEqual(["Verse 1"]);
  });

  it("only takes SongSelect metadata when asked", () => {
    const text = "Amazing Grace\n\nVerse 1\nAmazing grace how sweet\n\nCCLI Song # 22025\nJohn Newton\n© Public Domain";
    const without = parsePastedLyrics(song, text, false);
    const withMeta = parsePastedLyrics(song, text, true);
    expect(without.format).toBe("songselect");
    if (!without.ok || !withMeta.ok) throw new Error("expected parse");
    expect(without.patch.ccliNumber).toBeUndefined();
    expect(withMeta.patch.ccliNumber).toBe("22025");
  });
});

describe("format detection", () => {
  it.each(["[Chorus]", "[Bridge]", "[Ending]"])("%s alone is a header, not a chord", (h) =>
    expect(hasInlineChords(`${h}\nLine one`)).toBe(false));
  it("inline chords count", () => expect(hasInlineChords("[G]Line one [D/F#]of verse")).toBe(true));
  it("ChordPro by extension and by directive", () => {
    expect(detectLyricsFormat("x", "a.cho")).toBe("chordpro");
    expect(detectLyricsFormat("{soc}\nx\n{eoc}")).toBe("chordpro");
  });
  it("plain bracketed text stays plain after the chord fix", () =>
    expect(detectLyricsFormat("[Verse 1]\nLine one\n\n[Chorus]\nLine two")).toBe("plain"));
  it("headerless paste is ok with a notice", () =>
    expect(parsePastedLyrics(song, "Line one\n\nLine two", false)).toMatchObject({
      ok: true,
      notice: expect.stringMatching(/Verse 1/),
    }));
  it("ChordPro file routes to the ChordPro parser", () => {
    const r = parsePastedLyrics(song, "{title: Placeholder}\n{soc}\nLine one\n{eoc}", true, "a.cho");
    expect(r).toMatchObject({ ok: true, format: "chordpro" });
    if (r.ok) expect(r.patch.title).toBe("Placeholder");
  });
  it("a file with no sections is rejected", () =>
    expect(parsePastedLyrics(song, "{title: Placeholder}", false, "a.cho")).toMatchObject({
      ok: false,
      error: "Couldn't find any verses or choruses in this file.",
    }));
  it("an empty section is warned", () => {
    const r = parsePastedLyrics(song, "Verse 1\nLine one\n\nChorus 2\n\nVerse 2\nLine two\n\nCCLI Song # 1", false);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.warnings[0]).toBe("Chorus 2 has no lines: it will show a blank slide");
  });
});
