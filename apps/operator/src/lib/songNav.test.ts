import { describe, expect, it } from "vitest";
import type { Song } from "@overlaysys/core";
import { slideDeltaTo, upcomingSlides } from "./songNav";

const sec = (id: string, n: number) => ({
  id,
  kind: "verse",
  label: id.toUpperCase(),
  slides: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, lines: [`${id}-${i + 1}`] })),
});
const sections = [sec("v1", 2), sec("c", 2), sec("v2", 1), sec("b", 1)] as unknown as Song["sections"];
const arrangement = ["v1", "c", "v2", "c", "b", "c"];

describe("slideDeltaTo", () => {
  it("counts forward to a later occurrence", () => {
    // v1 slide 1 → second chorus: rest of v1 (2) + c (2) + v2 (1)
    expect(slideDeltaTo(arrangement, sections, { sectionIdx: 0, slideIdx: 0 }, 3)).toBe(5);
  });

  it("counts back to an earlier occurrence", () => {
    // second chorus slide 2 → first chorus slide 1: -1 (to slide 1) - v2 (1) - c (2)
    expect(slideDeltaTo(arrangement, sections, { sectionIdx: 3, slideIdx: 1 }, 1)).toBe(-4);
  });

  it("returns to slide 1 of the current entry", () => {
    expect(slideDeltaTo(arrangement, sections, { sectionIdx: 1, slideIdx: 1 }, 1)).toBe(-1);
  });

  it("is null across a section missing from the song or out of range", () => {
    expect(slideDeltaTo(["v1", "gone", "c"], sections, { sectionIdx: 0, slideIdx: 0 }, 2)).toBeNull();
    expect(slideDeltaTo(arrangement, sections, { sectionIdx: 0, slideIdx: 0 }, 9)).toBeNull();
  });
});

describe("upcomingSlides", () => {
  it("starts after the slide on screen", () => {
    const items = upcomingSlides(arrangement, sections, { sectionIdx: 0, slideIdx: 0 }, 3);
    expect(items.map((i) => i.lines[0])).toEqual(["v1-2", "c-1", "c-2"]);
  });

  it("stops at the end of the arrangement", () => {
    expect(upcomingSlides(arrangement, sections, { sectionIdx: 5, slideIdx: 1 }, 3)).toEqual([]);
  });
});
