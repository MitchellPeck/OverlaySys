import { describe, it, expect } from "vitest";
import { nextGridIndex, nextRovingIndex } from "./roving";

describe("nextRovingIndex", () => {
  it("wraps and handles keys", () => {
    expect(nextRovingIndex(3, 2, "ArrowRight")).toBe(0);
    expect(nextRovingIndex(3, 0, "ArrowLeft")).toBe(2);
    expect(nextRovingIndex(3, 1, "End")).toBe(2);
    expect(nextRovingIndex(3, 1, "Home")).toBe(0);
    expect(nextRovingIndex(3, 1, "a")).toBeNull();
    expect(nextRovingIndex(0, 0, "ArrowRight")).toBeNull();
  });
});

describe("nextGridIndex", () => {
  it("moves in two dimensions and stops at the edges", () => {
    expect(nextGridIndex(9, 3, 4, "ArrowRight")).toBe(5);
    expect(nextGridIndex(9, 3, 5, "ArrowRight")).toBe(5);
    expect(nextGridIndex(9, 3, 4, "ArrowDown")).toBe(7);
    expect(nextGridIndex(9, 3, 7, "ArrowDown")).toBe(7);
    expect(nextGridIndex(9, 3, 3, "ArrowLeft")).toBe(3);
    expect(nextGridIndex(9, 3, 1, "ArrowUp")).toBe(1);
    expect(nextGridIndex(9, 3, 4, "Home")).toBe(0);
    expect(nextGridIndex(9, 3, 4, "End")).toBe(8);
    expect(nextGridIndex(9, 3, 4, "a")).toBeNull();
  });
});
