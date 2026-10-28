import { describe, it, expect } from "vitest";
import { acceptsFile } from "./fileAccept";

describe("acceptsFile", () => {
  it("matches", () => {
    expect(acceptsFile("Song.CHO", "", ".txt,.cho")).toBe(true);
    expect(acceptsFile("a.png", "image/png", "image/*")).toBe(true);
    expect(acceptsFile("a.pdf", "application/pdf", ".txt,.cho")).toBe(false);
    expect(acceptsFile("a.pdf", "application/pdf", "application/pdf")).toBe(true);
    expect(acceptsFile("a.x", "", "")).toBe(true);
  });
});
