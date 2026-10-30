import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelMedia, ChannelState } from "@overlaysys/core";
import { useStore } from "./store";

const media = (over: Partial<ChannelMedia> = {}, updatedAt = 100): ChannelMedia => ({
  rowId: "r", assetUrl: "/a.mp4", volume: 1, endAction: "clear", mediaType: "video", fit: "contain", loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const, takenAt: 1, paused: false,
  playback: { status: "playing", currentTime: 5, duration: 60, updatedAt },
  ...over,
});
const state = (m?: ChannelMedia | null): ChannelState =>
  ({ channel: "program", media: m } as unknown as ChannelState);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  useStore.setState({ channelStates: {}, mediaHeardAt: {} });
});
afterEach(() => vi.useRealTimers());

const heard = () => useStore.getState().mediaHeardAt["program"];

describe("setChannelState media stamping", () => {
  it("stamps heardAt for new media", () => {
    useStore.getState().setChannelState(state(media()));
    expect(heard()).toBe(1_000);
  });

  it("does not stamp when only paused changed (same takenAt and updatedAt)", () => {
    useStore.getState().setChannelState(state(media()));
    vi.setSystemTime(5_000);
    useStore.getState().setChannelState(state(media({ paused: true })));
    expect(heard()).toBe(1_000);
  });

  it("stamps when playback.updatedAt is newer", () => {
    useStore.getState().setChannelState(state(media()));
    vi.setSystemTime(5_000);
    useStore.getState().setChannelState(state(media({}, 200)));
    expect(heard()).toBe(5_000);
  });

  it("stamps when takenAt changes", () => {
    useStore.getState().setChannelState(state(media()));
    vi.setSystemTime(5_000);
    useStore.getState().setChannelState(state(media({ takenAt: 2 })));
    expect(heard()).toBe(5_000);
  });
});

describe("applyMediaPlayback", () => {
  const pb = { status: "playing" as const, currentTime: 9, duration: 60, updatedAt: 300 };

  it("updates playback and stamps heardAt on matching takenAt", () => {
    useStore.getState().setChannelState(state(media()));
    vi.setSystemTime(7_000);
    useStore.getState().applyMediaPlayback("program", 1, pb);
    expect(useStore.getState().channelStates["program"]!.media!.playback).toEqual(pb);
    expect(heard()).toBe(7_000);
  });

  it("ignores a mismatched takenAt", () => {
    useStore.getState().setChannelState(state(media()));
    const before = useStore.getState();
    vi.setSystemTime(7_000);
    useStore.getState().applyMediaPlayback("program", 99, pb);
    expect(useStore.getState().channelStates).toBe(before.channelStates);
    expect(heard()).toBe(1_000);
  });

  it("ignores a channel with no media", () => {
    useStore.getState().setChannelState(state(null));
    useStore.getState().applyMediaPlayback("program", 1, pb);
    expect(useStore.getState().channelStates["program"]!.media).toBeNull();
    expect(heard()).toBeUndefined();
  });
});
