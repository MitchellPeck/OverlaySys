import { describe, it, expect } from "vitest";
import { FONT_WEIGHTS, fontWeightOptions } from "./fontWeights";

describe("fontWeightOptions", () => {
  it("labels the available weights", () => {
    expect(fontWeightOptions([400, 700]).map((o) => o.label)).toEqual(["Regular 400", "Bold 700"]);
  });
  it("returns all nine without a filter", () => {
    expect(fontWeightOptions()).toHaveLength(9);
    expect(FONT_WEIGHTS[0]?.label).toBe("Thin 100");
  });
});
