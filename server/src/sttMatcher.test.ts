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

  it("matches the chorus when the cursor is right next to it", () => {
    matcher.bindSession("program", song, song.defaultArrangement);
    // Cursor at v1s2 (last slide of v1). Chorus is cursor+1 — within
    // the neighborhood, so a chorus-text hypothesis is matchable.
    const r = matcher.processHypothesis("program", "my chains are gone", {
      sectionIdx: 0,
      slideIdx: 1,
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

    it("does NOT jump to a far verse on noisy/partial overlap", () => {
      matcher.bindSession("program", sharedVocabSong, sharedVocabSong.defaultArrangement);
      // Cursor at v2; only the SHARED tokens come in ("amazing grace"). With
      // every verse starting with the same two tokens, the audible threshold
      // can't be met and the matcher should stay in the cursor neighborhood.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace",
        { sectionIdx: 1, slideIdx: 0 },
      );
      // Critically NOT v5 (sectionIdx === 4) and NOT v4 (sectionIdx === 3).
      if (r) {
        expect(r.sectionIdx).toBeLessThanOrEqual(2);
      }
      matcher.unbindSession("program");
    });

    it("audibles to a far section when overlap is unambiguous", () => {
      // Counterpart to the precision test above: when the hypothesis has
      // strong, distinctive overlap with a far section's first slide
      // (the operator audibled, the band started v5), the matcher SHOULD
      // jump there. AUDIBLE_THRESHOLD + AUDIBLE_MARGIN gate noisy cases.
      matcher.bindSession("program", sharedVocabSong, sharedVocabSong.defaultArrangement);
      const r = matcher.processHypothesis(
        "program",
        "amazing grace will guide my way",
        { sectionIdx: 1, slideIdx: 0 },
      );
      expect(r).not.toBeNull();
      expect(r!.sectionIdx).toBe(4);
      expect(r!.strategy).toBe("audible");
      expect(r!.confidence).toBeGreaterThanOrEqual(matcher.AUDIBLE_THRESHOLD);
      matcher.unbindSession("program");
    });
  });

  describe("coverage-based pre-emption", () => {
    it("advances to next slide with high confidence when next-slide tokens confirm the move", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Hypothesis covers ALL of current slide's content tokens AND includes
      // a next-slide-only token ("saved" lives only on v1s2). Both gates
      // pass → auto-take confidence.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound saved",
        { sectionIdx: 0, slideIdx: 0 },
      );
      expect(r).not.toBeNull();
      expect(r!.strategy).toBe("coverage");
      expect(r!.sectionIdx).toBe(0);
      expect(r!.slideIdx).toBe(1);
      expect(r!.confidence).toBeGreaterThanOrEqual(matcher.AUTO_TAKE_THRESHOLD);
    });

    it("does NOT auto-advance on coverage alone without a next-slide token", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Full coverage of current slide but NO next-slide tokens heard.
      // The matcher should still surface a suggestion (so the operator
      // sees the slide is exhausted) but the confidence must stay below
      // AUTO_TAKE_THRESHOLD so trust mode doesn't fire prematurely.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound",
        { sectionIdx: 0, slideIdx: 0 },
      );
      // Coverage strategy emits a forward suggestion at sub-auto confidence.
      // (Neighborhood strategy on the current slide can score higher; either
      // way the auto-take gate must NOT be cleared by coverage alone.)
      if (r && r.strategy === "coverage") {
        expect(r.confidence).toBeLessThan(matcher.AUTO_TAKE_THRESHOLD);
      }
    });

    it("accumulates coverage across multiple partial hypotheses (with next-slide hint)", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      const cursor = { sectionIdx: 0, slideIdx: 0 };
      const r1 = matcher.processHypothesis("program", "amazing grace how", cursor);
      // r1 might match v1s1 via per-hypothesis fallback. It should NOT yet
      // jump to v1s2 via coverage (50% coverage, no next-slide hint).
      if (r1 && r1.strategy === "coverage" && r1.slideIdx === 1) {
        expect(r1.confidence).toBeLessThan(matcher.AUTO_TAKE_THRESHOLD);
      }
      // Second partial: completes coverage AND brings in a next-slide token.
      const r2 = matcher.processHypothesis("program", "sweet the sound saved", cursor);
      expect(r2).not.toBeNull();
      expect(r2!.sectionIdx).toBe(0);
      expect(r2!.slideIdx).toBe(1);
      expect(r2!.confidence).toBeGreaterThanOrEqual(matcher.AUTO_TAKE_THRESHOLD);
    });

    it("resets the coverage window when the cursor moves", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Build up coverage on v1s1 and pre-empt to v1s2.
      const r1 = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound saved",
        { sectionIdx: 0, slideIdx: 0 },
      );
      expect(r1!.slideIdx).toBe(1);
      // New cursor at v1s2. Irrelevant tokens — neither a coverage signal
      // for v1s2 nor a per-hypothesis match. Window should have been reset
      // so no stale tokens carry forward.
      const r2 = matcher.processHypothesis(
        "program",
        "blah blah blah",
        { sectionIdx: 0, slideIdx: 1 },
      );
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

    it("partial hypotheses do NOT trigger coverage pre-emption", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      // Same text that would auto-take as a final, sent as a partial.
      // Should NOT pre-empt — partials are unstable refinements.
      const r = matcher.processHypothesis(
        "program",
        "amazing grace how sweet the sound saved",
        { sectionIdx: 0, slideIdx: 0 },
        { isFinal: false },
      );
      // Partial should at most surface a neighborhood match on the cursor
      // slide, never advance via coverage.
      if (r) {
        expect(r.strategy).not.toBe("coverage");
      }
    });

    it("partial hypothesis tokens do NOT accumulate into the coverage window", () => {
      matcher.bindSession("program", song, song.defaultArrangement);
      const cursor = { sectionIdx: 0, slideIdx: 0 };
      // Send full-coverage text as a series of partials — none of them
      // should grow the window. A subsequent final must still be needed
      // to trigger coverage.
      matcher.processHypothesis("program", "amazing grace how", cursor, { isFinal: false });
      matcher.processHypothesis("program", "sweet the sound", cursor, { isFinal: false });
      // Now a final that on its own only covers 2/5 — without partials in
      // the window, coverage should NOT fire.
      const r = matcher.processHypothesis("program", "saved a wretch", cursor, { isFinal: true });
      if (r) {
        expect(r.strategy).not.toBe("coverage");
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
