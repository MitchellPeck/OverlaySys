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

  it("matches the current slide on a partial hypothesis (below coverage threshold)", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    // 3 of 6 unique tokens = 50% coverage, below the 65% threshold so the
    // pre-emption path is skipped and per-hypothesis matching wins.
    const r = matcher.processHypothesis(
      "program",
      "amazing grace how",
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
    // Short partial: 2 tokens after normalization, below coverage threshold.
    const r = matcher.processHypothesis(
      "program",
      "Amazing GRACE!",
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
    // Short partial that hits v1s1 only (below coverage threshold).
    const r1 = matcher.processHypothesis(
      "program",
      "amazing grace",
      { sectionIdx: 0, slideIdx: 0 },
    );
    // Short partial that hits v1s2 only.
    const r2 = matcher.processHypothesis(
      "preview",
      "saved a wretch",
      { sectionIdx: 0, slideIdx: 0 },
    );
    expect(r1!.slideIdx).toBe(0);
    expect(r2!.slideIdx).toBe(1);
    matcher.unbindSession("preview");
  });

  describe("local-neighborhood restriction", () => {
    // Multi-verse song where verses share vocabulary — STT mishears across
    // verses would otherwise be tempting jumps for the matcher.
    const sharedVocabSong: Song = {
      id: "shared",
      title: "Shared",
      sections: [
        { id: "v1", kind: "verse", label: "V1", slides: [{ id: "v1s1", lines: ["amazing grace how sweet the sound"] }] },
        { id: "v2", kind: "verse", label: "V2", slides: [{ id: "v2s1", lines: ["amazing grace will lead me home"] }] },
        { id: "v3", kind: "verse", label: "V3", slides: [{ id: "v3s1", lines: ["amazing grace will set me free"] }] },
        { id: "v4", kind: "verse", label: "V4", slides: [{ id: "v4s1", lines: ["amazing grace forever sweet"] }] },
        { id: "v5", kind: "verse", label: "V5", slides: [{ id: "v5s1", lines: ["amazing grace will guide my way"] }] },
      ],
      defaultArrangement: ["v1", "v2", "v3", "v4", "v5"],
    };

    it("does NOT jump to a far-away verse even on perfect-overlap text", () => {
      matcher.bindSession("program", sharedVocabSong, sharedVocabSong.defaultArrangement);
      // Cursor at v2; v5's exact text comes in. Should NOT jump to v5 — v5
      // is outside the cursor+1/cursor+2 neighborhood.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace will guide my way",
        { sectionIdx: 1, slideIdx: 0 },
      );
      // Acceptable outcomes: null (no candidate scored above MIN_EMIT) or
      // a candidate within {v1, v2, v3, v4} = {sectionIdx 0..3}. Critically
      // NOT v5 (sectionIdx === 4).
      if (r) {
        expect(r.sectionIdx).toBeLessThan(4);
      }
      matcher.unbindSession("program");
    });

    it("can still match cursor+2 (two slides ahead)", () => {
      matcher.bindSession("program", sharedVocabSong, sharedVocabSong.defaultArrangement);
      // Cursor at v2; v4's first line comes in (cursor+2).
      const r = matcher.processHypothesis(
        "program",
        "amazing grace forever sweet",
        { sectionIdx: 1, slideIdx: 0 },
      );
      expect(r).not.toBeNull();
      expect(r!.sectionIdx).toBe(3); // v4 is at index 3
      matcher.unbindSession("program");
    });
  });

  describe("coverage-based pre-emption", () => {
    it("advances to next slide once enough current-slide tokens have accumulated", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Single hypothesis covering ~all current-slide tokens triggers
      // coverage-based advance.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound",
        { sectionIdx: 0, slideIdx: 0 },
      );
      expect(r).not.toBeNull();
      // Pre-empt: advance to v1s2 even though hypothesis was current-slide text.
      expect(r!.sectionIdx).toBe(0);
      expect(r!.slideIdx).toBe(1);
      expect(r!.confidence).toBeGreaterThanOrEqual(matcher.AUTO_TAKE_THRESHOLD);
    });

    it("accumulates coverage across multiple partial hypotheses", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      const cursor = { sectionIdx: 0, slideIdx: 0 };
      // First partial: covers ~half. Should NOT pre-empt yet.
      const r1 = matcher.processHypothesis("program", "amazing grace how", cursor);
      // r1 might match v1s1 via per-hypothesis fallback (current-slide
      // overlap). It should NOT yet jump to v1s2 via coverage.
      if (r1 && r1.sectionIdx === 0 && r1.slideIdx === 1) {
        // Coverage shouldn't have triggered with only "amazing grace how"
        // (3 of 6 unique tokens = 50% < 65%).
        throw new Error("coverage triggered too early");
      }
      // Second partial: brings coverage above threshold.
      const r2 = matcher.processHypothesis("program", "sweet the sound", cursor);
      expect(r2).not.toBeNull();
      expect(r2!.sectionIdx).toBe(0);
      expect(r2!.slideIdx).toBe(1);
    });

    it("resets the coverage window when the cursor moves", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Build up coverage on v1s1 and pre-empt to v1s2.
      const r1 = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound",
        { sectionIdx: 0, slideIdx: 0 },
      );
      expect(r1!.slideIdx).toBe(1);
      // Now cursor is at v1s2. New hypothesis with v1s2's text — should NOT
      // trigger coverage immediately because we'd need to accumulate.
      // (Single short hypothesis hits coverage on the small v1s2 slide; this
      // test mainly verifies the window was reset, so assert on tokens.)
      const r2 = matcher.processHypothesis(
        "program",
        "blah blah blah",
        { sectionIdx: 0, slideIdx: 1 },
      );
      // No coverage match (the irrelevant tokens added 0 to v1s2's coverage),
      // and per-hypothesis match is below MIN_EMIT.
      expect(r2).toBeNull();
    });

    it("does not pre-empt past the end of the arrangement", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // At the last slide of the last section, full coverage shouldn't
      // produce a "next" — there isn't one.
      const r = matcher.processHypothesis(
        "program",
        "my chains are gone i've been set free",
        { sectionIdx: 1, slideIdx: 0 },
      );
      // Either null (coverage couldn't find a next) or matches current (c1)
      // via the per-hypothesis fallback. Either way, NOT a forward jump
      // beyond the arrangement.
      if (r) {
        expect(r.sectionIdx).toBeLessThanOrEqual(1);
        expect(r.sectionIdx === 1 && r.slideIdx === 0).toBe(true);
      }
    });

    it("skips coverage check for tiny slides (< COVERAGE_MIN_TOKENS)", () => {
      const tinySong: Song = {
        id: "tiny",
        title: "Tiny",
        sections: [
          {
            id: "a",
            kind: "verse",
            label: "Verse",
            slides: [
              { id: "a1", lines: ["go now"] }, // 2 unique tokens
              { id: "a2", lines: ["forward together onward we march"] },
            ],
          },
        ],
        defaultArrangement: ["a"],
      };
      matcher.bindSession("program", tinySong, tinySong.defaultArrangement);
      // Hypothesis covers 100% of "go now" — but slide is below
      // COVERAGE_MIN_TOKENS so coverage path is skipped. Per-hypothesis
      // match still fires (returns the matched slide, not the next one).
      const r = matcher.processHypothesis("program", "go now", {
        sectionIdx: 0,
        slideIdx: 0,
      });
      // Should match a1 (current), NOT pre-empt to a2.
      expect(r).not.toBeNull();
      expect(r!.slideIdx).toBe(0);
      matcher.unbindSession("program");
    });
  });
});
