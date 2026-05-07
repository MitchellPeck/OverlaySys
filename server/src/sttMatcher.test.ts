import { describe, expect, it, beforeEach } from "vitest";
import type { Song } from "@overlaysys/core";
import * as matcher from "./sttMatcher";

const song: Song = {
  id: "test",
  title: "Test",
  sections: [
    {
      id: "v1",
      kind: "verse",
      label: "Verse 1",
      slides: [
        { id: "v1s1", lines: ["amazing grace how sweet the sound"] },
        { id: "v1s2", lines: ["that saved a wretch like me"] },
      ],
    },
    {
      id: "c",
      kind: "chorus",
      label: "Chorus",
      slides: [{ id: "c1", lines: ["my chains are gone i've been set free"] }],
    },
  ],
  defaultArrangement: ["v1", "c"],
};

describe("sttMatcher", () => {
  beforeEach(() => {
    matcher.unbindSession("program");
  });

  it("returns null for an unbound channel", () => {
    expect(
      matcher.processHypothesis("program", "hello", { sectionIdx: 0, slideIdx: 0 }),
    ).toBeNull();
  });

  it("matches the current slide on near-exact text", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    const r = matcher.processHypothesis(
      "program",
      "amazing grace how sweet the sound",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r).not.toBeNull();
    expect(r!.sectionIdx).toBe(0);
    expect(r!.slideIdx).toBe(0);
    expect(r!.confidence).toBeGreaterThan(0.8);
  });

  it("matches a forward slide as the band advances", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    const r = matcher.processHypothesis(
      "program",
      "that saved a wretch like me",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r!.sectionIdx).toBe(0);
    expect(r!.slideIdx).toBe(1);
  });

  it("matches the chorus when the band drops to it (section-start bonus)", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    const r = matcher.processHypothesis("program", "my chains are gone", {
      sectionIdx: 0,
      slideIdx: 0,
    });
    expect(r!.sectionIdx).toBe(1);
    expect(r!.slideIdx).toBe(0);
  });

  it("returns null when text doesn't match anything (below MIN_EMIT)", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    const r = matcher.processHypothesis(
      "program",
      "completely unrelated text foo bar",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r).toBeNull();
  });

  it("normalizes punctuation and case", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    const r = matcher.processHypothesis(
      "program",
      "Amazing GRACE, how sweet — the SOUND!",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r).not.toBeNull();
    expect(r!.sectionIdx).toBe(0);
    expect(r!.slideIdx).toBe(0);
  });

  it("prefers monotonic-forward over going backward on tied scores", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    // "the" appears in v1s1 ("the sound"). At cursor v1s2, the forward bonus
    // should prevent regression to v1s1.
    const r = matcher.processHypothesis("program", "the", {
      sectionIdx: 0,
      slideIdx: 1,
    });
    // If a result is returned, it should NOT be the slide before cursor.
    if (r) {
      expect(r.sectionIdx === 0 && r.slideIdx === 0).toBe(false);
    }
  });

  it("respects unbindSession", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    matcher.unbindSession("program");
    expect(
      matcher.processHypothesis("program", "amazing grace", { sectionIdx: 0, slideIdx: 0 }),
    ).toBeNull();
  });

  it("exports MIN_EMIT_THRESHOLD and AUTO_TAKE_THRESHOLD constants", () => {
    expect(matcher.MIN_EMIT_THRESHOLD).toBe(0.30);
    expect(matcher.AUTO_TAKE_THRESHOLD).toBe(0.65);
  });

  it("handles multiple independent sessions on different channels", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    matcher.bindSession("preview", song, song.defaultArrangement);
    const r1 = matcher.processHypothesis(
      "program",
      "amazing grace how sweet the sound",
      { sectionIdx: 0, slideIdx: 0 },
    );
    const r2 = matcher.processHypothesis(
      "preview",
      "that saved a wretch like me",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r1!.slideIdx).toBe(0);
    expect(r2!.slideIdx).toBe(1);
    matcher.unbindSession("preview");
  });
});
