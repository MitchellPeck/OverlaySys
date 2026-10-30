import { describe, expect, it } from "vitest";
import type { ChannelMedia, ChannelState, VideoRow } from "@overlaysys/core";
import { onAirMediaFor, posterPathFor, seekTargetForKey, videoRowTakeMessage } from "./mediaTake";

const row = (over: Partial<VideoRow> = {}): VideoRow => ({
  kind: "video", id: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "clear", transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, ...over,
});
const media = (status: ChannelMedia["playback"]["status"], rowId = "v1"): ChannelMedia => ({
  rowId, assetUrl: "/a.mp4", volume: 1, endAction: "clear", mediaType: "video", fit: "contain", loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
  playback: { status, currentTime: 0, duration: 10, updatedAt: 1 },
});
const states = (ch: string, m: ChannelMedia): Record<string, ChannelState> =>
  ({ [ch]: { channel: ch, media: m } as ChannelState });

describe("onAirMediaFor", () => {
  it("returns the media when this row is on air", () => {
    const m = media("playing");
    expect(onAirMediaFor(row(), states("program", m))).toBe(m);
    expect(onAirMediaFor(row(), states("program", media("paused")))).not.toBeNull();
  });
  it("null for another row", () => {
    expect(onAirMediaFor(row(), states("program", media("playing", "other")))).toBeNull();
  });
  it("null once ended or errored", () => {
    expect(onAirMediaFor(row(), states("program", media("ended")))).toBeNull();
    expect(onAirMediaFor(row(), states("program", media("error")))).toBeNull();
  });
  it("null when on a different channel", () => {
    expect(onAirMediaFor(row({ channelHint: "alt" }), states("program", media("playing")))).toBeNull();
    expect(onAirMediaFor(row({ channelHint: "alt" }), states("alt", media("playing")))).not.toBeNull();
  });
});

describe("posterPathFor", () => {
  it("maps a stored video asset to its poster route", () => {
    expect(posterPathFor(`/assets/${"a".repeat(64)}.mp4`)).toBe(`/api/assets/poster/${"a".repeat(64)}.mp4`);
    expect(posterPathFor("/assets/abc.webm")).toBe("/api/assets/poster/abc.webm");
  });

  it("is null for anything the local server can't poster", () => {
    expect(posterPathFor("https://cdn.example/x.mp4")).toBeNull();
    expect(posterPathFor("/assets/abc.png")).toBeNull();
    expect(posterPathFor("")).toBeNull();
  });
});

describe("videoRowTakeMessage showId", () => {
  it("adds showId when given", () => {
    expect(videoRowTakeMessage(row(), "show-1")).toMatchObject({ showId: "show-1", rowId: "v1" });
  });
  it("omits showId without one", () => {
    expect(videoRowTakeMessage(row())).not.toHaveProperty("showId");
  });
});

describe("seekTargetForKey", () => {
  it("steps 5 s, or 15 s with Shift, clamped to the clip", () => {
    expect(seekTargetForKey("ArrowRight", false, 10, 60)).toBe(15);
    expect(seekTargetForKey("ArrowLeft", true, 10, 60)).toBe(0);
    expect(seekTargetForKey("ArrowUp", true, 50, 60)).toBe(59);
  });

  it("jumps with Home/End and ignores other keys or unknown duration", () => {
    expect(seekTargetForKey("Home", false, 30, 60)).toBe(0);
    expect(seekTargetForKey("End", false, 30, 60)).toBe(59);
    expect(seekTargetForKey("Space", false, 30, 60)).toBeNull();
    expect(seekTargetForKey("ArrowRight", false, 0, 0)).toBeNull();
  });
});
