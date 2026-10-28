import { describe, expect, it } from "vitest";
import { parsePastedLyrics } from "./pasteLyrics";

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
    const r = parsePastedLyrics(song, "no headers here at all", false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/header/i);
  });

  it("only takes SongSelect metadata when asked", () => {
    const text = "Amazing Grace\n\nVerse 1\nAmazing grace how sweet\n\nCCLI Song # 22025\nJohn Newton\n© Public Domain";
    const without = parsePastedLyrics(song, text, false);
    const withMeta = parsePastedLyrics(song, text, true);
    expect(without.songSelect).toBe(true);
    if (!without.ok || !withMeta.ok) throw new Error("expected parse");
    expect(without.patch.ccliNumber).toBeUndefined();
    expect(withMeta.patch.ccliNumber).toBe("22025");
  });
});
