import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as songSession from "./songSession";

// CCLI usage logging writes to the data dir; keep tests off disk.
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

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
  customFields: {},
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

  describe("jump with a repeated section", () => {
    const repeated: Song = {
      ...song,
      sections: [
        ...song.sections,
        { id: "v2", kind: "verse", label: "Verse 2", slides: [{ id: "v2s1", lines: ["V2"] }] },
        { id: "b", kind: "bridge", label: "Bridge", slides: [{ id: "b1", lines: ["B"] }] },
      ],
    };
    const arrangement = ["v1", "c", "v2", "c", "b", "c"];
    const startAt = (sectionIdx: number) =>
      songSession.start(
        CH,
        { song: repeated, lyricTemplateId: "lyric-default", arrangement, trustMode: false },
        { sectionIdx, slideIdx: 0 },
      );

    it("lands on the next occurrence after the cursor", () => {
      startAt(2); // V2
      songSession.jump(CH, "c");
      expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 3, slideIdx: 0 });
      // So the next advance goes on to the bridge, not back into V2.
      songSession.advance(CH, 1);
      expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 4, slideIdx: 0 });
    });

    it("wraps to the first occurrence when none follows the cursor", () => {
      startAt(5); // last chorus
      songSession.jump(CH, "v2");
      expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 2, slideIdx: 0 });
    });

    it("stays on the current occurrence when the cursor is already in that section", () => {
      startAt(3); // second chorus
      songSession.jump(CH, "c", 0);
      expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 3, slideIdx: 0 });
    });

    it("jumpByKindOrdinal uses the same next-occurrence rule", () => {
      startAt(4); // bridge
      songSession.jumpByKindOrdinal(CH, "chorus", 1);
      expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 5, slideIdx: 0 });
    });
  });

  it("occurrenceFor picks current, then next, then first", () => {
    const arr = ["v1", "c", "v2", "c"];
    expect(songSession.occurrenceFor(arr, "c", 1)).toBe(1);
    expect(songSession.occurrenceFor(arr, "c", 2)).toBe(3);
    expect(songSession.occurrenceFor(arr, "v1", 3)).toBe(0);
    expect(songSession.occurrenceFor(arr, "x", 0)).toBe(-1);
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

  it("starting a new song with the same lyric template forces a fresh mount (new takenAt)", () => {
    // Without forceMount, the render() optimization would just call
    // channels.update() because previous.templateId === new lyric template,
    // and the renderer would silently swap text with no out/in transition.
    // This test pins that session start always produces a new takenAt so the
    // renderer plays the previous mount's OUT then the new template's IN.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    const t1 = channels.getState(CH).active?.takenAt;
    expect(t1).toBe(1000);

    nowSpy.mockReturnValue(2000);
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["c"], trustMode: false,
    });
    const t2 = channels.getState(CH).active?.takenAt;
    expect(t2).toBe(2000);
    expect(t2).not.toBe(t1);

    nowSpy.mockRestore();
  });

  it("slide advance within a live session produces a new takenAt so the renderer replays IN/OUT", () => {
    // Manual slide changes (advance / jump) re-mount the template each step
    // so the operator sees the template's OUT on the previous slide's text
    // and the IN on the new slide's text. Pure update-in-place would just
    // swap text with no animation.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    const t1 = channels.getState(CH).active?.takenAt;

    nowSpy.mockReturnValue(2000);
    songSession.advance(CH, 1);
    const t2 = channels.getState(CH).active?.takenAt;

    expect(t2).toBe(2000);
    expect(t2).not.toBe(t1);

    nowSpy.mockRestore();
  });

  it("promoteTo forces a fresh mount on the destination channel", () => {
    // Same hazard as session start: if the destination already has the same
    // lyric template active (e.g. preview was cued and program also showed
    // a lyric template), promotion should still re-mount so transitions run.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    // Pre-load destination with a lyric-default mount.
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    const t1 = channels.getState(CH).active?.takenAt;

    nowSpy.mockReturnValue(2000);
    // Promote from a different channel into CH with the same template.
    songSession.promoteTo("preview", CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["c"], trustMode: false,
    });
    const t2 = channels.getState(CH).active?.takenAt;
    expect(t2).toBe(2000);
    expect(t2).not.toBe(t1);

    nowSpy.mockRestore();
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

  it("auto-advance produces a new takenAt so the renderer replays IN/OUT", () => {
    // Trust-mode auto-advance must re-mount the template just like manual
    // advance — otherwise the operator sees text silently swap with no
    // visible transition. The debounce in scheduleAutoAdvance already
    // prevents cascade re-mounts from rapid partials.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: true,
    });
    const t1 = channels.getState(CH).active?.takenAt;
    expect(t1).toBe(1000);

    nowSpy.mockReturnValue(2000);
    songSession.processSttHypothesis(CH, "line b1 line b2", Date.now());
    vi.advanceTimersByTime(300);

    const t2 = channels.getState(CH).active?.takenAt;
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
    expect(t2).toBe(2000);
    expect(t2).not.toBe(t1);

    nowSpy.mockRestore();
  });
});

