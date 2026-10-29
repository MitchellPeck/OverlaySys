import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyScore } from "./fuzzyMatch";

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

describe("fuzzyScore", () => {
  it("scores a prefix 3", () => {
    expect(fuzzyScore("so", "Songs")).toBe(3);
    expect(fuzzyScore("SO", "songs")).toBe(3);
  });
  it("scores a word start 2 (a later word, or the words' initials)", () => {
    expect(fuzzyScore("pc", "Planning Center")).toBe(2);
    expect(fuzzyScore("cen", "Planning Center")).toBe(2);
    expect(fuzzyScore("speech", "Settings · Speech-to-text")).toBe(2);
    expect(fuzzyScore("text", "Settings · Speech-to-text")).toBe(2);
  });
  it("scores a plain subsequence 1", () => {
    expect(fuzzyScore("ng", "Planning Center")).toBe(1);
    expect(fuzzyScore("chn", "Channels")).toBe(1);
  });
  it("scores no match 0", () => {
    expect(fuzzyScore("zzz", "Songs")).toBe(0);
    expect(fuzzyScore("sxo", "Songs")).toBe(0);
  });
  it("scores an empty query 1", () => {
    expect(fuzzyScore("", "Anything")).toBe(1);
    expect(fuzzyScore("  ", "Anything")).toBe(1);
  });
});
