import { describe, expect, it } from "vitest";
import type { ChannelMedia } from "@overlaysys/core";
import { displayStatus, displayTime, NO_RENDERER_MS, remainingTone } from "./mediaTime";

const m = (over: Partial<ChannelMedia["playback"]> = {}, rest: Partial<ChannelMedia> = {}): ChannelMedia => ({
  rowId: "r", assetUrl: "/a.mp4", volume: 1, endAction: "clear", transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
  playback: { status: "playing", currentTime: 10, duration: 300, updatedAt: 999_999, ...over },
  ...rest,
});

describe("displayTime", () => {
  it("interpolates from LOCAL receive time while playing (ignores server clock)", () => {
    const t = displayTime(m(), 5_000, 5_500);
    expect(t.elapsed).toBeCloseTo(10.5);
    expect(t.remaining).toBeCloseTo(289.5);
    expect(t.fraction).toBeCloseTo(10.5 / 300);
  });

  it("does not interpolate when paused", () => {
    expect(displayTime(m({ status: "paused" }), 5_000, 9_000).elapsed).toBe(10);
  });

  it("caps interpolation at one second past the last report and at duration", () => {
    expect(displayTime(m(), 5_000, 20_000).elapsed).toBe(11);
    expect(displayTime(m({ currentTime: 299.8 }), 5_000, 6_000).elapsed).toBe(300);
  });

  it("handles unknown duration", () => {
    const t = displayTime(m({ duration: 0, status: "loading", currentTime: 0 }), 0, 0);
    expect(t).toEqual({ elapsed: 0, remaining: 0, fraction: 0 });
  });
});

describe("displayStatus", () => {
  it("passes through a fresh status", () => {
    expect(displayStatus(m(), 5_000, 5_100)).toBe("playing");
    expect(displayStatus(m({ status: "paused" }), 5_000, 60_000)).toBe("paused");
  });

  it("flags no-renderer when playing/loading goes quiet", () => {
    expect(displayStatus(m(), 5_000, 5_000 + NO_RENDERER_MS + 1)).toBe("no-renderer");
    expect(displayStatus(m({ status: "loading" }), 5_000, 5_000 + NO_RENDERER_MS + 1)).toBe("no-renderer");
  });

  it("keeps error visible", () => {
    expect(displayStatus(m({ status: "error", error: "x" }), 0, 99_999)).toBe("error");
  });
});

describe("remainingTone", () => {
  it("warns in the last 15 s and goes urgent in the last 5 s", () => {
    expect(remainingTone(120, 300)).toBe("normal");
    expect(remainingTone(15.1, 300)).toBe("normal");
    expect(remainingTone(15, 300)).toBe("warn");
    expect(remainingTone(5.1, 300)).toBe("warn");
    expect(remainingTone(5, 300)).toBe("urgent");
    expect(remainingTone(0.2, 300)).toBe("urgent");
  });

  it("stays normal while the duration is unknown", () => {
    expect(remainingTone(0, 0)).toBe("normal");
  });
});
