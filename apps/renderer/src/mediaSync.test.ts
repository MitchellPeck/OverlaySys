import { describe, expect, it } from "vitest";
import type { ChannelMedia } from "@overlaysys/core";
import {
  initialMountPlan,
  mediaElementProps,
  mirrorCorrection,
  pendingSeek,
  pickAudioSink,
  readSinkRequest,
  resolveMediaUrl,
} from "./mediaSync";

const base: ChannelMedia = {
  rowId: "r", assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear", mediaType: "video", fit: "contain", position: "center", loop: false, muted: false, transitionIn: { style: "fade", durationMs: 500 } as const, transitionOut: { style: "fade", durationMs: 500 } as const,
  takenAt: 100, paused: false,
  playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: 0 },
};

describe("resolveMediaUrl", () => {
  it("prefixes relative /assets paths with the ws server's http origin", () => {
    expect(resolveMediaUrl("/assets/a.mp4", "ws://10.0.0.5:4000/ws")).toBe("http://10.0.0.5:4000/assets/a.mp4");
    expect(resolveMediaUrl("/assets/a.mp4", "wss://h.example/ws")).toBe("https://h.example/assets/a.mp4");
  });
  it("prefixes live-folder /media-folders paths the same way", () => {
    expect(resolveMediaUrl("/media-folders/lf1/a%20b.png", "ws://10.0.0.5:4000/ws")).toBe(
      "http://10.0.0.5:4000/media-folders/lf1/a%20b.png",
    );
  });
  it("leaves absolute urls alone", () => {
    expect(resolveMediaUrl("https://cdn/x.mp4", "ws://h:4000/ws")).toBe("https://cdn/x.mp4");
  });
});

describe("mediaElementProps", () => {
  it("renders a photo as a see-through image with its fit and position", () => {
    expect(mediaElementProps({ ...base, mediaType: "image", fit: "cover" }, false)).toEqual({
      element: "img", objectFit: "cover", objectPosition: "50% 50%", background: "transparent", loop: false, muted: false,
    });
    expect(mediaElementProps({ ...base, mediaType: "image", fit: "scale-down", position: "bottom" }, false)).toMatchObject({
      objectFit: "scale-down", objectPosition: "50% 100%", background: "transparent",
    });
  });
  it("a video plays its audio, fits contain on black, and does not loop by default", () => {
    expect(mediaElementProps(base, false)).toEqual({
      element: "video", objectFit: "contain", objectPosition: "50% 50%", background: "#000", loop: false, muted: false,
    });
  });
  it("carries loop, muted, fill and position onto the video", () => {
    expect(mediaElementProps({ ...base, loop: true, muted: true, fit: "fill", position: "top-left" }, false)).toEqual({
      element: "video", objectFit: "fill", objectPosition: "0% 0%", background: "#000", loop: true, muted: true,
    });
  });
  it("a mirror window is always muted", () => {
    expect(mediaElementProps(base, true).muted).toBe(true);
  });
});

describe("pickAudioSink", () => {
  const devices = [
    { deviceId: "default", label: "Default", kind: "audiooutput" },
    { deviceId: "abc", label: "Aux (USB Audio)", kind: "audiooutput" },
    { deviceId: "mic1", label: "Aux (USB Audio)", kind: "audioinput" },
  ];
  it("returns default when nothing requested", () => {
    expect(pickAudioSink(devices, {})).toEqual({ deviceId: null });
  });
  it("matches by id", () => {
    expect(pickAudioSink(devices, { id: "abc", label: "whatever" })).toEqual({ deviceId: "abc" });
  });
  it("falls back to label among outputs only", () => {
    expect(pickAudioSink(devices, { id: "stale", label: "Aux (USB Audio)" })).toEqual({ deviceId: "abc" });
  });
  it("falls back to default with a warning when missing", () => {
    const r = pickAudioSink(devices, { id: "gone", label: "Focusrite" });
    expect(r.deviceId).toBeNull();
    expect(r.warning).toBe("audio device 'Focusrite' not found — using default");
  });
});

describe("readSinkRequest", () => {
  it("reads both params", () => {
    expect(readSinkRequest("?channel=program&audioSinkId=abc&audioSinkLabel=Aux%201")).toEqual({ id: "abc", label: "Aux 1" });
  });
  it("is empty without params", () => {
    expect(readSinkRequest("?channel=program")).toEqual({});
  });
});

describe("initialMountPlan", () => {
  it("starts at 0 on a fresh take", () => {
    expect(initialMountPlan(base)).toEqual({ startAt: 0, applied: { takenAt: 100, seq: 0 } });
  });
  it("resumes from last reported time and marks existing seek as applied", () => {
    const m = { ...base, seek: { time: 10, seq: 2 }, playback: { ...base.playback, status: "playing" as const, currentTime: 95 } };
    expect(initialMountPlan(m)).toEqual({ startAt: 95, applied: { takenAt: 100, seq: 2 } });
  });
});

describe("pendingSeek", () => {
  it("returns the time for an unseen seq", () => {
    expect(pendingSeek({ ...base, seek: { time: 30, seq: 1 } }, { takenAt: 100, seq: 0 })).toBe(30);
  });
  it("returns null when already applied or none", () => {
    expect(pendingSeek({ ...base, seek: { time: 30, seq: 1 } }, { takenAt: 100, seq: 1 })).toBeNull();
    expect(pendingSeek(base, { takenAt: 100, seq: 0 })).toBeNull();
  });
  it("treats a different takenAt as unapplied", () => {
    expect(pendingSeek({ ...base, seek: { time: 0, seq: 1 } }, { takenAt: 99, seq: 5 })).toBe(0);
  });
});

describe("mirrorCorrection", () => {
  const playing = (currentTime: number, updatedAt: number) => ({
    status: "playing" as const,
    currentTime,
    duration: 60,
    updatedAt,
  });
  it("leaves an in-sync mirror alone", () => {
    expect(mirrorCorrection(10.51, playing(10, 1000), 1500)).toEqual({ action: "none" });
  });
  it("slows a mirror that is ahead by more than a frame", () => {
    const fix = mirrorCorrection(10.6, playing(10, 1000), 1500);
    expect(fix.action).toBe("rate");
    expect(fix.action === "rate" && fix.rate).toBeLessThan(1);
  });
  it("speeds up a mirror that is behind", () => {
    const fix = mirrorCorrection(10.4, playing(10, 1000), 1500);
    expect(fix.action === "rate" && fix.rate).toBeGreaterThan(1);
  });
  it("seeks when more than 200 ms off", () => {
    expect(mirrorCorrection(12, playing(10, 1000), 1500)).toEqual({ action: "seek", time: 10.5 });
  });
  it("does nothing while the primary isn't playing", () => {
    expect(mirrorCorrection(3, { ...playing(10, 1000), status: "paused" }, 1500)).toEqual({ action: "none" });
  });
});
