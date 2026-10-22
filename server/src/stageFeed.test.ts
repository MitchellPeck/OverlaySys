import { describe, expect, it } from "vitest";
import {
  NONE_SLIDE,
  SPEAKER_LAYOUT,
  ShowSchema,
  SongSchema,
  type ChannelState,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { buildStageFeed, lyricSlideAt, nextLyricCursor, rowTitle } from "./stageFeed";

const song: Song = SongSchema.parse({
  id: "song-1",
  title: "Amazing Grace",
  sections: [
    { id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "a", lines: ["A1"] }, { id: "b", lines: ["B1", "B2"] }] },
    { id: "c", kind: "chorus", label: "Chorus", slides: [{ id: "c1", lines: ["C1"] }] },
  ],
  defaultArrangement: ["v1", "c"],
});

const lowerThird: Template = {
  id: "lt",
  name: "Lower third",
  size: { w: 1920, h: 1080 },
  fields: [
    { key: "name", label: "Name", type: "text" },
    { key: "role", label: "Role", type: "text" },
    { key: "img", label: "Image", type: "image" },
  ],
  layers: [],
  timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  fonts: [],
};

const timerTpl: Template = {
  ...lowerThird,
  id: "timer",
  name: "Countdown",
  fields: [{ key: "t", label: "Service starts", type: "time", timeMode: "countdown", timeFormat: "M:SS" }],
};

const show: Show = ShowSchema.parse({
  id: "show-1",
  name: "Sunday",
  projectId: "p",
  songs: [],
  rows: [
    { kind: "graphic", id: "r-welcome", templateId: "lt", data: { name: "Welcome" }, notes: "Smile" },
    { kind: "song", id: "r-song", songId: "song-1", lyricTemplateId: "lyrics", notes: "  Band in  " },
    {
      kind: "scripture",
      id: "r-scr",
      reference: "John 3:16-17",
      translation: "kjv",
      templateId: "scr",
      slides: [
        { id: "s1", verses: [{ book: "John", chapter: 3, verse: 16, text: "For God so loved" }] },
        { id: "s2", verses: [{ book: "John", chapter: 3, verse: 17, text: "For God sent not" }] },
      ],
    },
    { kind: "video", id: "r-vid", assetUrl: "/assets/v.mp4", label: "Announcements" },
  ],
});

const songs = new Map([[song.id, song]]);
const templates = new Map([
  [lowerThird.id, lowerThird],
  [timerTpl.id, timerTpl],
]);

function base(followed: ChannelState | null, extra: Partial<Parameters<typeof buildStageFeed>[0]> = {}) {
  return buildStageFeed({
    layout: SPEAKER_LAYOUT,
    followed,
    allStates: followed ? [followed] : [],
    show,
    songs,
    templates,
    now: 1000,
    ...extra,
  });
}

function songState(sectionIdx: number, slideIdx: number, arrangement = ["v1", "c"]): ChannelState {
  return {
    channel: "program",
    active: { templateId: "lyrics", data: { text: "" }, phase: "on", takenAt: 1 },
    songSession: {
      songId: "song-1",
      lyricTemplateId: "lyrics",
      arrangement,
      cursor: { sectionIdx, slideIdx },
      blanked: false,
      trustMode: false,
      startedAt: 1,
    },
    liveRow: { showId: "show-1", rowId: "r-song" },
  };
}

