import { describe, it, expect } from "vitest";
import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";
import { rowAirState } from "./rowAirState";

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
      rowId: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "hold" as const, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
      playback: { status, currentTime: 0, duration: 10, updatedAt: 1 },
    });
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("playing") } }, {})).toBe("program");
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("ended") } }, {})).toBeNull();
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("error") } }, {})).toBeNull();
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
});
