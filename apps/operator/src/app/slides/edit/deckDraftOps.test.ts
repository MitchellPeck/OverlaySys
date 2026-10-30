import { describe, expect, it } from "vitest";
import type { Deck } from "@overlaysys/core";
import {
  addMediaSlide,
  addSlide,
  appendPastedText,
  deckDefaultOptionLabel,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  parseHoldText,
  parseTags,
  setAdvanceOnEnd,
  setDefaultHold,
  setLoop,
  setSlideData,
  setSlideHold,
  setSlideLabel,
  setSlideMuted,
  setSlideTemplate,
} from "./deckDraftOps";

const deck = (slides: Deck["slides"]): Deck => ({
  id: "d1",
  name: "Placeholder deck",
  tags: [],
  defaultTemplateId: "t-default",
  licensing: { kind: "own" },
  slides,
  createdAt: "2026-10-28T00:00:00.000Z",
});

const three = () =>
  deck([
    { id: "a", data: { text: "Line A" } },
    { id: "b", data: { text: "Line B" }, templateId: "t-other" },
    { id: "c", data: { text: "Line C" }, label: "Response 1" },
  ]);

const ids = (d: Deck) => d.slides.map((s) => s.id);

describe("addSlide", () => {
  it("appends an empty slide when no anchor is given", () => {
    const d = addSlide(three(), undefined, "n");
    expect(ids(d)).toEqual(["a", "b", "c", "n"]);
    expect(d.slides[3]).toEqual({ id: "n", data: {} });
  });
  it("inserts right after the anchor", () => {
    expect(ids(addSlide(three(), "a", "n"))).toEqual(["a", "n", "b", "c"]);
  });
  it("appends when the anchor is unknown", () => {
    expect(ids(addSlide(three(), "zzz", "n"))).toEqual(["a", "b", "c", "n"]);
  });
  it("does not mutate the input", () => {
    const d = three();
    addSlide(d, "a", "n");
    expect(ids(d)).toEqual(["a", "b", "c"]);
  });
});

describe("duplicateSlide", () => {
  it("copies template, data and label under the new id, right after the source", () => {
    const d = duplicateSlide(three(), "b", "b2");
    expect(ids(d)).toEqual(["a", "b", "b2", "c"]);
    expect(d.slides[2]).toEqual({ id: "b2", data: { text: "Line B" }, templateId: "t-other" });
  });
  it("the copy's data is independent of the source", () => {
    const d = duplicateSlide(three(), "a", "a2");
    expect(d.slides[1]!.data).not.toBe(d.slides[0]!.data);
  });
  it("is a no-op for an unknown id", () => {
    const src = three();
    expect(duplicateSlide(src, "zzz", "n")).toBe(src);
  });
});

describe("deleteSlide", () => {
  it("removes the slide", () => {
    expect(ids(deleteSlide(three(), "b"))).toEqual(["a", "c"]);
  });
  it("deleteSlide refuses the last slide", () => {
    const one = deck([{ id: "only", data: { text: "Line A" } }]);
    expect(deleteSlide(one, "only")).toBe(one);
  });
  it("is a no-op for an unknown id", () => {
    const src = three();
    expect(deleteSlide(src, "zzz")).toBe(src);
  });
});

describe("moveSlide", () => {
  it("moves forward", () => {
    expect(ids(moveSlide(three(), 0, 2))).toEqual(["b", "c", "a"]);
  });
  it("moves backward", () => {
    expect(ids(moveSlide(three(), 2, 0))).toEqual(["c", "a", "b"]);
  });
  it("moveSlide keeps ids", () => {
    const before = three();
    const after = moveSlide(before, 1, 0);
    expect([...ids(after)].sort()).toEqual([...ids(before)].sort());
    expect(after.slides.find((s) => s.id === "b")).toEqual(before.slides[1]);
  });
  it("ignores out-of-range and same-index moves", () => {
    const src = three();
    expect(moveSlide(src, 1, 1)).toBe(src);
    expect(moveSlide(src, -1, 1)).toBe(src);
    expect(moveSlide(src, 0, 3)).toBe(src);
  });
});

describe("setSlideTemplate", () => {
  it("sets a per-slide override", () => {
    expect(setSlideTemplate(three(), "a", "t-x").slides[0]!.templateId).toBe("t-x");
  });
  it("undefined clears the override so the deck default applies", () => {
    const s = setSlideTemplate(three(), "b", undefined).slides[1]!;
    expect("templateId" in s).toBe(false);
  });
});

describe("setSlideData", () => {
  it("sets one field and keeps the others", () => {
    const d = setSlideData(deck([{ id: "a", data: { title: "Line A", body: "Line B" } }]), "a", "body", "Line C");
    expect(d.slides[0]!.data).toEqual({ title: "Line A", body: "Line C" });
  });
  it("leaves other slides alone", () => {
    const src = three();
    const d = setSlideData(src, "a", "text", "Line Z");
    expect(d.slides[1]).toBe(src.slides[1]);
  });
});

