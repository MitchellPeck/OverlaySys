import { describe, it, expect } from "vitest";
import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";
import { hotcardAirState, rowAirState } from "./rowAirState";

type Row = Show["rows"][number];

const graphic = (id: string, data: Record<string, string>): Row =>
  ({ id, kind: "graphic", templateId: "l3", data }) as unknown as Row;
const song = (id: string, songId: string): Row =>
  ({ id, kind: "song", songId, lyricTemplateId: "lyr" }) as unknown as Row;
const video = (id: string): Row => ({ id, kind: "video", label: "v" }) as unknown as Row;
const scripture = (id: string): Row => ({ id, kind: "scripture", reference: "John 3:16" }) as unknown as Row;

const active = (templateId: string, data: Record<string, string>, phase: "in" | "on" | "out" = "on") =>
  ({ templateId, data, phase, takenAt: 1 });

const session = (songId: string): SongSessionSummary => ({
  songId,
  lyricTemplateId: "lyr",
  arrangement: [],
  cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false,
  trustMode: false,
  startedAt: 1,
});

describe("rowAirState", () => {
  it("matches a graphic row on program by template AND data", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(graphic("a", { name: "Sam" }), states, {})).toBe("program");
  });

  it("does not light a second row that shares the template but not the data", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(graphic("b", { name: "Alex" }), states, {})).toBeNull();
  });

  it("ignores a graphic that is animating out", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }, "out") },
    };
    expect(rowAirState(graphic("a", { name: "Sam" }), states, {})).toBeNull();
  });

  it("reports preview when cued and program wins when on both", () => {
    const g = graphic("a", { name: "Sam" });
    const pvwOnly: Record<string, ChannelState> = {
      preview: { channel: "preview", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(g, pvwOnly, {})).toBe("preview");
    const both: Record<string, ChannelState> = {
      ...pvwOnly,
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(g, both, {})).toBe("program");
  });

  it("matches a song row by its session's songId", () => {
    expect(rowAirState(song("s", "way-maker"), {}, { program: session("way-maker") })).toBe("program");
    expect(rowAirState(song("s", "way-maker"), {}, { preview: session("way-maker") })).toBe("preview");
    expect(rowAirState(song("s", "other"), {}, { program: session("way-maker") })).toBeNull();
  });

  it("matches a song row by intro/outro subTakeContext", () => {
    const states: Record<string, ChannelState> = {
      program: {
        channel: "program",
        active: { ...active("intro", {}), subTakeContext: { songRowId: "s", sub: "intro" } },
      },
    };
    expect(rowAirState(song("s", "way-maker"), states, {})).toBe("program");
  });

  it("matches a video row by media.rowId unless ended or errored", () => {
    const media = (status: "playing" | "ended" | "error") => ({
      rowId: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "hold" as const, mediaType: "video" as const, fit: "contain" as const, position: "center" as const, loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
      playback: { status, currentTime: 0, duration: 10, updatedAt: 1 },
    });
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("playing") } }, {})).toBe("program");
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("ended") } }, {})).toBeNull();
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("error") } }, {})).toBeNull();
  });

  it("image row never reports ended", () => {
    const photo = { id: "p1", kind: "media", mediaType: "image", assetUrl: "/a.png" } as unknown as Row;
    const media = (status: "loading" | "playing" | "ended") => ({
      rowId: "p1", assetUrl: "/a.png", volume: 1, endAction: "hold" as const, mediaType: "image" as const, fit: "cover" as const, position: "center" as const, loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
      playback: { status, currentTime: 0, duration: 0, updatedAt: 1 },
    });
    for (const status of ["loading", "playing", "ended"] as const) {
      expect(rowAirState(photo, { program: { channel: "program", active: null, media: media(status) } }, {})).toBe("program");
    }
    expect(rowAirState(photo, { program: { channel: "program", active: null } }, {})).toBeNull();
  });

  it("scripture lights from its session or its intro context", () => {
    const row = { kind: "scripture", id: "sr", reference: "John 3:16", translation: "KJV", templateId: "body", slides: [] } as unknown as Show["rows"][number];
    const live = {
      program: { channel: "program", active: null, scriptureSession: { rowId: "sr", reference: "John 3:16", slideIdx: 0, slideCount: 1, slideReference: "John 3:16", text: "x" } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, live, {})).toBe("program");
    const intro = {
      preview: { channel: "preview", active: { templateId: "intro", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "sr", sub: "intro" } } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, intro, {})).toBe("preview");
    expect(rowAirState(row, {}, {})).toBeNull();
  });

  it("a cleared scripture (active going out, session gone) is not ON AIR; a cue on preview stays cued", () => {
    const row = { kind: "scripture", id: "sr", reference: "John 3:16", translation: "KJV", templateId: "body", slides: [] } as unknown as Show["rows"][number];
    const out = { templateId: "body", data: {}, phase: "out", takenAt: 1, scriptureContext: { rowId: "sr", sub: "slide", slideIdx: 0 } };
    const cleared = {
      program: { channel: "program", active: out },
      preview: { channel: "preview", active: null, scriptureSession: { rowId: "sr", reference: "John 3:16", slideIdx: 0, slideCount: 1, slideReference: "John 3:16", text: "x" } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, cleared, {})).toBe("preview");
    expect(rowAirState(row, { program: cleared.program! }, {})).toBeNull();
  });

  it("a song's outgoing intro (sub-take going out) is not ON AIR", () => {
    const row = song("r", "s1");
    const st = {
      program: { channel: "program", active: { templateId: "i", data: {}, phase: "out", takenAt: 1, subTakeContext: { songRowId: "r", sub: "intro" } } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, st, {})).toBeNull();
  });
});

