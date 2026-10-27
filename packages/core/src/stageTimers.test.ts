import { describe, expect, it } from "vitest";
import {
  reduceTimers,
  stageTimerValue,
  timerMs,
  timerPhase,
  type StageTimerInstance,
  type TimerAction,
} from "./stageTimers";
import { decodeTimerValue } from "./timeField";

const NOW = 1_000_000;

function mk(
  t: StageTimerInstance[],
  id: string,
  mode: "countdown" | "countup",
  durationMs?: number,
): StageTimerInstance[] {
  return reduceTimers(t, { type: "create", id, label: "x", mode, durationMs, overtime: false }, NOW);
}

describe("reduceTimers", () => {
  it("create then start a countdown", () => {
    let t = reduceTimers(
      [],
      { type: "create", id: "a", label: " Sermon ", mode: "countdown", durationMs: 600_000, overtime: true },
      NOW,
    );
    expect(t[0]).toMatchObject({ id: "a", label: "Sermon", anchor: null, source: "manual" });
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    expect(t[0]!.anchor).toBe(NOW + 600_000);
  });

  it("clamps duration to [0, 24h]", () => {
    const t = reduceTimers(
      [],
      { type: "create", id: "a", label: "x", mode: "countdown", durationMs: 9e12, overtime: false },
      NOW,
    );
    expect(t[0]!.durationMs).toBe(86_400_000);
    const neg = mk([], "b", "countdown", -5);
    expect(neg[0]!.durationMs).toBe(0);
  });

  it("falls back to 'Timer' for an empty label and truncates to 60", () => {
    const a = reduceTimers([], { type: "create", id: "a", label: "   ", mode: "countup", overtime: false }, NOW);
    expect(a[0]!.label).toBe("Timer");
    const b = reduceTimers([], { type: "create", id: "b", label: "y".repeat(100), mode: "countup", overtime: false }, NOW);
    expect(b[0]!.label).toHaveLength(60);
  });

  it("ignores a duplicate id", () => {
    const t = mk([], "a", "countup");
    expect(mk(t, "a", "countup")).toBe(t);
  });

  it("adjust below zero on a not-started countdown floors at 0", () => {
    let t = mk([], "a", "countdown", 30_000);
    t = reduceTimers(t, { type: "adjust", id: "a", deltaMs: -60_000 }, NOW);
    expect(t[0]!.durationMs).toBe(0);
    expect(Number.isNaN(timerMs(t[0]!, NOW))).toBe(false);
  });

  it("pause/resume shifts the anchor by the paused span", () => {
    let t = mk([], "a", "countdown", 60_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    t = reduceTimers(t, { type: "pause", id: "a" }, NOW + 10_000);
    expect(timerMs(t[0]!, NOW + 99_000)).toBe(50_000);
    t = reduceTimers(t, { type: "resume", id: "a" }, NOW + 20_000);
    expect(t[0]!.anchor).toBe(NOW + 70_000);
    expect(t[0]!.pausedAt).toBeUndefined();
  });

  it("start on a paused timer resumes; on a running timer is unchanged", () => {
    let t = mk([], "a", "countdown", 60_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    expect(reduceTimers(t, { type: "start", id: "a" }, NOW + 5_000)).toBe(t);
    t = reduceTimers(t, { type: "pause", id: "a" }, NOW + 10_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW + 20_000);
    expect(t[0]!.anchor).toBe(NOW + 70_000);
    expect(t[0]!.pausedAt).toBeUndefined();
  });

  it("adjust on a paused countdown changes remaining", () => {
    let t = mk([], "a", "countdown", 60_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    t = reduceTimers(t, { type: "pause", id: "a" }, NOW + 10_000);
    t = reduceTimers(t, { type: "adjust", id: "a", deltaMs: 60_000 }, NOW + 11_000);
    expect(timerMs(t[0]!, NOW + 50_000)).toBe(110_000);
  });

  it("reset keeps a running timer running from full and stops a paused one", () => {
    let t = mk([], "a", "countdown", 60_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    const running = reduceTimers(t, { type: "reset", id: "a" }, NOW + 30_000);
    expect(running[0]!.anchor).toBe(NOW + 30_000 + 60_000);
    expect(running[0]!.pausedAt).toBeUndefined();
    const paused = reduceTimers(t, { type: "pause", id: "a" }, NOW + 10_000);
    const stopped = reduceTimers(paused, { type: "reset", id: "a" }, NOW + 20_000);
    expect(stopped[0]!.anchor).toBeNull();
    expect(stopped[0]!.pausedAt).toBeUndefined();
    let up = mk([], "u", "countup");
    up = reduceTimers(up, { type: "start", id: "u" }, NOW);
    expect(reduceTimers(up, { type: "reset", id: "u" }, NOW + 9_000)[0]!.anchor).toBe(NOW + 9_000);
  });

  it("countup adjust never moves anchor after now", () => {
    let t = mk([], "u", "countup");
    t = reduceTimers(t, { type: "start", id: "u" }, NOW + 1_000);
    t = reduceTimers(t, { type: "adjust", id: "u", deltaMs: 5_000 }, NOW + 1_000);
    expect(t[0]!.anchor).toBe(NOW - 4_000);
    t = reduceTimers(t, { type: "adjust", id: "u", deltaMs: -10_000 }, NOW + 1_000);
    expect(t[0]!.anchor).toBe(NOW + 1_000);
  });

  it("refuses a 21st manual timer", () => {
    let t: StageTimerInstance[] = [];
    for (let i = 0; i < 20; i++) t = mk(t, `t${i}`, "countup");
    expect(t).toHaveLength(20);
    expect(mk(t, "extra", "countup")).toHaveLength(20);
  });

  it("delete removes by id, including the item timer", () => {
    let t = mk([], "m", "countup");
    t = reduceTimers(t, { type: "setItem", label: "W", anchor: NOW, overtime: false, source: "item", rowId: "r" }, NOW);
    t = reduceTimers(t, { type: "delete", id: "current-item" }, NOW);
    expect(t.map((x) => x.id)).toEqual(["m"]);
  });

  it("setItem replaces in place and keeps a single item timer", () => {
    let t = mk([], "m", "countup");
    t = reduceTimers(
      t,
      { type: "setItem", label: "Welcome", anchor: NOW + 300_000, durationMs: 300_000, overtime: true, source: "item", rowId: "r1" },
      NOW,
    );
    t = reduceTimers(
      t,
      { type: "setItem", label: "Sermon", anchor: NOW + 900_000, durationMs: 900_000, overtime: true, source: "item", rowId: "r2" },
      NOW,
    );
    expect(t.map((x) => x.id)).toEqual(["current-item", "m"]);
    expect(t[0]).toMatchObject({ label: "Sermon", rowId: "r2", mode: "countdown", source: "item" });
  });

  it("setItem clamps a huge duration", () => {
    const t = reduceTimers(
      [],
      { type: "setItem", label: "W", anchor: NOW, durationMs: 9e12, overtime: true, source: "pco", rowId: "r" },
      NOW,
    );
    expect(t[0]!.durationMs).toBe(86_400_000);
  });

  it("clearItem with a source only clears a matching item timer", () => {
    const t: StageTimerInstance[] = reduceTimers(
      [],
      { type: "setItem", label: "W", anchor: NOW, durationMs: 1000, overtime: true, source: "item", rowId: "r" },
      NOW,
    );
    expect(reduceTimers(t, { type: "clearItem", source: "pco" }, NOW)).toBe(t);
    expect(reduceTimers(t, { type: "clearItem" }, NOW)).toEqual([]);
    expect(reduceTimers(t, { type: "clearItem", source: "item" }, NOW)).toEqual([]);
  });

  it("setItem ignores a non-finite anchor", () => {
    const item = { label: "y", overtime: true, source: "item" as const, rowId: "r2" };
    const t = reduceTimers([], { type: "setItem", label: "x", anchor: 5_000, overtime: true, source: "item", rowId: "r" }, NOW);
    for (const anchor of [NaN, Infinity, -Infinity]) {
      expect(reduceTimers(t, { type: "setItem", anchor, ...item }, NOW)).toBe(t);
    }
    expect(reduceTimers([], { type: "setItem", anchor: NaN, ...item }, NOW)).toEqual([]);
  });

  it("unknown id returns the same array", () => {
    const t: StageTimerInstance[] = [];
    const actions: TimerAction[] = [
      { type: "pause", id: "nope" },
      { type: "start", id: "nope" },
      { type: "resume", id: "nope" },
      { type: "reset", id: "nope" },
      { type: "adjust", id: "nope", deltaMs: 1 },
      { type: "delete", id: "nope" },
    ];
    for (const a of actions) expect(reduceTimers(t, a, NOW)).toBe(t);
  });
});

describe("timerMs", () => {
  it("returns duration when a countdown is not started, 0 for countup", () => {
    expect(timerMs({ mode: "countdown", anchor: null, durationMs: 5_000 }, NOW)).toBe(5_000);
    expect(timerMs({ mode: "countdown", anchor: null }, NOW)).toBe(0);
    expect(timerMs({ mode: "countup", anchor: null }, NOW)).toBe(0);
  });
  it("goes negative past a countdown's end and counts up elapsed", () => {
    expect(timerMs({ mode: "countdown", anchor: NOW - 3_000 }, NOW)).toBe(-3_000);
    expect(timerMs({ mode: "countup", anchor: NOW - 3_000 }, NOW)).toBe(3_000);
  });
});

describe("timerPhase", () => {
  it("is normal until the warn threshold, then warn, then over (or warn without overtime)", () => {
    expect(timerPhase("countdown", 120_000, true, 60_000)).toBe("normal");
    expect(timerPhase("countdown", 59_000, true, 60_000)).toBe("warn");
    expect(timerPhase("countdown", -1_000, true, 60_000)).toBe("over");
    expect(timerPhase("countdown", -1_000, false, 60_000)).toBe("warn");
    expect(timerPhase("countup", 5_000, true, 60_000)).toBe("normal");
  });
});

describe("stageTimerValue", () => {
  it("encodes a not-started countdown as paused at full", () => {
    const t = mk([], "a", "countdown", 60_000);
    expect(decodeTimerValue(stageTimerValue(t[0]!, NOW))).toEqual({ anchor: NOW + 60_000, pausedAt: NOW });
  });
  it("encodes a not-started countup as paused at zero", () => {
    const t = mk([], "a", "countup");
    expect(decodeTimerValue(stageTimerValue(t[0]!, NOW))).toEqual({ anchor: NOW, pausedAt: NOW });
  });
  it("encodes a running timer with its anchor and pause state", () => {
    let t = mk([], "a", "countdown", 60_000);
    t = reduceTimers(t, { type: "start", id: "a" }, NOW);
    expect(decodeTimerValue(stageTimerValue(t[0]!, NOW))).toEqual({ anchor: NOW + 60_000 });
    t = reduceTimers(t, { type: "pause", id: "a" }, NOW + 5_000);
    expect(decodeTimerValue(stageTimerValue(t[0]!, NOW + 9_000))).toEqual({ anchor: NOW + 60_000, pausedAt: NOW + 5_000 });
  });
});
