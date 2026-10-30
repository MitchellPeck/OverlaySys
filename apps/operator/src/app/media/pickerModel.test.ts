import { describe, expect, it } from "vitest";
import type { MediaItemMeta } from "@overlaysys/core";
import { newMediaRowFromPick, pickableItems, pickFromItem } from "./pickerModel";

const item = (p: Partial<MediaItemMeta> & { id: string }): MediaItemMeta => ({
  name: p.id,
  kind: "file",
  mediaType: "image",
  assetUrl: `/assets/${p.id}`,
  createdAt: "2026-10-30",
  usedBy: 0,
  ...p,
});

describe("newMediaRowFromPick", () => {
  it('video pick → kind "video", endAction "hold", mediaItemId set', () => {
    const row = newMediaRowFromPick({ mediaItemId: "m1", assetUrl: "/assets/a.mp4", mediaType: "video" }, "r1");
    expect(row).toMatchObject({ kind: "video", id: "r1", endAction: "hold", mediaItemId: "m1", assetUrl: "/assets/a.mp4", volume: 1 });
    expect("mediaType" in row).toBe(false);
  });

  it('image pick → kind "media", mediaType "image", fit "cover"', () => {
    const row = newMediaRowFromPick({ mediaItemId: "m2", assetUrl: "/assets/b.png", mediaType: "image" }, "r2");
    expect(row).toMatchObject({ kind: "media", mediaType: "image", id: "r2", fit: "cover", mediaItemId: "m2", assetUrl: "/assets/b.png" });
    expect("endAction" in row).toBe(false);
  });

  it("a direct upload with no library item leaves mediaItemId out", () => {
    const row = newMediaRowFromPick({ assetUrl: "/assets/c.png", mediaType: "image" }, "r3");
    expect("mediaItemId" in row).toBe(false);
  });
});

describe("an item's own size/position", () => {
  it("a pick carries the item's size/position, and a new row starts with it", () => {
    const pick = pickFromItem(item({ id: "lt", fit: "scale-down", position: "bottom" }));
    expect(pick).toMatchObject({ fit: "scale-down", position: "bottom" });
    expect(newMediaRowFromPick(pick, "r")).toMatchObject({ kind: "media", fit: "scale-down", position: "bottom" });
    const vid = newMediaRowFromPick({ assetUrl: "/a.mp4", mediaType: "video", fit: "cover", position: "top" }, "r");
    expect(vid).toMatchObject({ kind: "video", fit: "cover", position: "top" });
  });
  it("an item with none leaves the row as before", () => {
    const pick = pickFromItem(item({ id: "p" }));
    expect(pick).not.toHaveProperty("fit");
    expect(pick).not.toHaveProperty("position");
    const vid = newMediaRowFromPick({ assetUrl: "/a.mp4", mediaType: "video" }, "r");
    expect(vid).not.toHaveProperty("fit");
    expect(vid).not.toHaveProperty("position");
  });
});

describe("pickerModel", () => {
  const items = [
    item({ id: "p", name: "Banner" }),
    item({ id: "v", name: "Countdown", mediaType: "video" }),
    item({ id: "lf", name: "Announcements", kind: "live-folder", mediaType: undefined, assetUrl: undefined }),
    item({ id: "gone", name: "Old", deletedAt: "2026-10-01" }),
  ];

  it("filters by accept", () => {
    expect(pickableItems(items, "image").map((m) => m.id)).toEqual(["p"]);
    expect(pickableItems(items, "video").map((m) => m.id)).toEqual(["v"]);
    expect(pickableItems(items, "any").map((m) => m.id)).toEqual(["p", "v"]);
  });

  it("matches the search by name, ignoring case", () => {
    expect(pickableItems(items, "any", "count").map((m) => m.id)).toEqual(["v"]);
    expect(pickableItems(items, "any", "  ").map((m) => m.id)).toEqual(["p", "v"]);
  });

  it("a pick carries the item's id, asset, type and name", () => {
    expect(pickFromItem(items[1]!)).toEqual({ mediaItemId: "v", assetUrl: "/assets/v", mediaType: "video", name: "Countdown" });
  });
});