describe("songSession queued song (intro → section buttons)", () => {
  const args = {
    song,
    lyricTemplateId: "lyric-default",
    arrangement: song.defaultArrangement,
    trustMode: false,
  };
  const meta = { songRowId: "row-1" };

  beforeEach(() => {
    songSession.endAll();
    songSession.clearQueued(CH);
    channels.take(CH, "intro-tpl", { title: "Test Song" });
  });

  it("queue publishes queuedSong on the channel and leaves the intro on air", () => {
    songSession.queue(CH, args, meta);
    const s = channels.getState(CH);
    expect(s.queuedSong).toEqual({ songId: "test-song", songRowId: "row-1", title: "Test Song" });
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.songSession).toBeUndefined();
  });

  it("jumpByKindOrdinal starts the queued song directly at that section", () => {
    songSession.queue(CH, args, meta);
    const takes = vi.spyOn(channels, "takeInternal");
    songSession.jumpByKindOrdinal(CH, "chorus", 1);
    const s = channels.getState(CH);
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(takes).toHaveBeenCalledTimes(1); // no slide-1 flash first
    expect(s.queuedSong).toBeUndefined();
    takes.mockRestore();
  });

  it("jump starts the queued song at the given section and slide", () => {
    songSession.queue(CH, args, meta);
    songSession.jump(CH, "v1", 1);
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance(+1) starts the queued song at its first slide", () => {
    songSession.queue(CH, args, meta);
    songSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
    expect(s.active?.data.text).toBe("Line A1\nLine A2");
  });

  it("advance(-1) with only a queued song does nothing", () => {
    songSession.queue(CH, args, meta);
    songSession.advance(CH, -1);
    expect(channels.getState(CH).songSession).toBeUndefined();
    expect(channels.getState(CH).queuedSong).toBeDefined();
  });

  it("blank and end cancel the queue without touching the intro", () => {
    songSession.queue(CH, args, meta);
    songSession.blank(CH);
    expect(channels.getState(CH).queuedSong).toBeUndefined();
    expect(channels.getState(CH).active?.templateId).toBe("intro-tpl");
    songSession.queue(CH, args, meta);
    songSession.end(CH);
    expect(channels.getState(CH).queuedSong).toBeUndefined();
  });

  it("an external take or operator clear on the channel cancels the queue", () => {
    songSession.queue(CH, args, meta);
    channels.take(CH, "other", {});
    expect(channels.getState(CH).queuedSong).toBeUndefined();
    songSession.queue(CH, args, meta);
    channels.clear(CH);
    expect(channels.getState(CH).queuedSong).toBeUndefined();
  });

  it("an auto-out clear keeps the queue", () => {
    songSession.queue(CH, args, meta);
    channels.clear(CH, { keepQueuedSong: true });
    expect(channels.getState(CH).queuedSong).toBeDefined();
  });

  it("jump with no session and nothing queued stays a no-op", () => {
    songSession.jumpByKindOrdinal(CH, "chorus", 1);
    expect(channels.getState(CH).songSession).toBeUndefined();
  });

  it("PVW→PGM of something else drops program's stale queued song", () => {
    songSession.queue(CH, args, meta);
    channels.take("preview", "scripture-tpl", { ref: "John 3:16" });
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).queuedSong).toBeUndefined();
    songSession.advance(CH, 1);
    expect(channels.getState(CH).active?.templateId).toBe("scripture-tpl");
  });

  it("PVW→PGM of an intro carries its queued song to program", () => {
    channels.take("preview", "intro-tpl", {}, { songRowId: "row-1", sub: "intro" });
    songSession.queue("preview", args, meta);
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).queuedSong?.songRowId).toBe("row-1");
    expect(channels.getState("preview").queuedSong).toBeUndefined();
    songSession.jumpByKindOrdinal(CH, "chorus", 1);
    expect(channels.getState(CH).songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("promoteTo clears the destination's queued song", () => {
    songSession.queue(CH, args, meta);
    songSession.promoteTo("preview", CH, args);
    expect(channels.getState(CH).queuedSong).toBeUndefined();
  });
});

describe("songSession summary names its row (exact-row rule)", () => {
  const base = { song, lyricTemplateId: "lyric-default", arrangement: song.defaultArrangement, trustMode: false };

  beforeEach(() => {
    songSession.endAll();
  });

  it("start publishes the row and show it was taken from", () => {
    songSession.start(CH, { ...base, row: { showId: "show-1", rowId: "row-a" } });
    expect(channels.getState(CH).songSession).toMatchObject({ rowId: "row-a", showId: "show-1" });
  });

  it("promoteTo carries the promoted row, not the source's", () => {
    songSession.start("preview", { ...base, row: { showId: "show-1", rowId: "row-a" } });
    songSession.promoteTo("preview", CH, { ...base, row: { showId: "show-1", rowId: "row-b" } });
    expect(channels.getState(CH).songSession).toMatchObject({ rowId: "row-b", showId: "show-1" });
  });

  it("a queued song started by advance keeps its row", () => {
    songSession.queue(CH, { ...base, row: { showId: "show-1", rowId: "row-q" } }, { songRowId: "row-q" });
    songSession.advance(CH, 1);
    expect(channels.getState(CH).songSession?.rowId).toBe("row-q");
  });

  it("without a row the summary has no rowId (older callers)", () => {
    songSession.start(CH, base);
    expect(channels.getState(CH).songSession?.rowId).toBeUndefined();
  });
});
