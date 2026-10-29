import { describe, expect, it } from "vitest";
import { tooltipLeft } from "./tooltipPlace";

describe("tooltipLeft", () => {
  it("centres on the anchor when it fits", () => expect(tooltipLeft(500, 100, 1000)).toBe(450));
  it("clamps to the right margin instead of shrinking", () =>
    expect(tooltipLeft(990, 160, 1000)).toBe(1000 - 160 - 8));
  it("clamps to the left margin", () => expect(tooltipLeft(10, 100, 1000)).toBe(8));
  it("prefers the left margin when wider than the viewport", () => expect(tooltipLeft(50, 300, 200)).toBe(8));
});
