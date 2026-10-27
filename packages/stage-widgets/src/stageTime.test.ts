import { describe, expect, it } from "vitest";
import type { StageServiceView, StageTimer } from "@overlaysys/core";
import { formatClockDisplay, formatRemaining, pickStageTimer, serverOffset, serviceProgressText, stageTimerView, timerDisplay, videoRemainingSec } from "./stageTime";

describe("serviceProgressText", () => {
  const NOW = new Date(2026, 9, 27, 10, 0, 0).getTime();
  const view: StageServiceView = {
    source: "pco",
    planTitle: "Sunday",
    itemIndex: 2,
    itemCount: 3,
    current: { id: "b", title: "B", startedAt: NOW - 100_000, lengthSec: 600 },
    next: { title: "C" },
    laterLengthSec: 900,
    plannedEndAt: new Date(2026, 9, 27, 10, 20, 0).getTime(),
    status: "live",
  };
  const all = { showPosition: true, showEnd: true, showDelta: true };

  it("joins position, end and delta", () => {
    expect(serviceProgressText(view, NOW, all)).toBe("Item 2 of 3 · Ends 10:20 AM · 3 min over");
    expect(serviceProgressText(view, NOW, all, "24h")).toBe("Item 2 of 3 · Ends 10:20 · 3 min over");
  });

  it("drops parts", () => {
    expect(serviceProgressText(view, NOW, { ...all, showDelta: false })).toBe("Item 2 of 3 · Ends 10:20 AM");
    expect(serviceProgressText({ ...view, plannedEndAt: undefined }, NOW, all)).toBe("Item 2 of 3");
  });

  it("reports under and on time", () => {
    const only = { showPosition: false, showEnd: false, showDelta: true };
    expect(serviceProgressText({ ...view, laterLengthSec: 580 }, NOW, only)).toBe("2 min under");
    expect(serviceProgressText({ ...view, laterLengthSec: 700 }, NOW, only)).toBe("On time");
  });

  it("handles non-live statuses", () => {
    expect(serviceProgressText({ ...view, status: "notStarted", current: null }, NOW, all)).toBe("Service not started");
    expect(serviceProgressText({ ...view, status: "ended", current: null }, NOW, all)).toBe("Service ended");
    expect(serviceProgressText({ ...view, status: "error" }, NOW, all)).toBe("");
  });
});

describe("stageTime", () => {
  it("serverOffset is server minus local", () => {
    expect(serverOffset(1500, 1000)).toBe(500);
  });

  it("formats a 12h and 24h clock", () => {
    const ms = new Date(2026, 0, 1, 15, 7, 9).getTime();
    expect(formatClockDisplay(ms, "12h", false)).toBe("3:07 PM");
    expect(formatClockDisplay(ms, "12h", true)).toBe("3:07:09 PM");
    expect(formatClockDisplay(ms, "24h", false)).toBe("15:07");
    const midnight = new Date(2026, 0, 1, 0, 5, 0).getTime();
    expect(formatClockDisplay(midnight, "12h", false)).toBe("12:05 AM");
  });

  it("ticks a countdown and freezes a paused one", () => {
    const running = { id: "t", source: "graphic" as const, overtime: false, running: true, label: "x", channel: "c", mode: "countdown" as const, value: "65000" };
    expect(timerDisplay(running, 5000)).toBe("01:00");
    const paused = { ...running, value: JSON.stringify({ a: 65000, p: 35000 }), format: "M:SS" as const };
    expect(timerDisplay(paused, 60000)).toBe("0:30");
  });

  it("interpolates playing video and freezes paused video", () => {
    const v = { status: "playing" as const, currentTime: 10, duration: 70, at: 1000 };
    expect(videoRemainingSec(v, 3000)).toBe(58);
    expect(videoRemainingSec({ ...v, status: "paused" }, 3000)).toBe(60);
    expect(videoRemainingSec(v, 999_999)).toBe(0);
  });

  it("formats remaining time", () => {
    expect(formatRemaining(59.4)).toBe("0:59");
    expect(formatRemaining(61)).toBe("1:01");
    expect(formatRemaining(3725)).toBe("1:02:05");
  });

  describe("stageTimerView / pickStageTimer", () => {
    const base: StageTimer = { id: "t", source: "manual", overtime: true, running: true, label: "x", mode: "countdown", value: "100000" };

    it("shows +MM:SS and over phase past the anchor with overtime", () => {
      expect(stageTimerView(base, 183_000, 60)).toEqual({ text: "+01:23", phase: "over" });
    });
    it("clamps to zero and warns without overtime", () => {
      expect(stageTimerView({ ...base, overtime: false }, 183_000, 60)).toEqual({ text: "00:00", phase: "warn" });
    });
    it("warns below the threshold", () => {
      expect(stageTimerView(base, 70_000, 60).phase).toBe("warn");
      expect(stageTimerView(base, 10_000, 60).phase).toBe("normal");
    });
    it("a paused timer stays frozen", () => {
      const paused = { ...base, running: false, value: JSON.stringify({ a: 100000, p: 90000 }) };
      expect(stageTimerView(paused, 9_999_999, 5).text).toBe("00:10");
    });

    const item = { ...base, id: "current-item", source: "item" as const };
    const g1 = { ...base, id: "g1", source: "graphic" as const, channel: "a" };
    const g2 = { ...base, id: "g2", source: "graphic" as const, channel: "b" };
    it("picks by source", () => {
      const all = [item, g1, g2];
      expect(pickStageTimer(all, "firstActive")).toBe(item);
      expect(pickStageTimer(all, "currentItem")).toBe(item);
      expect(pickStageTimer([g1, g2], "currentItem")).toBeUndefined();
      expect(pickStageTimer(all, { channel: "b" })).toBe(g2);
      expect(pickStageTimer(all, { timerId: "g1" })).toBe(g1);
    });
    it("firstActive picks the first running timer, else the first", () => {
      const stopped = { ...base, id: "m", running: false };
      expect(pickStageTimer([stopped, item, g1], "firstActive")).toBe(item);
      const stopped2 = { ...g1, running: false };
      expect(pickStageTimer([stopped, stopped2], "firstActive")).toBe(stopped);
      expect(pickStageTimer([], "firstActive")).toBeUndefined();
    });
    it("a timerId that no longer exists falls back to firstActive", () => {
      const stopped = { ...base, id: "m", running: false };
      expect(pickStageTimer([stopped, g1], { timerId: "gone" })).toBe(g1);
      expect(pickStageTimer([], { timerId: "gone" })).toBeUndefined();
    });
  });
});
