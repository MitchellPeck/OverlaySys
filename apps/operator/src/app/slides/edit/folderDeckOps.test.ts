import { describe, expect, it } from "vitest";
import type { LiveFolderFile } from "@overlaysys/core";
import { folderDeckEntries, moveFolderFile, newFolderDeck, setFolderFileHold } from "./folderDeckOps";

const file = (name: string, mediaType: "image" | "video" = "image"): LiveFolderFile => ({ name, mediaType, size: 1, mtimeMs: 1 });

describe("moveFolderFile", () => {
  it("reorders and keeps per-file holds", () => {
    const order = [{ file: "a.png", holdSec: 3 }, { file: "b.png" }, { file: "c.png", holdSec: 12 }];
    expect(moveFolderFile(order, "c.png", "a.png")).toEqual([
      { file: "c.png", holdSec: 12 },
      { file: "a.png", holdSec: 3 },
      { file: "b.png" },
    ]);
    expect(moveFolderFile(order, "a.png", "c.png")).toEqual([
      { file: "b.png" },
      { file: "c.png", holdSec: 12 },
      { file: "a.png", holdSec: 3 },
    ]);
  });
  it("moves past a missing file's saved slot, which keeps its place among the rest", () => {
    const order = [{ file: "a.png" }, { file: "gone.png" }, { file: "b.png" }];
    expect(moveFolderFile(order, "b.png", "a.png").map((o) => o.file)).toEqual(["b.png", "a.png", "gone.png"]);
  });
  it("an unknown file or the same file changes nothing", () => {
    const order = [{ file: "a.png" }, { file: "b.png" }];
    expect(moveFolderFile(order, "x.png", "a.png")).toBe(order);
    expect(moveFolderFile(order, "a.png", "a.png")).toBe(order);
  });
});

describe("setFolderFileHold", () => {
  it("sets and clears one file's hold", () => {
    const order = [{ file: "a.png" }, { file: "b.png", holdSec: 4 }];
    expect(setFolderFileHold(order, "a.png", 6)).toEqual([{ file: "a.png", holdSec: 6 }, { file: "b.png", holdSec: 4 }]);
    expect(setFolderFileHold(order, "b.png", undefined)).toEqual([{ file: "a.png" }, { file: "b.png" }]);
  });
  it("a file not in the order yet joins the end with its hold", () => {
    expect(setFolderFileHold([{ file: "a.png" }], "z.png", 5)).toEqual([{ file: "a.png" }, { file: "z.png", holdSec: 5 }]);
  });
});

describe("newFolderDeck", () => {
  it("is a looping 8 s deck with no slides of its own", () => {
    const d = newFolderDeck({ name: " Loop ", folderId: "f1", templateId: "t1", deckId: "deck-1", now: "2026-10-30T00:00:00.000Z" });
    expect(d).toMatchObject({ id: "deck-1", name: "Loop", liveFolderId: "f1", slides: [], defaultHoldSec: 8, loop: true, defaultTemplateId: "t1" });
  });
});

describe("folderDeckEntries", () => {
  it("on the show computer: the present files in saved order, new files at the end, with their hold", () => {
    const e = folderDeckEntries([{ file: "b.png", holdSec: 3 }, { file: "gone.png" }], [file("a.png"), file("b.png"), file("v.mp4", "video")], true);
    expect(e.map((x) => [x.file, x.mediaType, x.holdSec])).toEqual([
      ["b.png", "image", 3],
      ["a.png", "image", undefined],
      ["v.mp4", "video", undefined],
    ]);
  });
  it("elsewhere: every saved file by name", () => {
    const e = folderDeckEntries([{ file: "b.png", holdSec: 3 }, { file: "gone.png" }], [], false);
    expect(e.map((x) => [x.file, x.mediaType, x.holdSec])).toEqual([
      ["b.png", undefined, 3],
      ["gone.png", undefined, undefined],
    ]);
  });
});

describe("folder hold minimum", () => {
  it("a per-file hold under 0.5 s is cleared", () => {
    expect(setFolderFileHold([{ file: "a.png", holdSec: 3 }], "a.png", 0.2)).toEqual([{ file: "a.png" }]);
  });
});
