import { describe, it, expect } from "vitest";
import { nextRovingIndex } from "./roving";

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
