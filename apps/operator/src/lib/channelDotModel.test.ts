import { describe, it, expect } from "vitest";
import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { channelDotModel, rendererBaseFor, rendererHref } from "./channelDotModel";

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
        rowId: "v", assetUrl: "/a.mp4", volume: 1, endAction: "hold", mediaType: "video", fit: "contain", position: "center", loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
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
        rowId: "v", assetUrl: "/a.mp4", volume: 1, endAction: "hold", mediaType: "video", fit: "contain", position: "center", loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
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

describe("output presence", () => {
  const presence = (count: number) => ({ count, lastSeen: 1, labels: ["OBS"] });
  it("is unknown until outputs_state arrives", () => {
    expect(channelDotModel(cfg("program"), {})).toMatchObject({ presence: "unknown", outputCount: null });
  });
  it("connected / idle / missing", () => {
    expect(channelDotModel(cfg("program"), {}, { program: presence(1) }).presence).toBe("connected");
    expect(channelDotModel(cfg("program"), {}, {}).presence).toBe("idle");
    expect(channelDotModel(cfg("program"), { program: on("program") }, {}).presence).toBe("missing");
  });
  it("a mirror counts its own windows, not its source's", () => {
    const m = channelDotModel(cfg("key", { mirrorOf: "program" }), { program: on("program") }, { program: presence(1) });
    expect(m).toMatchObject({ outputCount: 0, presence: "missing" });
  });
});

describe("rendererBaseFor", () => {
  it("same origin when the server serves the operator", () => {
    expect(rendererBaseFor({ protocol: "http:", hostname: "10.0.0.5", host: "10.0.0.5:4123", pathname: "/operator/live/" })).toBe(
      "http://10.0.0.5:4123/renderer",
    );
  });
  it("dev: Vite renderer on :3001 of the operator's host", () => {
    expect(rendererBaseFor({ protocol: "http:", hostname: "studio.local", host: "studio.local:3000", pathname: "/" })).toBe(
      "http://studio.local:3001",
    );
  });
  it("builds the channel link", () => {
    expect(rendererHref("http://h:4000/renderer/", "alpha prog")).toBe("http://h:4000/renderer/?channel=alpha%20prog");
  });
});

describe("channelDotModel blanked", () => {
  const song = (blanked: boolean) =>
    ({ channel: "program", active: null, songSession: { songId: "s", lyricTemplateId: "l", arrangement: [], cursor: { sectionIdx: 0, slideIdx: 0 }, blanked, trustMode: false, startedAt: 1 } }) as ChannelState;
  it("a blanked program song is amber", () => {
    expect(channelDotModel(cfg("program"), { program: song(true) }).tone).toBe("blanked");
  });
  it("an unblanked song session does not change the tone", () => {
    expect(channelDotModel(cfg("program"), { program: song(false) }).tone).toBe("dim");
  });
});
