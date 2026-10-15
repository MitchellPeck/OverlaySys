import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelState } from "@overlaysys/core";
import * as channels from "./channels";
import * as templates from "./templates";

// Each test uses its own channel name so module-level state can't leak.
let n = 0;
let ch = "";
let states: ChannelState[] = [];
let ticks: channels.MediaPlaybackEvent[] = [];
let unsubs: (() => void)[] = [];

const ARGS: channels.MediaTakeArgs = {
  rowId: "row-1",
  assetUrl: "/assets/give.mp4",
  label: "Giving",
  volume: 1,
  endAction: "clear",
};

function media() {
  return channels.getState(ch).media ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  ch = `media-test-${++n}`;
  states = [];
  ticks = [];
  unsubs = [
    channels.subscribe(ch, (s) => states.push(structuredClone(s))),
    channels.subscribeMediaPlayback(ch, (e) => ticks.push(e)),
  ];
  states = []; // drop the immediate push from subscribe()
});
afterEach(() => {
  for (const u of unsubs) u();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mediaTake", () => {
  it("installs a loading media slot and emits state", () => {
    channels.mediaTake(ch, ARGS, 1000);
    expect(media()).toMatchObject({
      rowId: "row-1", assetUrl: "/assets/give.mp4", label: "Giving",
      volume: 1, endAction: "clear", takenAt: 1000, paused: false,
      playback: { status: "loading", currentTime: 0, duration: 0 },
    });
    expect(states).toHaveLength(1);
  });

  it("gives strictly increasing takenAt for takes in the same ms", () => {
    channels.mediaTake(ch, ARGS, 1000);
    channels.mediaTake(ch, ARGS, 1000);
    expect(media()?.takenAt).toBe(1001);
  });

  it("does not touch the active graphic", () => {
    channels.take(ch, "lower-third", { name: "x" });
    channels.mediaTake(ch, ARGS, 1000);
    expect(channels.getState(ch).active?.templateId).toBe("lower-third");
  });
});

describe("graphic operations leave media alone", () => {
  it("take, update, clear and setActiveNull preserve media", () => {
    channels.mediaTake(ch, ARGS, 1000);
    channels.take(ch, "lower-third", {});
    channels.update(ch, { a: "b" });
    channels.clear(ch);
    vi.advanceTimersByTime(2000);
    channels.setActiveNull(ch);
    expect(media()?.takenAt).toBe(1000);
  });
});

describe("mediaClear", () => {
  it("nulls media, keeps active, emits once", () => {
    channels.take(ch, "lower-third", {});
    channels.mediaTake(ch, ARGS, 1000);
    states = [];
    channels.mediaClear(ch);
    expect(media()).toBeNull();
    expect(channels.getState(ch).active?.templateId).toBe("lower-third");
    expect(states).toHaveLength(1);
  });

  it("is a no-op without media", () => {
    channels.mediaClear(ch);
    expect(states).toHaveLength(0);
  });
});

describe("mediaControl", () => {
  beforeEach(() => channels.mediaTake(ch, ARGS, 1000));

  it("ignores a stale takenAt", () => {
    states = [];
    channels.mediaControl(ch, 999, "pause");
    expect(media()?.paused).toBe(false);
    expect(states).toHaveLength(0);
  });

  it("pause / play toggle paused", () => {
    channels.mediaControl(ch, 1000, "pause");
    expect(media()?.paused).toBe(true);
    channels.mediaControl(ch, 1000, "play");
    expect(media()?.paused).toBe(false);
    expect(media()?.seek).toBeUndefined();
  });

  it("restart seeks to 0, unpauses and bumps seq", () => {
    channels.mediaControl(ch, 1000, "pause");
    channels.mediaControl(ch, 1000, "restart");
    expect(media()).toMatchObject({ paused: false, seek: { time: 0, seq: 1 } });
    channels.mediaControl(ch, 1000, "restart");
    expect(media()?.seek?.seq).toBe(2);
  });

  it("seek sets time (clamped at 0) and bumps seq; seek without time is ignored", () => {
    channels.mediaControl(ch, 1000, "seek", 42);
    expect(media()?.seek).toEqual({ time: 42, seq: 1 });
    channels.mediaControl(ch, 1000, "seek");
    expect(media()?.seek).toEqual({ time: 42, seq: 1 });
  });
});

describe("mediaStatus", () => {
  beforeEach(() => channels.mediaTake(ch, ARGS, 1000));

  it("emits state on status transitions and ticks otherwise", () => {
    states = [];
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0, duration: 300 }, 2000);
    expect(states).toHaveLength(1);
    expect(media()?.playback).toMatchObject({ status: "playing", duration: 300, updatedAt: 2000 });

    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0.25, duration: 300 }, 2250);
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0.5, duration: 300 }, 2500);
    expect(states).toHaveLength(1);
    expect(ticks.map((t) => t.playback.currentTime)).toEqual([0.25, 0.5]);
    expect(ticks[0]).toMatchObject({ channel: ch, takenAt: 1000 });
    expect(media()?.playback.currentTime).toBe(0.5);
  });

  it("emits state when an error appears", () => {
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0, duration: 300 }, 2000);
    states = [];
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 1, duration: 300, error: "audio device 'Aux' not found — using default" }, 3000);
    expect(states).toHaveLength(1);
    expect(media()?.playback.error).toContain("Aux");
  });

  it("ignores a stale takenAt", () => {
    channels.mediaStatus(ch, 999, { status: "playing", currentTime: 5, duration: 300 }, 2000);
    expect(media()?.playback.status).toBe("loading");
  });

  it("ended + clear removes media", () => {
    channels.mediaStatus(ch, 1000, { status: "ended", currentTime: 300, duration: 300 }, 2000);
    expect(media()).toBeNull();
  });

  it("ended + hold keeps media, pauses it; play then seeks to 0", () => {
    channels.mediaTake(ch, { ...ARGS, endAction: "hold" }, 5000);
    channels.mediaStatus(ch, 5000, { status: "ended", currentTime: 300, duration: 300 }, 6000);
    expect(media()).toMatchObject({ paused: true, playback: { status: "ended" } });
    channels.mediaControl(ch, 5000, "play");
    expect(media()).toMatchObject({ paused: false, seek: { time: 0, seq: 1 } });
  });

  it("a stale ended after re-take does not clear the new take", () => {
    channels.mediaTake(ch, ARGS, 1000); // same ms → takenAt 1001
    channels.mediaStatus(ch, 1000, { status: "ended", currentTime: 300, duration: 300 }, 2000);
    expect(media()?.takenAt).toBe(1001);
  });
});

describe("takePvwToPgm", () => {
  it("does not promote media", () => {
    const pvw = `${ch}-pvw`;
    channels.mediaTake(pvw, ARGS, 1000);
    channels.take(pvw, "lower-third", {});
    channels.takePvwToPgm(pvw, ch);
    expect(channels.getState(ch).media ?? null).toBeNull();
  });
});
