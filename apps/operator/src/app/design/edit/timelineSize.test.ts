import { describe, expect, it } from "vitest";
import { TIMELINE_HEIGHT_KEY, clampTimelineHeight, defaultTimelineHeight, readStoredTimelineHeight, timelineRowCount } from "./timelineSize";

describe("defaultTimelineHeight", () => {
  it("never goes below 140", () => {
    expect(defaultTimelineHeight(2, 800)).toBe(140);
    expect(defaultTimelineHeight(0, 800)).toBe(140);
  });
  it("is 24 px per row plus 89 px of chrome (toolbar 37 + keyframe strip 32 + ruler 20)", () => {
    expect(defaultTimelineHeight(8, 800)).toBe(281);
  });
  it("fits a 2-track layer (1 header + 2 tracks) without scrolling", () => {
    const rows = timelineRowCount([{ layerId: "lt" }, { layerId: "lt" }]);
    expect(rows).toBe(3);
    expect(defaultTimelineHeight(rows, 800)).toBe(161);
  });
  it("caps at 45 % of the viewport", () => {
    expect(defaultTimelineHeight(20, 800)).toBe(360);
    expect(defaultTimelineHeight(20, 901)).toBe(405);
  });
});

describe("timelineRowCount", () => {
  it("counts one header per animated layer plus every track", () => {
    expect(timelineRowCount([])).toBe(0);
    expect(timelineRowCount([{ layerId: "a" }, { layerId: "b" }, { layerId: "a" }])).toBe(5);
  });
});

describe("clampTimelineHeight", () => {
  it("uses the same bounds", () => {
    expect(clampTimelineHeight(50, 900)).toBe(140);
    expect(clampTimelineHeight(1000, 900)).toBe(405);
    expect(clampTimelineHeight(200, 900)).toBe(200);
  });
  it("rounds to whole pixels and survives a tiny viewport", () => {
    expect(clampTimelineHeight(200.6, 900)).toBe(201);
    // 45 % of 200 is below the floor: the floor wins.
    expect(clampTimelineHeight(500, 200)).toBe(140);
  });
});

describe("readStoredTimelineHeight", () => {
  it("parses a stored number, else null", () => {
    expect(readStoredTimelineHeight("260")).toBe(260);
    expect(readStoredTimelineHeight(null)).toBeNull();
    expect(readStoredTimelineHeight("abc")).toBeNull();
    expect(readStoredTimelineHeight("-5")).toBeNull();
  });
  it("has the agreed key", () => {
    expect(TIMELINE_HEIGHT_KEY).toBe("overlaysys:designer:timelineHeight");
  });
});
