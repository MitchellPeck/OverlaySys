import { describe, expect, it } from "vitest";
import type { StageTimer } from "@overlaysys/core";
import { formatClockDisplay, formatRemaining, pickStageTimer, serverOffset, stageTimerView, timerDisplay, videoRemainingSec } from "./stageTime";

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
  });
});
