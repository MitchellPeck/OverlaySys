import { describe, it, expect } from "vitest";
import { FONT_WEIGHTS, fontWeightOptions, numericFontWeight, weightsFromDescriptors } from "./fontWeights";

describe("fontWeightOptions", () => {
  it("labels the available weights", () => {
    expect(fontWeightOptions([400, 700]).map((o) => o.label)).toEqual(["Regular 400", "Bold 700"]);
  });
  it("returns all nine without a filter", () => {
    expect(fontWeightOptions()).toHaveLength(9);
    expect(FONT_WEIGHTS[0]?.label).toBe("Thin 100");
  });
});

describe("weightsFromDescriptors", () => {
  it("is undefined when the font isn't known", () => {
    expect(weightsFromDescriptors([])).toBeUndefined();
  });
  it("treats a face registered without a weight (only \"normal\") as unknown", () => {
    expect(weightsFromDescriptors(["normal"])).toBeUndefined();
    expect(weightsFromDescriptors(["normal", "normal"])).toBeUndefined();
  });
  it("maps keywords and numbers to the nine weights", () => {
    expect(weightsFromDescriptors(["normal", "bold", "300"])).toEqual([300, 400, 700]);
  });
  it("expands a variable-font range", () => {
    expect(weightsFromDescriptors(["200 600"])).toEqual([200, 300, 400, 500, 600]);
  });
});

describe("numericFontWeight", () => {
  it("reads numbers, numeric strings and keywords", () => {
    expect(numericFontWeight(600)).toBe(600);
    expect(numericFontWeight("700")).toBe(700);
    expect(numericFontWeight("bold")).toBe(700);
    expect(numericFontWeight("normal")).toBe(400);
    expect(numericFontWeight("weird")).toBe(400);
  });
});
