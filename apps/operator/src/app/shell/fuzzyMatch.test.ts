import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches a subsequence", () => {
    expect(fuzzyMatch("chn", "Channels")).toBe(true);
    expect(fuzzyMatch("shw", "Shows")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(fuzzyMatch("SONG", "Songs")).toBe(true);
  });
  it("rejects non-subsequences", () => {
    expect(fuzzyMatch("zzz", "Songs")).toBe(false);
    expect(fuzzyMatch("sxo", "Songs")).toBe(false); // order matters
  });
  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "Anything")).toBe(true);
  });
});
