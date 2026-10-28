import { describe, expect, it } from "vitest";
import { captionFontSize, defaultCaption, resolveCaption } from "./captionStyle";

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
describe("resolveCaption", () => {
  it("label wins when it is not a content-kind name", () => {
    expect(resolveCaption("currentSlide", "LIVE", "graphic")).toBe("LIVE");
  });
  it("a contradicting kind-name label yields to the live kind", () => {
    expect(resolveCaption("currentSlide", "SCRIPTURE", "graphic")).toBe("Graphic");
    expect(resolveCaption("currentSlide", "SCRIPTURE", "scripture")).toBe("SCRIPTURE");
  });
  it("falls back to the default when unlabelled", () => {
    expect(resolveCaption("currentSlide", undefined, "song")).toBe("Lyrics");
    expect(resolveCaption("clock", undefined)).toBeUndefined();
  });
});
