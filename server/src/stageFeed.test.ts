import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_STAGE_STATE,
  NONE_SLIDE,
  SPEAKER_LAYOUT,
  ShowSchema,
  SongSchema,
  type ChannelState,
  type Deck,
  type Show,
  type Song,
  type StageTimerInstance,
  type Template,
  decodeTimerValue,
} from "@overlaysys/core";
import { buildStageFeed, firstContentOf, lyricSlideAt, nextLyricCursor, rowTitle } from "./stageFeed";

// CCLI usage logging writes to the data dir; keep tests off disk.
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

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
    stage: INITIAL_STAGE_STATE,
    notes: null,
    stageTimers: [],
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

  it("stage feed treats an image row like a video row", () => {
    const vid = show.rows[3]!;
    const img = { kind: "media", id: "r-img", mediaType: "image", assetUrl: "/assets/p.png", label: "Welcome photo" } as never;
    const bare = { kind: "media", id: "r-img2", mediaType: "image", assetUrl: "/assets/p.png" } as never;
    expect(rowTitle(img, songs, templates)).toBe("Welcome photo");
    expect(rowTitle(bare, songs, templates)).toBe("Photo");
    expect(firstContentOf(vid, show, songs, templates)).toMatchObject({ kind: "graphic", lines: ["Announcements"] });
    expect(firstContentOf(img, show, songs, templates)).toMatchObject({ kind: "graphic", lines: ["Welcome photo"] });
    const showWithImg = { ...show, rows: [...show.rows, img] } as Show;
    const state: ChannelState = { channel: "program", active: null, liveRow: { showId: "show-1", rowId: "r-img" } } as ChannelState;
    const feed = base(state, { show: showWithImg });
    expect(feed.video).toBeNull();
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
      {
        id: "a-timers:t",
        source: "graphic",
        overtime: false,
        running: true,
        label: "Service starts",
        channel: "a-timers",
        mode: "countdown",
        format: "M:SS",
        value: "5000",
      },
    ]);
  });

  it("lists the followed channel's timers before other channels'", () => {
    const followed: ChannelState = {
      channel: "program",
      active: { templateId: "timer", data: { t: "7000" }, phase: "on", takenAt: 1 },
    };
    const other: ChannelState = {
      channel: "a-chan",
      active: { templateId: "timer", data: { t: "5000" }, phase: "on", takenAt: 1 },
    };
    const f = base(followed, { allStates: [other, followed] });
    expect(f.timers.map((t) => t.channel)).toEqual(["program", "a-chan"]);
  });

  const manual: StageTimerInstance = {
    id: "m1",
    label: "Sermon",
    mode: "countdown",
    durationMs: 60_000,
    anchor: null,
    overtime: true,
    source: "manual",
  };
  const item: StageTimerInstance = {
    id: "current-item",
    label: "Song",
    mode: "countdown",
    durationMs: 120_000,
    anchor: 61_000,
    overtime: true,
    source: "item",
    rowId: "r-song",
  };

  it("item timer, then manual, then graphic", () => {
    const followed: ChannelState = {
      channel: "program",
      active: { templateId: "timer", data: { t: "7000" }, phase: "on", takenAt: 1 },
    };
    const f = base(followed, { stageTimers: [item, manual] });
    expect(f.timers.map((t) => t.source)).toEqual(["item", "manual", "graphic"]);
  });

  it("graphic timer ids are channel:field", () => {
    const followed: ChannelState = {
      channel: "program",
      active: { templateId: "timer", data: { t: "7000" }, phase: "on", takenAt: 1 },
    };
    const g = base(followed).timers[0]!;
    expect(g.id).toBe("program:t");
    expect(g.overtime).toBe(false);
  });

  it("not-started manual timer is not running and shows full duration", () => {
    const t = base(null, { stageTimers: [manual] }).timers[0]!;
    expect(t.running).toBe(false);
    expect(t.overtime).toBe(true);
    expect(decodeTimerValue(t.value)).toEqual({ anchor: 1000 + 60_000, pausedAt: 1000 });
  });

  it("a started instance is running; a paused one is not", () => {
    const started: StageTimerInstance = { ...manual, anchor: 61_000 };
    const paused: StageTimerInstance = { ...started, id: "m2", pausedAt: 5_000 };
    const [a, b] = base(null, { stageTimers: [started, paused] }).timers;
    expect(a!.running).toBe(true);
    expect(b!.running).toBe(false);
  });

  it("treats a null pausedAt as not paused", () => {
    const odd = { ...manual, anchor: 61_000, pausedAt: null } as unknown as StageTimerInstance;
    expect(base(null, { stageTimers: [odd] }).timers[0]!.running).toBe(true);
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
        mediaType: "video",
        fit: "contain",
        position: "center",
        loop: false,
        muted: false,
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

  it("includes the active notes with a clamped point index", () => {
    const f = base(null, {
      stage: { ...INITIAL_STAGE_STATE, notes: { showId: "show-1", notesId: "n" }, pointIdx: 9, scrollOffset: 0.5 },
      notes: {
        notes: { id: "n", title: "Grace", body: "" },
        points: [
          { heading: "A", markdown: "# A" },
          { heading: "B", markdown: "# B" },
        ],
      },
    });
    expect(f.notes).toEqual({
      id: "n",
      title: "Grace",
      points: [
        { heading: "A", markdown: "# A" },
        { heading: "B", markdown: "# B" },
      ],
      pointIdx: 1,
      scrollOffset: 0.5,
    });
  });

  it("service passes through unchanged", () => {
    expect(base(null).service).toBeNull();
    const service = {
      source: "pco" as const,
      planTitle: "Sunday",
      itemIndex: 2,
      itemCount: 3,
      current: { id: "b", title: "B", startedAt: 5, lengthSec: 600 },
      next: { title: "C" },
      laterLengthSec: 900,
      plannedEndAt: 99,
      status: "live" as const,
    };
    expect(base(null, { service }).service).toBe(service);
  });

  it("notes are null without an active set; message passes through", () => {
    const f = base(null, { stage: { ...INITIAL_STAGE_STATE, message: { text: "Wrap up", sentAt: 3 } } });
    expect(f.notes).toBeNull();
    expect(f.message).toEqual({ text: "Wrap up", sentAt: 3 });
  });

  it("an empty notes document yields notes with no points and index 0", () => {
    const f = base(null, {
      stage: { ...INITIAL_STAGE_STATE, notes: { showId: "s", notesId: "n" }, pointIdx: 2 },
      notes: { notes: { id: "n", title: "Empty", body: "" }, points: [] },
    });
    expect(f.notes).toMatchObject({ points: [], pointIdx: 0 });
  });
});

