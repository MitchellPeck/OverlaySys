import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as songSession from "./songSession";

const song: Song = {
  id: "test-song",
  title: "Test Song",
  sections: [
    {
      id: "v1",
      kind: "verse",
      label: "Verse 1",
      slides: [
        { id: "v1s1", lines: ["Line A1", "Line A2"] },
        { id: "v1s2", lines: ["Line B1", "Line B2"] },
      ],
    },
    {
      id: "c",
      kind: "chorus",
      label: "Chorus",
      slides: [
        { id: "c1", lines: ["Chorus 1", "Chorus 2"] },
      ],
    },
  ],
  defaultArrangement: ["v1", "c", "v1"],
};

const CH = "program";

describe("songSession", () => {
  beforeEach(() => {
    songSession.endAll();
  });

  it("starts a session and renders the first slide on the channel", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("lyric-default");
    expect(s.active?.data.text).toBe("Line A1\nLine A2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
  });

  it("advance(+1) moves to the next slide in the same section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance past end of section moves to next section in arrangement", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1); // v1 slide 2
    songSession.advance(CH, 1); // -> chorus slide 0
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("advance(-1) moves backward across section boundary", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    songSession.advance(CH, 1); // chorus
    songSession.advance(CH, -1); // back to v1 slide 2
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance(+1) past end of arrangement is a no-op", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.advance(CH, 1); // slide 2
    const before = channels.getState(CH).songSession?.cursor;
    songSession.advance(CH, 1); // would overflow
    const after = channels.getState(CH).songSession?.cursor;
    expect(after).toEqual(before);
  });

  it("jump moves cursor to the requested section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("jump to a section not yet in the arrangement appends it", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.songSession?.arrangement).toEqual(["v1", "c"]);
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("blank triggers the channel's out phase without ending the session", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.blank(CH);
    const blanked = channels.getState(CH);
    // active enters "out" phase so the renderer plays its out animation;
    // it nulls asynchronously after a 1.5s grace (not asserted here).
    expect(blanked.active?.phase).toBe("out");
    expect(blanked.songSession?.blanked).toBe(true);
    songSession.blank(CH);
    const restored = channels.getState(CH);
    expect(restored.active?.data.text).toBe("Line A1\nLine A2");
    expect(restored.active?.phase).toBe("in");
    expect(restored.songSession?.blanked).toBe(false);
  });

  it("end clears the session and the channel", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.end(CH);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
  });

  it("ends the session when a graphic take lands on the same channel", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    channels.take(CH, "lower-third-default", { name: "Pastor" });
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
    expect(s.active?.templateId).toBe("lower-third-default");
  });

  it("ends the session when channel is cleared externally", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    channels.clear(CH);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
  });

  it("ends the session when takePvwToPgm promotes onto the session's channel", () => {
    // Stage a graphic on preview, start a song on program, then PVW→PGM.
    // The song session on program must end so the promoted graphic stays live.
    channels.take("preview", "lower-third-default", { name: "Pastor" });
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    channels.takePvwToPgm("preview", CH);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
    expect(s.active?.templateId).toBe("lower-third-default");
  });
});

// The song fixture here has:
//   v1s1: ["Line A1", "Line A2"]
//   v1s2: ["Line B1", "Line B2"]
//   c1:   ["Chorus 1", "Chorus 2"]
// The matcher normalizes to lowercase, so "line b1 line b2" matches v1s2,
// and "line a1 line a2" matches v1s1.
// Tests use vi.useFakeTimers() + vi.advanceTimersByTime(300) to flush debounce.

describe("songSession trust mode", () => {
  beforeEach(() => {
    songSession.endAll();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-advances when STT confidence >= AUTO_TAKE_THRESHOLD and target is forward", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: true,
    });
    // Hypothesis matches v1s2 — forward from cursor at v1s1.
    songSession.processSttHypothesis(CH, "line b1 line b2", Date.now());
    // Match emitted synchronously, but auto-advance is debounced by 300ms.
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
    vi.advanceTimersByTime(300);
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("does NOT auto-advance when trustMode is off", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    songSession.processSttHypothesis(CH, "line b1 line b2", Date.now());
    vi.advanceTimersByTime(300);
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
  });

  it("does NOT auto-advance backward even with high confidence", () => {
    // Use a non-repeating arrangement so "line a1" only matches backward.
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: ["v1", "c"],
      trustMode: true,
    });
    // Move cursor forward first to v1s2.
    songSession.advance(CH, 1);
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
    // Now hypothesis matches v1s1 (line a1 a2) — backward.
    // With no forward section containing v1s1 content, the matcher should
    // produce no forward-eligible candidate above AUTO_TAKE_THRESHOLD.
    songSession.processSttHypothesis(CH, "line a1 line a2", Date.now());
    vi.advanceTimersByTime(300);
    // Cursor should still be at v1s2.
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("ending the session cancels any pending auto-advance timer", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: true,
    });
    songSession.processSttHypothesis(CH, "line b1 line b2", Date.now());
    songSession.end(CH);
    vi.advanceTimersByTime(300);
    // No throw, no zombie cursor advance.
    expect(channels.getState(CH).songSession).toBeUndefined();
  });
});
