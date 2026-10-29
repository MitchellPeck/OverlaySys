import { describe, expect, it } from "vitest";
import { movePreset, presetsInvalidReason } from "./presetsDraft";

describe("presetsDraft", () => {
  it("flags the first blank preset, 1-based", () => {
    expect(presetsInvalidReason(["Wrap up", ""])).toBe("Preset 2 is empty");
    expect(presetsInvalidReason(["  ", ""])).toBe("Preset 1 is empty");
    expect(presetsInvalidReason(["a", "b"])).toBeNull();
    expect(presetsInvalidReason([])).toBeNull();
  });
  it("moves a preset down", () => {
    expect(movePreset(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });
  it("is a no-op at the edges", () => {
    expect(movePreset(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movePreset(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});
