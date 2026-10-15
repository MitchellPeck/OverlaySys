import { describe, expect, it } from "vitest";
import type { ChannelMedia, ChannelState, VideoRow } from "@overlaysys/core";
import { onAirMediaFor } from "./mediaTake";

const row = (over: Partial<VideoRow> = {}): VideoRow => ({
  kind: "video", id: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "clear", ...over,
});
const media = (status: ChannelMedia["playback"]["status"], rowId = "v1"): ChannelMedia => ({
  rowId, assetUrl: "/a.mp4", volume: 1, endAction: "clear", takenAt: 1, paused: false,
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
