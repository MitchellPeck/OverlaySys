import { describe, expect, it } from "vitest";
import type { MediaItemMeta } from "@overlaysys/core";
import {
  NO_FOLDER, mediaDeleteConfirm, mediaFilters, mediaMenuItems, mediaSorts, folderNames, formatDuration, thumbnailSource,
} from "./libraryConfig";

const item = (o: Partial<MediaItemMeta> & { id: string }): MediaItemMeta => ({
  name: o.id, kind: "file", mediaType: "image", assetUrl: `/assets/${o.id}.png`, createdAt: "2026-10-01T00:00:00.000Z", usedBy: 0, ...o,
});
const a = item({ id: "a", folder: "Worship" });
const b = item({ id: "b", mediaType: "video", assetUrl: "/assets/b.mp4", folder: "Worship", durationSec: 75 });
const c = item({ id: "c", kind: "live-folder", mediaType: undefined, assetUrl: undefined });
const all = [a, b, c];

describe("mediaDeleteConfirm", () => {
  it("asks only when used, and says Used by N", () => {
    expect(mediaDeleteConfirm(a)).toBeNull();
    const ask = mediaDeleteConfirm(item({ id: "u", name: "Banner", usedBy: 3 }))!;
    expect(ask.message).toContain("Used by 3");
    expect(ask.danger).toBe(true);
  });
});

describe("filters", () => {
  const f = (id: string) => mediaFilters(all).find((x) => x.id === id)!;
  it("filters by type including live folders", () => {
    const t = f("type");
    expect(all.filter((m) => t.test(m, "image")).map((m) => m.id)).toEqual(["a"]);
    expect(all.filter((m) => t.test(m, "video")).map((m) => m.id)).toEqual(["b"]);
    expect(all.filter((m) => t.test(m, "live-folder")).map((m) => m.id)).toEqual(["c"]);
  });
  it("filters by folder, with an option for items in no folder", () => {
    const fo = f("folder");
    expect(fo.options.map((o) => o.label)).toEqual(["Worship", "No folder"]);
    expect(all.filter((m) => fo.test(m, "Worship")).map((m) => m.id)).toEqual(["a", "b"]);
    expect(all.filter((m) => fo.test(m, NO_FOLDER)).map((m) => m.id)).toEqual(["c"]);
  });
  it("no folder filter when nothing is in a folder", () => {
    expect(mediaFilters([c]).map((x) => x.id)).toEqual(["type"]);
    expect(folderNames(all)).toEqual(["Worship"]);
  });
});

describe("misc", () => {
  it("sorts", () => expect(mediaSorts.map((s) => s.id)).toEqual(["name-asc", "added-desc"]));
  it("duration reads m:ss", () => {
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(5.2)).toBe("0:05");
  });
  it("thumbnails: image asset, video poster, live folder first image", () => {
    expect(thumbnailSource(a, undefined)).toEqual({ kind: "image", url: "/assets/a.png" });
    expect(thumbnailSource(b, undefined)).toEqual({ kind: "video", url: "/assets/b.mp4" });
    expect(thumbnailSource(c, undefined)).toEqual({ kind: "folder" });
    expect(thumbnailSource(c, [{ name: "x.mp4", mediaType: "video", size: 1, mtimeMs: 1 }, { name: "y z.png", mediaType: "image", size: 1, mtimeMs: 1 }]))
      .toEqual({ kind: "image", url: "/media-folders/c/y%20z.png" });
  });
  it("menu: rename, move, delete (danger), offline reason", () => {
    const noop = () => {};
    const items = mediaMenuItems(a, { rename: noop, move: noop, replace: noop, chooseFolder: noop, delete: noop }, "Reconnect");
    const real = items.filter((i): i is Extract<typeof i, { id: string }> => "id" in i);
    expect(real.map((i) => i.id)).toEqual(["rename", "move", "replace", "delete"]);
    expect(real.every((i) => i.disabled === "Reconnect")).toBe(true);
    const live = mediaMenuItems(c, { rename: noop, move: noop, replace: noop, chooseFolder: noop, delete: noop }).filter((i): i is Extract<typeof i, { id: string }> => "id" in i);
    expect(live.map((i) => i.id)).toEqual(["rename", "move", "folder", "delete"]);
  });
});
