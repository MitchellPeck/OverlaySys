import { describe, expect, it } from "vitest";
import { captionFontSize, defaultCaption } from "./captionStyle";

describe("captionFontSize", () => {
  it("scales with body and floors at 28", () => {
    expect(captionFontSize(200)).toBe(70);
    expect(captionFontSize(48)).toBe(28);
    expect(captionFontSize(200, 40)).toBe(40);
  });
});
describe("defaultCaption", () => {
  it("names the live content kind for currentSlide", () => {
    expect(defaultCaption("currentSlide", "scripture")).toBe("Scripture");
    expect(defaultCaption("currentSlide", "song")).toBe("Lyrics");
    expect(defaultCaption("currentSlide", "graphic")).toBe("Graphic");
    expect(defaultCaption("currentSlide", "slides")).toBe("Slides");
    expect(defaultCaption("currentSlide", "video")).toBe("Video");
  });
  it("has none for other kinds", () => {
    expect(defaultCaption("clock")).toBeUndefined();
    expect(defaultCaption("currentSlide")).toBeUndefined();
  });
});