describe("slides rows", () => {
  const deck = {
    id: "d1",
    name: "Gloria",
    tags: [],
    defaultTemplateId: "lt",
    licensing: { kind: "liturgy" },
    slides: [
      { id: "s1", label: "Response 1", data: { name: "Line A" } },
      { id: "s2", data: { name: "Line B" } },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Deck;
  const decks = new Map([[deck.id, deck]]);
  const slidesShow: Show = ShowSchema.parse({
    id: "show-1",
    name: "Sunday",
    projectId: "p",
    songs: [],
    rows: [
      { kind: "slides", id: "r", deckId: "d1" },
      { kind: "slides", id: "r2", deckId: "d1", slideIds: ["s2"] },
    ],
  });
  const summary = {
    rowId: "r",
    title: "Gloria",
    slideIdx: 0,
    slideCount: 2,
    label: "Response 1",
    lines: ["Line A"],
    nextLines: ["Line B"],
    blanked: false,
    atEnd: false,
  };
  const stateWith = (slidesSession: ChannelState["slidesSession"]): ChannelState => ({
    channel: "program",
    active: null,
    liveRow: { showId: "show-1", rowId: "r" },
    slidesSession,
  });
  const feedOf = (followed: ChannelState) => base(followed, { show: slidesShow, decks });

  it("current/next come from the live slides session as lyric slides with the label as reference", () => {
    const feed = feedOf(stateWith(summary));
    expect(feed.current).toEqual({ kind: "lyric", lines: ["Line A"], reference: "Response 1" });
    expect(feed.next).toEqual({ kind: "lyric", lines: ["Line B"], reference: "Gloria" });
  });
  it("uses nextLabel for the next slide and the title when there is no label", () => {
    const feed = feedOf(stateWith({ ...summary, label: undefined, nextLabel: "Response 2" }));
    expect(feed.current.reference).toBe("Gloria");
    expect(feed.next.reference).toBe("Response 2");
  });
  it("blanked shows none as current", () => {
    expect(feedOf(stateWith({ ...summary, blanked: true })).current).toEqual(NONE_SLIDE);
  });
  it("on the last slide next falls back to the next row's first content", () => {
    const feed = feedOf(stateWith({ ...summary, slideIdx: 1, lines: ["Line B"], nextLines: undefined, atEnd: true }));
    expect(feed.next).toEqual({ kind: "lyric", lines: ["Line B"], reference: "Gloria" });
  });
  it("rowTitle and firstContentOf use the deck name and its first resolved slide", () => {
    expect(rowTitle(slidesShow.rows[0]!, songs, templates, decks)).toBe("Gloria");
    expect(rowTitle({ ...slidesShow.rows[0]!, deckId: "gone" } as never, songs, templates, decks)).toBe("Missing deck");
    expect(firstContentOf(slidesShow.rows[0]!, slidesShow, songs, templates, decks)).toEqual({
      kind: "lyric",
      lines: ["Line A"],
      reference: "Gloria",
    });
    expect(firstContentOf(slidesShow.rows[1]!, slidesShow, songs, templates, decks)).toMatchObject({ lines: ["Line B"] });
    expect(
      firstContentOf({ ...slidesShow.rows[0]!, deckId: "gone" } as never, slidesShow, songs, templates, decks),
    ).toEqual(NONE_SLIDE);
  });
});
