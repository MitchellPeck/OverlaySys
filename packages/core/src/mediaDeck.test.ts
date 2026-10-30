import { describe, expect, it } from "vitest";
import type { Deck } from "./deck";
import {
  isMediaOnlyDeck,
  mediaDeckSlidesFromDeck,
  liveFolderFileUrl,
  nextFolderOrder,
  resolveFolderDeckSlides,
  type LiveFolderFile,
} from "./mediaDeck";

const deck = (over: Partial<Deck>): Deck =>
  ({ id: "d", name: "D", tags: [], defaultTemplateId: "t", licensing: { kind: "own" }, slides: [], createdAt: "x", ...over }) as Deck;
const f = (name: string, mediaType: "image" | "video" = "image"): LiveFolderFile => ({ name, mediaType, size: 1, mtimeMs: 1 });

describe("isMediaOnlyDeck", () => {
  it("is true for a liveFolderId deck with no slides, false when one slide has no media", () => {
    expect(isMediaOnlyDeck(deck({ liveFolderId: "f1" }))).toBe(true);
    const media = { assetUrl: "/a.png", mediaType: "image" as const };
    expect(isMediaOnlyDeck(deck({ slides: [{ id: "1", data: {}, media }] }))).toBe(true);
    expect(isMediaOnlyDeck(deck({ slides: [{ id: "1", data: {}, media }, { id: "2", data: {} }] }))).toBe(false);
    expect(isMediaOnlyDeck(deck({}))).toBe(false);
  });
});

describe("resolveFolderDeckSlides", () => {
  const files = [f("a.png"), f("b.png"), f("c.png")];
  const keys = (s: ReturnType<typeof resolveFolderDeckSlides>) => s.map((x) => x.key);
  it("appends new files after the saved order", () => {
    expect(keys(resolveFolderDeckSlides([{ file: "b.png" }, { file: "a.png" }], files, 5, "f"))).toEqual(["b.png", "a.png", "c.png"]);
  });
  it("skips missing files", () => {
    expect(keys(resolveFolderDeckSlides([{ file: "b.png" }, { file: "x.png" }, { file: "a.png" }], [f("a.png"), f("b.png")], 5, "f"))).toEqual(["b.png", "a.png"]);
  });
  it("per-file holdSec overrides defaultHoldSec", () => {
    const s = resolveFolderDeckSlides([{ file: "a.png", holdSec: 2 }, { file: "b.png" }], [f("a.png"), f("b.png")], 5, "f");
    expect(s.map((x) => x.holdSec)).toEqual([2, 5]);
  });
  it("applies the deck's size/position to every graphic, then a file's own override", () => {
    const s = resolveFolderDeckSlides(
      [{ file: "a.png" }, { file: "b.png", fit: "contain", position: "top" }],
      [f("a.png"), f("b.png")],
      5,
      "f",
      { fit: "scale-down", position: "bottom" },
    );
    expect(s.map((x) => [x.fit, x.position])).toEqual([
      ["scale-down", "bottom"],
      ["contain", "top"],
    ]);
  });
  it("with no deck default a photo fills the screen and a video fits inside, centred", () => {
    const s = resolveFolderDeckSlides(undefined, [f("a.png"), f("b.mp4", "video")], 5, "f");
    expect(s.map((x) => [x.fit, x.position])).toEqual([
      ["cover", "center"],
      ["contain", "center"],
    ]);
  });
  it("videos advance on end", () => {
    const s = resolveFolderDeckSlides(undefined, [f("a.mp4", "video"), f("b.png")], 5, "f");
    expect(s.map((x) => x.advanceOnEnd)).toEqual([true, false]);
    expect(s[0]?.assetUrl).toBe("/media-folders/f/a.mp4");
  });
});

describe("mediaDeckSlidesFromDeck", () => {
  const media = (mediaType: "image" | "video") => ({ assetUrl: `/assets/x.${mediaType === "image" ? "png" : "mp4"}`, mediaType });
  it("applies the deck default, then a slide's own size/position", () => {
    const d = deck({
      mediaFit: "scale-down",
      mediaPosition: "bottom",
      slides: [
        { id: "1", data: {}, media: media("image") },
        { id: "2", data: {}, media: media("image"), fit: "fill", position: "left" },
        { id: "3", data: {}, media: media("video"), position: "top-right" },
      ],
    });
    expect(mediaDeckSlidesFromDeck(d).map((x) => [x.fit, x.position])).toEqual([
      ["scale-down", "bottom"],
      ["fill", "left"],
      ["scale-down", "top-right"],
    ]);
  });
  it("an old deck plays as before: photos cover, videos contain, centred", () => {
    const d = deck({ slides: [{ id: "1", data: {}, media: media("image") }, { id: "2", data: {}, media: media("video") }] });
    expect(mediaDeckSlidesFromDeck(d).map((x) => [x.fit, x.position])).toEqual([
      ["cover", "center"],
      ["contain", "center"],
    ]);
  });
});

describe("nextFolderOrder", () => {
  it("appends unseen files name-sorted and keeps missing ones", () => {
    const out = nextFolderOrder([{ file: "z.png" }, { file: "gone.png" }], [f("z.png"), f("d.png"), f("b.png")]);
    expect(out.map((o) => o.file)).toEqual(["z.png", "gone.png", "b.png", "d.png"]);
  });
});

describe("liveFolderFileUrl", () => {
  it("encodes spaces and #", () => {
    expect(liveFolderFileUrl("f1", "my pic #1.png")).toBe("/media-folders/f1/my%20pic%20%231.png");
  });
});
