import { describe, expect, it } from "vitest";
import { parseSongSelectText, slugifyTitle } from "./songSelectParser";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Amazing Grace")).toBe("amazing-grace");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugifyTitle("Amazing Grace!! (Newton)")).toBe(
      "amazing-grace-newton",
    );
  });
  it("strips diacritics", () => {
    expect(slugifyTitle("Café Olé")).toBe("cafe-ole");
  });
  it("falls back to 'untitled' for empty input", () => {
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
  });
});

describe("parseSongSelectText (skeleton)", () => {
  it("throws on empty input", () => {
    expect(() => parseSongSelectText("")).toThrow();
  });
});