describe("lyric helpers", () => {
  it("reads the slide at a cursor", () => {
    expect(lyricSlideAt(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({
      kind: "lyric",
      lines: ["B1", "B2"],
      reference: "Verse 1",
    });
  });
  it("advances within a section, across sections, and ends", () => {
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 0 })).toEqual({ sectionIdx: 0, slideIdx: 1 });
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({ sectionIdx: 1, slideIdx: 0 });
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 1, slideIdx: 0 })).toBeNull();
  });
  it("skips arrangement entries whose section is missing", () => {
    expect(nextLyricCursor(song, ["v1", "gone", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({ sectionIdx: 2, slideIdx: 0 });
    expect(lyricSlideAt(song, ["gone"], { sectionIdx: 0, slideIdx: 0 })).toEqual(NONE_SLIDE);
  });
});

describe("rowTitle", () => {
  it("names each row kind", () => {
    expect(rowTitle(show.rows[0]!, songs, templates)).toBe("Lower third — Welcome");
    expect(rowTitle(show.rows[1]!, songs, templates)).toBe("Amazing Grace");
    expect(rowTitle(show.rows[2]!, songs, templates)).toBe("John 3:16-17");
    expect(rowTitle(show.rows[3]!, songs, templates)).toBe("Announcements");
  });
});

describe("buildStageFeed", () => {
  it("is empty and safe with no followed channel", () => {
    const f = base(null);
    expect(f.current).toEqual(NONE_SLIDE);
    expect(f.next).toEqual(NONE_SLIDE);
    expect(f.row).toBeNull();
    expect(f.nextRow).toBeNull();
    expect(f.video).toBeNull();
    expect(f.timers).toEqual([]);
    expect(f.serverNow).toBe(1000);
  });

  it("song mid-section: current and next are lyric slides, row and cue from the rundown", () => {
    const f = base(songState(0, 0));
    expect(f.current).toEqual({ kind: "lyric", lines: ["A1"], reference: "Verse 1" });
    expect(f.next).toEqual({ kind: "lyric", lines: ["B1", "B2"], reference: "Verse 1" });
    expect(f.row).toEqual({ title: "Amazing Grace", cue: "Band in" });
    expect(f.nextRow).toEqual({ title: "John 3:16-17", cue: "" });
  });

  it("last lyric slide: next falls through to the next row's first content", () => {
    const f = base(songState(1, 0));
    expect(f.next).toEqual({ kind: "scripture", lines: ["For God so loved"], reference: "John 3:16" });
  });

  it("blanked song shows no current lines but still computes next", () => {
    const s = songState(0, 0);
    s.songSession!.blanked = true;
    const f = base(s);
    expect(f.current).toEqual(NONE_SLIDE);
    expect(f.next.lines).toEqual(["B1", "B2"]);
  });

  it("scripture: next slide, then next row after the last slide", () => {
    const scr = (slideIdx: number): ChannelState => ({
      channel: "program",
      active: { templateId: "scr", data: {}, phase: "on", takenAt: 1 },
      scriptureSession: {
        rowId: "r-scr",
        reference: "John 3:16-17",
        slideIdx,
        slideCount: 2,
        slideReference: slideIdx === 0 ? "John 3:16" : "John 3:17",
        text: slideIdx === 0 ? "For God so loved" : "For God sent not",
      },
      liveRow: { showId: "show-1", rowId: "r-scr" },
    });
    const first = base(scr(0));
    expect(first.current).toEqual({ kind: "scripture", lines: ["For God so loved"], reference: "John 3:16" });
    expect(first.next).toEqual({ kind: "scripture", lines: ["For God sent not"], reference: "John 3:17" });
    const last = base(scr(1));
    expect(last.next).toEqual({ kind: "graphic", lines: ["Announcements"], reference: "Video" });
  });

  it("graphic: current lines are the template's non-empty text fields", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Jane", role: "", img: "x.png" }, phase: "on", takenAt: 1 },
      liveRow: { showId: "show-1", rowId: "r-welcome" },
    });
    expect(f.current).toEqual({ kind: "graphic", lines: ["Jane"], reference: "Lower third" });
    expect(f.row).toEqual({ title: "Lower third — Welcome", cue: "Smile" });
    expect(f.next).toEqual({ kind: "lyric", lines: ["A1"], reference: "Amazing Grace" });
  });

  it("a graphic in its out phase is not current", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Jane" }, phase: "out", takenAt: 1 },
    });
    expect(f.current).toEqual(NONE_SLIDE);
  });

  it("song intro on air with the song queued: next is the song's first slide", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Amazing Grace" }, phase: "on", takenAt: 1, subTakeContext: { songRowId: "r-song", sub: "intro" } },
      queuedSong: { songId: "song-1", songRowId: "r-song", title: "Amazing Grace" },
      liveRow: { showId: "show-1", rowId: "r-song" },
    });
    expect(f.next).toEqual({ kind: "lyric", lines: ["A1"], reference: "Amazing Grace" });
  });

  it("live row deleted from the show: row/nextRow null, session next still works", () => {
    const s = songState(0, 0);
    s.liveRow = { showId: "show-1", rowId: "deleted" };
    const f = base(s);
    expect(f.row).toBeNull();
    expect(f.nextRow).toBeNull();
    expect(f.next.lines).toEqual(["B1", "B2"]);
  });

  it("show missing: row null, last slide next is none", () => {
    const f = base(songState(1, 0), { show: null });
    expect(f.row).toBeNull();
    expect(f.next).toEqual(NONE_SLIDE);
  });

  it("collects running timers from every channel, sorted by channel", () => {
    const followed = songState(0, 0);
    const timerState: ChannelState = {
      channel: "a-timers",
      active: { templateId: "timer", data: { t: "5000" }, phase: "on", takenAt: 1 },
    };
    const f = base(followed, { allStates: [followed, timerState] });
    expect(f.timers).toEqual([
      { label: "Service starts", channel: "a-timers", mode: "countdown", format: "M:SS", value: "5000" },
    ]);
  });

  it("skips timers with an unparseable value", () => {
    const timerState: ChannelState = {
      channel: "t",
      active: { templateId: "timer", data: { t: "" }, phase: "on", takenAt: 1 },
    };
    expect(base(null, { allStates: [timerState] }).timers).toEqual([]);
  });

  it("reports video on the followed channel until it ends", () => {
    const media = (status: "playing" | "ended"): ChannelState => ({
      channel: "program",
      active: null,
      media: {
        rowId: "r-vid",
        assetUrl: "/assets/v.mp4",
        label: "Announcements",
        volume: 1,
        endAction: "clear",
        transitionIn: { style: "cut", durationMs: 0 },
        transitionOut: { style: "cut", durationMs: 0 },
        takenAt: 1,
        paused: false,
        playback: { status, currentTime: 12, duration: 90, updatedAt: 900 },
      },
      liveRow: { showId: "show-1", rowId: "r-vid" },
    });
    expect(base(media("playing")).video).toEqual({
      status: "playing",
      currentTime: 12,
      duration: 90,
      at: 900,
      label: "Announcements",
    });
    expect(base(media("ended")).video).toBeNull();
  });
});
