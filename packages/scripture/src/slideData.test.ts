import { describe, expect, it } from "vitest";
import { scriptureSlideData, slideReference, type SlideLike } from "./slideData";

const v = (chapter: number, verse: number, text = "t") => ({ book: "JHN", chapter, verse, text });
const s = (...verses: ReturnType<typeof v>[]): SlideLike => ({ verses });

describe("slideReference", () => {
  it("whole-verse slides are unchanged from the old format", () => {
    const slides = [s(v(3, 16), v(3, 17)), s(v(3, 18))];
    expect(slideReference(slides, 0)).toBe("John 3:16-17");
    expect(slideReference(slides, 1)).toBe("John 3:18");
  });

  it("non-contiguous verses on one slide are comma-joined", () => {
    expect(slideReference([s(v(3, 16), v(3, 18))], 0)).toBe("John 3:16, 3:18");
  });

  it("suffixes portions of a split verse a, b by order", () => {
    const slides = [s(v(3, 16)), s(v(3, 16), v(3, 17))];
    expect(slideReference(slides, 0)).toBe("John 3:16a");
    expect(slideReference(slides, 1)).toBe("John 3:16b-17");
  });

  it("verse split three ways gets a, b, c", () => {
    const slides = [s(v(3, 16)), s(v(3, 16)), s(v(3, 16))];
    expect([0, 1, 2].map((i) => slideReference(slides, i))).toEqual(["John 3:16a", "John 3:16b", "John 3:16c"]);
  });

  it("cross-chapter run with a suffixed start", () => {
    const slides = [s(v(3, 36)), s(v(3, 36), v(4, 1), v(4, 2))];
    expect(slideReference(slides, 1)).toBe("John 3:36b-4:2");
  });

  it("suffixed end of a run", () => {
    const slides = [s(v(3, 20), v(3, 21)), s(v(3, 21))];
    expect(slideReference(slides, 0)).toBe("John 3:20-21a");
  });
});

describe("scriptureSlideData", () => {
  it("builds the take data the strip used to send", () => {
    const slides = [s(v(3, 16, "For God so")), s(v(3, 16, "loved"), v(3, 17, "For God sent"))];
    expect(scriptureSlideData({ slides, translation: "KJV", translationAbbreviation: "KJV", attribution: "PD" }, 1)).toEqual({
      text: "loved\nFor God sent",
      reference: "John 3:16b-17",
      translation: "KJV",
      attribution: "PD",
    });
  });

  it("falls back to the translation id and empty attribution", () => {
    const d = scriptureSlideData({ slides: [s(v(3, 16, "x"))], translation: "WEB" }, 0);
    expect(d.translation).toBe("WEB");
    expect(d.attribution).toBe("");
  });
});
