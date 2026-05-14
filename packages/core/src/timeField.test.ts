import { describe, expect, it } from "vitest";
import { computeTimeDisplay, formatTime, parseDuration } from "./timeField";
import type { Field } from "./template";

describe("formatTime", () => {
  it("clamps negatives to zero", () => {
    expect(formatTime(-5000, "MM:SS")).toBe("00:00");
  });

  it("renders MM:SS for sub-hour durations", () => {
    expect(formatTime(90_000, "MM:SS")).toBe("01:30");
    expect(formatTime(0, "MM:SS")).toBe("00:00");
  });

  it("rolls minutes past 99 for very long MM:SS", () => {
    // 90 minutes in MM:SS — author's choice to use that format is a hint
    // they expect short durations, but don't drop information silently.
    expect(formatTime(90 * 60_000, "MM:SS")).toBe("90:00");
  });

  it("M:SS trims the leading zero on minutes", () => {
    expect(formatTime(5_000, "M:SS")).toBe("0:05");
    expect(formatTime(90_000, "M:SS")).toBe("1:30");
  });

  it("HH:MM:SS pads all three components", () => {
    expect(formatTime(3_601_000, "HH:MM:SS")).toBe("01:00:01");
  });

  it("H:MM:SS trims hours leading zero", () => {
    expect(formatTime(3_601_000, "H:MM:SS")).toBe("1:00:01");
  });

  it("HH:MM and H:MM drop seconds", () => {
    expect(formatTime(3_660_000, "HH:MM")).toBe("01:01");
    expect(formatTime(3_660_000, "H:MM")).toBe("1:01");
  });

  it("floors sub-second remainders", () => {
    expect(formatTime(1_999, "MM:SS")).toBe("00:01");
  });
});

describe("parseDuration", () => {
  it("treats a single token as seconds", () => {
    expect(parseDuration("90")).toBe(90_000);
  });

  it("two tokens = MM:SS", () => {
    expect(parseDuration("10:00")).toBe(600_000);
    expect(parseDuration("1:30")).toBe(90_000);
  });

  it("three tokens = HH:MM:SS", () => {
    expect(parseDuration("1:00:00")).toBe(3_600_000);
    expect(parseDuration("0:01:30")).toBe(90_000);
  });

  it("returns null for empty / non-numeric / four-part input", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
    expect(parseDuration("-1:00")).toBeNull();
  });

  it("tolerates whitespace around tokens", () => {
    expect(parseDuration("  10 : 00  ")).toBe(600_000);
  });

  it("rounds sub-second decimal inputs", () => {
    expect(parseDuration("1.5")).toBe(1_500);
  });
});

describe("computeTimeDisplay", () => {
  const NOW = 1_700_000_000_000;

  const field = (mode: "countdown" | "countup" | "clock"): Field => ({
    key: "t",
    label: "T",
    type: "time",
    timeMode: mode,
    timeFormat: "MM:SS",
  });

  it("countdown subtracts now from anchor", () => {
    const f = field("countdown");
    expect(computeTimeDisplay(f, String(NOW + 90_000), NOW)).toBe("01:30");
  });

  it("countdown clamps past zero", () => {
    const f = field("countdown");
    expect(computeTimeDisplay(f, String(NOW - 5_000), NOW)).toBe("00:00");
  });

  it("countup elapses from anchor", () => {
    const f = field("countup");
    expect(computeTimeDisplay(f, String(NOW - 65_000), NOW)).toBe("01:05");
  });

  it("countup clamps if anchor is in the future", () => {
    const f = field("countup");
    expect(computeTimeDisplay(f, String(NOW + 5_000), NOW)).toBe("00:00");
  });

  it("clock reads now and ignores anchor", () => {
    const f: Field = { ...field("clock"), timeFormat: "HH:MM:SS" };
    // 2023-11-14 22:13:20 UTC → varies by TZ, so just assert the shape.
    expect(computeTimeDisplay(f, undefined, NOW)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("falls back to zero display when anchor is unparseable", () => {
    const f = field("countdown");
    expect(computeTimeDisplay(f, "not-a-number", NOW)).toBe("00:00");
    expect(computeTimeDisplay(f, undefined, NOW)).toBe("00:00");
  });

  it("uses MM:SS / countdown defaults when timeMode/timeFormat are absent", () => {
    const f: Field = { key: "t", label: "T", type: "time" };
    expect(computeTimeDisplay(f, String(NOW + 90_000), NOW)).toBe("01:30");
  });
});
