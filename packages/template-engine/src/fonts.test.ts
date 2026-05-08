import { describe, expect, it } from "vitest";
import { needsLoad } from "./fonts";

describe("needsLoad", () => {
  it("returns true when no face with that family is present", () => {
    expect(needsLoad("Acme Sans", new Set())).toBe(true);
  });

  it("returns false when the family is already registered", () => {
    expect(needsLoad("Acme Sans", new Set(["Acme Sans"]))).toBe(false);
  });

  it("compares case-sensitively to match how CSS resolves family names", () => {
    expect(needsLoad("Acme Sans", new Set(["acme sans"]))).toBe(true);
  });

  it("rejects empty family names", () => {
    expect(needsLoad("", new Set())).toBe(false);
    expect(needsLoad("   ", new Set())).toBe(false);
  });
});