describe("setSlideLabel", () => {
  it("sets a label", () => {
    expect(setSlideLabel(three(), "a", "Response 2").slides[0]!.label).toBe("Response 2");
  });
  it("a blank label removes it", () => {
    const s = setSlideLabel(three(), "c", "  ").slides[2]!;
    expect("label" in s).toBe(false);
  });
});

describe("appendPastedText", () => {
  let n = 0;
  const gen = () => `p${++n}`;
  it("appends one slide per blank-line-separated block", () => {
    n = 0;
    const d = appendPastedText(three(), "Line X\nLine Y\n\nLine Z", "text", gen);
    expect(ids(d)).toEqual(["a", "b", "c", "p1", "p2"]);
    expect(d.slides[3]!.data).toEqual({ text: "Line X\nLine Y" });
    expect(d.slides[4]!.data).toEqual({ text: "Line Z" });
  });
  it("replaces a deck's single empty slide instead of keeping it", () => {
    n = 0;
    const d = appendPastedText(deck([{ id: "e", data: {} }]), "Line A\n\nLine B", "body", gen);
    expect(ids(d)).toEqual(["p1", "p2"]);
    expect(d.slides[0]!.data).toEqual({ body: "Line A" });
  });
  it("keeps a single slide that has content", () => {
    n = 0;
    const d = appendPastedText(deck([{ id: "e", data: { text: "Line A" } }]), "Line B", "text", gen);
    expect(ids(d)).toEqual(["e", "p1"]);
  });
  it("blank text changes nothing", () => {
    const src = three();
    expect(appendPastedText(src, " \n\n ", "text", gen)).toBe(src);
  });
});

describe("parseTags", () => {
  it("splits on commas, trims, drops blanks and duplicates (case-insensitive)", () => {
    expect(parseTags(" liturgy, Advent ,, liturgy, advent ")).toEqual(["liturgy", "Advent"]);
  });
  it("empty text is no tags", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("deckDefaultOptionLabel", () => {
  it("names the deck default design", () => {
    expect(deckDefaultOptionLabel("Lower third")).toBe("Deck default (Lower third)");
  });
});

const photo = { mediaItemId: "m1", assetUrl: "/assets/a.png", mediaType: "image" as const };
const clip = { mediaItemId: "m2", assetUrl: "/assets/b.mp4", mediaType: "video" as const };

describe("addMediaSlide", () => {
  it("adds data {}", () => {
    const d = addMediaSlide(three(), photo, "n");
    expect(ids(d)).toEqual(["a", "b", "c", "n"]);
    expect(d.slides[3]).toEqual({ id: "n", data: {}, media: photo });
  });
  it("replaces a new deck's single empty slide", () => {
    const d = addMediaSlide(deck([{ id: "e", data: {} }]), clip, "n");
    expect(d.slides).toEqual([{ id: "n", data: {}, media: clip }]);
  });
  it("keeps a single media slide", () => {
    const d = addMediaSlide(deck([{ id: "e", data: {}, media: photo }]), clip, "n");
    expect(ids(d)).toEqual(["e", "n"]);
  });
});

describe("timing", () => {
  it("setDefaultHold sets the deck hold (auto-advance on)", () => {
    expect(setDefaultHold(three(), 8).defaultHoldSec).toBe(8);
  });
  it("setDefaultHold undefined turns auto-advance off", () => {
    const d = setDefaultHold(setDefaultHold(three(), 8), undefined);
    expect("defaultHoldSec" in d).toBe(false);
  });
  it("setDefaultHold ignores a non-positive hold", () => {
    expect("defaultHoldSec" in setDefaultHold(three(), 0)).toBe(false);
  });
  it("setSlideHold sets and clears one slide's hold", () => {
    const d = setSlideHold(three(), "b", 4);
    expect(d.slides[1]!.holdSec).toBe(4);
    expect("holdSec" in setSlideHold(d, "b", undefined).slides[1]!).toBe(false);
  });
  it("setLoop on stores loop: true; off removes it", () => {
    const d = setLoop(three(), true);
    expect(d.loop).toBe(true);
    expect("loop" in setLoop(d, false)).toBe(false);
  });
  it("setAdvanceOnEnd stores the choice on that slide", () => {
    const d = addMediaSlide(three(), clip, "v");
    expect(setAdvanceOnEnd(d, "v", false).slides[3]!.advanceOnEnd).toBe(false);
    expect(setAdvanceOnEnd(d, "v", true).slides[3]!.advanceOnEnd).toBe(true);
  });
  it("parseHoldText: blank is no hold, a positive number is seconds, junk is no hold", () => {
    expect(parseHoldText("")).toBeUndefined();
    expect(parseHoldText(" 6.5 ")).toBe(6.5);
    expect(parseHoldText("0")).toBeUndefined();
    expect(parseHoldText("abc")).toBeUndefined();
  });
});

describe("setSlideMuted", () => {
  it("mutes a video slide; off removes the flag (plays with sound)", () => {
    const d = setSlideMuted(addMediaSlide(three(), clip, "v"), "v", true);
    expect(d.slides[3]!.muted).toBe(true);
    expect("muted" in setSlideMuted(d, "v", false).slides[3]!).toBe(false);
  });
});