describe("rowAirState song context", () => {
  it("lights a song on the output it is routed to", () => {
    const row = song("s", "way-maker");
    const sessions = { lyrics: session("way-maker") };
    expect(rowAirState(row, {}, sessions)).toBeNull();
    expect(rowAirState(row, {}, sessions, { songChannel: "lyrics" })).toBe("program");
  });

  it("lights only the taken row when the same song appears twice", () => {
    const a = song("a", "way-maker");
    const b = song("b", "way-maker");
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: null, liveRow: { showId: "show1", rowId: "b" } },
    };
    const ctx = { showId: "show1", rows: [a, b] };
    const sessions = { program: session("way-maker") };
    expect(rowAirState(a, states, sessions, ctx)).toBeNull();
    expect(rowAirState(b, states, sessions, ctx)).toBe("program");
  });

  it("reprise after a video take, or with no liveRow: neither row of the song lights", () => {
    const a = song("a", "way-maker");
    const b = song("b", "way-maker");
    const v = { id: "v", kind: "video" } as unknown as Row;
    const ctx = { showId: "show1", rows: [a, v, b] };
    const sessions = { program: session("way-maker") };
    const onVideo: Record<string, ChannelState> = {
      program: { channel: "program", active: null, liveRow: { showId: "show1", rowId: "v" } },
    };
    const none: Record<string, ChannelState> = { program: { channel: "program", active: null } };
    for (const st of [onVideo, none]) {
      expect(rowAirState(a, st, sessions, ctx)).toBeNull();
      expect(rowAirState(b, st, sessions, ctx)).toBeNull();
    }
    // The song's only row still lights with the liveRow on the video.
    expect(rowAirState(a, onVideo, sessions, { showId: "show1", rows: [a, v] })).toBe("program");
  });

  it("a session that names its row lights exactly that row, even with a video's liveRow", () => {
    const a = song("a", "way-maker");
    const b = song("b", "way-maker");
    const v = { id: "v", kind: "video" } as unknown as Row;
    const ctx = { showId: "show1", rows: [a, v, b] };
    const sessions = { program: { ...session("way-maker"), rowId: "b", showId: "show1" } };
    const onVideo: Record<string, ChannelState> = {
      program: { channel: "program", active: null, liveRow: { showId: "show1", rowId: "v" } },
    };
    expect(rowAirState(a, onVideo, sessions, ctx)).toBeNull();
    expect(rowAirState(b, onVideo, sessions, ctx)).toBe("program");
    // Even when liveRow disagrees (stale), the session's own row wins.
    const stale: Record<string, ChannelState> = {
      program: { channel: "program", active: null, liveRow: { showId: "show1", rowId: "a" } },
    };
    expect(rowAirState(a, stale, sessions, ctx)).toBeNull();
    expect(rowAirState(b, stale, sessions, ctx)).toBe("program");
  });

  it("falls back to lighting the song's only row when liveRow points elsewhere", () => {
    const a = song("a", "way-maker");
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: null, liveRow: { showId: "other-show", rowId: "x" } },
    };
    expect(rowAirState(a, states, { program: session("way-maker") }, { showId: "show1", rows: [a] })).toBe("program");
  });
});

describe("hotcardAirState", () => {
  it("matches template and data, ignoring an outgoing graphic", () => {
    const h = { templateId: "l3", data: { name: "Sam" } };
    expect(hotcardAirState(h, { program: { channel: "program", active: active("l3", { name: "Sam" }) } })).toBe("program");
    expect(hotcardAirState(h, { program: { channel: "program", active: active("l3", { name: "Sam" }, "out") } })).toBeNull();
    expect(hotcardAirState(h, { preview: { channel: "preview", active: active("l3", { name: "Sam" }) } })).toBe("preview");
    expect(hotcardAirState(undefined, {})).toBeNull();
  });
});

describe("rowAirState other-show", () => {
  const rows: Row[] = [song("row1", "s1")];
  const states = (showId: string): Record<string, ChannelState> => ({
    program: { channel: "program", active: null, songSession: session("s1"), liveRow: { showId, rowId: "x" } },
  });
  it("a song live from another show is other-show, not program", () => {
    const sess = { program: session("s1") };
    expect(rowAirState(song("row1", "s1"), states("otherShow"), sess, { showId: "show1", rows })).toBe("other-show");
  });
  it("a song live from this show still reads program", () => {
    const sess = { program: session("s1") };
    expect(rowAirState(song("row1", "s1"), states("show1"), sess, { showId: "show1", rows })).toBe("program");
  });
  it("a scripture session from another show is other-show", () => {
    const st: Record<string, ChannelState> = {
      program: {
        channel: "program", active: null, liveRow: { showId: "otherShow", rowId: "q" },
        scriptureSession: { rowId: "sc", reference: "John 3:16", slideIdx: 0, slideCount: 1, slideReference: "John 3:16", text: "t" },
      },
    };
    expect(rowAirState(scripture("sc"), st, {}, { showId: "show1" })).toBe("other-show");
  });
  it("prefers a real preview match over other-show on program", () => {
    const st = {
      ...states("otherShow"),
      preview: { channel: "preview", active: null, songSession: session("s1"), liveRow: { showId: "show1", rowId: "row1" } },
    } as Record<string, ChannelState>;
    expect(rowAirState(song("row1", "s1"), st, { program: session("s1"), preview: session("s1") }, { showId: "show1", rows })).toBe("preview");
  });
  it("routes slides rows through the adapter (stub: null)", () => {
    expect(rowAirState({ id: "sl", kind: "slides" } as unknown as Row, {}, {})).toBeNull();
  });
});
