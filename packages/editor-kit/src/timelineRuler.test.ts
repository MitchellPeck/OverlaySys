import { describe, expect, it } from "vitest";
import { TRACK_PAD, rulerTicks, timeToX, xToTime } from "./timelineRuler";

describe("rulerTicks", () => {
  it("labels a short timeline every 0.25 s", () => {
    expect(rulerTicks(1.5, 600).labels.map((l) => l.text)).toEqual([
      "0s", "0.25s", "0.5s", "0.75s", "1s", "1.25s", "1.5s",
    ]);
  });
  it("puts a minor tick every 0.1 s under 2 s", () => {
    const { minor } = rulerTicks(1.5, 600);
    expect(minor.length).toBe(16);
    expect(minor[3]).toBe(0.3);
  });
  it("uses 0.5 s ticks and 1 s labels under 10 s", () => {
    const r = rulerTicks(4, 800);
    expect(r.minor).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(r.labels.map((l) => l.text)).toEqual(["0s", "1s", "2s", "3s", "4s"]);
  });
  it("uses 1 s ticks and 5 s labels from 10 s", () => {
    const r = rulerTicks(12, 1200);
    expect(r.minor.length).toBe(13);
    expect(r.labels.map((l) => l.t)).toEqual([0, 5, 10]);
  });
  it("doubles the label step when labels would be closer than 48 px", () => {
    expect(rulerTicks(6, 120).labels.map((l) => l.text)).toEqual(["0s", "2s", "4s", "6s"]);
  });
  it("returns nothing for an empty timeline or no width", () => {
    expect(rulerTicks(0, 600)).toEqual({ minor: [], labels: [] });
    expect(rulerTicks(2, 0)).toEqual({ minor: [], labels: [] });
  });
});

describe("timeToX / xToTime", () => {
  it("pads the track area by half a diamond on each side", () => {
    expect(TRACK_PAD).toBe(5);
    expect(timeToX(0, 2, 210)).toBe(5);
    expect(timeToX(2, 2, 210)).toBe(205);
    expect(timeToX(1, 2, 210)).toBe(105);
  });
  it("inverts and clamps", () => {
    expect(xToTime(105, 2, 210)).toBe(1);
    expect(xToTime(0, 2, 210)).toBe(0);
    expect(xToTime(400, 2, 210)).toBe(2);
  });
});
