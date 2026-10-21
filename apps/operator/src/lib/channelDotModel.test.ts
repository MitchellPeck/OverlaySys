import { describe, it, expect } from "vitest";
import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { channelDotModel } from "./channelDotModel";

const cfg = (id: string, extra: Partial<ChannelConfig> = {}) =>
  ({ id, name: id, renderMode: "normal", ...extra }) as ChannelConfig;
const on = (channel: string): ChannelState => ({
  channel,
  active: { templateId: "t", data: {}, phase: "on", takenAt: 1 },
});

describe("channelDotModel", () => {
  it("program with content is live (red)", () => {
    expect(channelDotModel(cfg("program"), { program: on("program") })).toMatchObject({ tone: "live", busy: true, canClear: true });
  });

  it("other channels with content are good (green)", () => {
    expect(channelDotModel(cfg("stage"), { stage: on("stage") }).tone).toBe("good");
  });

  it("an empty channel is dim and cannot be cleared", () => {
    expect(channelDotModel(cfg("preview"), {})).toMatchObject({ tone: "dim", busy: false, canClear: false });
  });

  it("media alone counts as busy", () => {
    const st: ChannelState = {
      channel: "program",
      active: null,
      media: {
        rowId: "v", assetUrl: "/a.mp4", volume: 1, endAction: "hold", transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
        playback: { status: "playing", currentTime: 0, duration: 1, updatedAt: 1 },
      },
    };
    expect(channelDotModel(cfg("program"), { program: st }).busy).toBe(true);
  });

  it("a media-only channel is busy but cannot be cleared (clear does not stop video)", () => {
    const st: ChannelState = {
      channel: "stage",
      active: null,
      media: {
        rowId: "v", assetUrl: "/a.mp4", volume: 1, endAction: "hold", transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
        playback: { status: "playing", currentTime: 0, duration: 1, updatedAt: 1 },
      },
    };
    expect(channelDotModel(cfg("stage"), { stage: st })).toMatchObject({ busy: true, canClear: false, tone: "good" });
  });

  it("a mirror reflects its source's state but never offers Clear", () => {
    const m = channelDotModel(cfg("key", { mirrorOf: "program" }), { program: on("program") });
    expect(m).toMatchObject({ sourceId: "program", busy: true, canClear: false, tone: "good" });
  });
});
