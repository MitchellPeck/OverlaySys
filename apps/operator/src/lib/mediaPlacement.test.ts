import { describe, expect, it } from "vitest";
import { MEDIA_FIT_OPTIONS, applyPlacement, itemPlacement, rowPlacement, startPlacement } from "./mediaPlacement";

describe("MEDIA_FIT_OPTIONS", () => {
  it("offers the four sizes in plain language", () => {
    expect(MEDIA_FIT_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["cover", "Fill screen"],
      ["contain", "Fit inside"],
      ["scale-down", "Shrink to fit"],
      ["fill", "Stretch"],
    ]);
  });
});

describe("applyPlacement", () => {
  it("sets the keys given, clears the ones given as undefined, leaves the rest", () => {
    const o = { id: "x", fit: "cover" as const, position: "top" as const };
    expect(applyPlacement(o, { fit: "contain" })).toEqual({ id: "x", fit: "contain", position: "top" });
    expect(applyPlacement(o, { position: undefined })).toEqual({ id: "x", fit: "cover" });
  });
  it("can write to differently named keys (a deck's default)", () => {
    expect(applyPlacement({ id: "d" }, { fit: "fill", position: "left" }, { fit: "mediaFit", position: "mediaPosition" })).toEqual({
      id: "d",
      mediaFit: "fill",
      mediaPosition: "left",
    });
  });
});

describe("startPlacement", () => {
  it("a new use starts from the item's own size/position, else what plays today", () => {
    expect(startPlacement("image", { fit: "scale-down", position: "bottom" })).toEqual({ fit: "scale-down", position: "bottom" });
    expect(startPlacement("image", {})).toEqual({ fit: "cover", position: "center" });
    expect(startPlacement("video", undefined)).toEqual({ fit: "contain", position: "center" });
  });
});

describe("rowPlacement", () => {
  it("a photo row always stores its size; a centred position is left off", () => {
    expect(rowPlacement("image", { fit: "cover", position: "center" })).toEqual({ fit: "cover" });
    expect(rowPlacement("image", { fit: "contain", position: "bottom" })).toEqual({ fit: "contain", position: "bottom" });
  });
  it("a video row stores only what differs from fit inside, centred (so old rows stay the same)", () => {
    expect(rowPlacement("video", { fit: "contain", position: "center" })).toEqual({});
    expect(rowPlacement("video", { fit: "cover", position: "top" })).toEqual({ fit: "cover", position: "top" });
  });
});

describe("itemPlacement", () => {
  it("an item stores only what differs from what plays today", () => {
    expect(itemPlacement("image", { fit: "cover", position: "center" })).toEqual({});
    expect(itemPlacement("image", { fit: "scale-down", position: "bottom" })).toEqual({ fit: "scale-down", position: "bottom" });
    expect(itemPlacement("video", { fit: "contain", position: "top" })).toEqual({ position: "top" });
  });
});
