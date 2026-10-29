import { describe, expect, it } from "vitest";
import { nextStageLayouts } from "./stageLayoutOverrides";

describe("nextStageLayouts", () => {
  it("sets one screen and keeps other keys, including removed screens", () => {
    expect(nextStageLayouts({ gone: "x" }, "s1", "lyrics")).toEqual({ gone: "x", s1: "lyrics" });
  });
  it("removes only the cleared key", () => {
    expect(nextStageLayouts({ gone: "x", s1: "lyrics" }, "s1", "")).toEqual({ gone: "x" });
  });
  it("returns undefined when the last override is cleared", () => {
    expect(nextStageLayouts({ s1: "lyrics" }, "s1", "")).toBeUndefined();
    expect(nextStageLayouts(undefined, "s1", "")).toBeUndefined();
  });
});
