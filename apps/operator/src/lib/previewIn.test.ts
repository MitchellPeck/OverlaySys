import { describe, expect, it } from "vitest";
import { inChipRemainingMs } from "./previewIn";

describe("inChipRemainingMs", () => {
  it("counts down from takenAt for the IN duration", () => {
    expect(inChipRemainingMs(1000, 1.5, 1500)).toBe(1000);
  });
  it("is 0 once the IN has elapsed", () => {
    expect(inChipRemainingMs(1000, 1, 2500)).toBe(0);
  });
  it("is 0 with no IN timeline or no take", () => {
    expect(inChipRemainingMs(1000, 0, 1100)).toBe(0);
    expect(inChipRemainingMs(0, 2, 1100)).toBe(0);
  });
});
