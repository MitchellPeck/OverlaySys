import { describe, expect, it } from "vitest";
import { commitRect } from "./geometryCommit";

describe("commitRect", () => {
  it("rounds to whole pixels and clamps size", () => {
    expect(commitRect({ x: 10.4999, y: 460.00000000000006, w: 99.6, h: 0.2 })).toEqual({
      x: 10, y: 460, w: 100, h: 1,
    });
  });
  it("keeps negative x", () => {
    expect(commitRect({ x: -3.6, y: 0, w: 5, h: 5 }).x).toBe(-4);
  });
  it("honours minSize", () => {
    expect(commitRect({ x: 0, y: 0, w: 2, h: 2 }, { minSize: 8 })).toMatchObject({ w: 8, h: 8 });
  });
});
