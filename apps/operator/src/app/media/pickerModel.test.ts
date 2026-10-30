import { describe, expect, it } from "vitest";
import type { MediaItemMeta } from "@overlaysys/core";
import { liveFolderChoices, newMediaRowFromPick, pickableItems, pickFromItem, pickFromLiveFile, LIVE_FOLDER_PICK_NOTE, LIVE_FOLDER_REMOTE_NOTE } from "./pickerModel";

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
    expect(pickableItems(items, "image").map((m) => m.id)).toEqual(["p", "lf"]);
    expect(pickableItems(items, "video").map((m) => m.id)).toEqual(["v", "lf"]);
    expect(pickableItems(items, "any").map((m) => m.id)).toEqual(["p", "v", "lf"]);
  });

  it("matches the search by name, ignoring case", () => {
    expect(pickableItems(items, "any", "count").map((m) => m.id)).toEqual(["v"]);
    expect(pickableItems(items, "any", "  ").map((m) => m.id)).toEqual(["p", "v", "lf"]);
    expect(pickableItems(items, "any", "announce").map((m) => m.id)).toEqual(["lf"]);
  });

  it("a pick carries the item's id, asset, type and name", () => {
    expect(pickFromItem(items[1]!)).toEqual({ mediaItemId: "v", assetUrl: "/assets/v", mediaType: "video", name: "Countdown" });
  });
});

describe("choosing a file from a live folder", () => {
  const files = [
    { name: "a.png", mediaType: "image" as const, size: 1, mtimeMs: 1 },
    { name: "b c.mp4", mediaType: "video" as const, size: 1, mtimeMs: 1 },
  ];

  it("lists only files of the field's type", () => {
    expect(liveFolderChoices({ files, configured: true }, "image").files.map((f) => f.name)).toEqual(["a.png"]);
    expect(liveFolderChoices({ files, configured: true }, "video").files.map((f) => f.name)).toEqual(["b c.mp4"]);
    expect(liveFolderChoices({ files, configured: true }, "any").files).toHaveLength(2);
  });

  it("a file pick is the /media-folders/ URL with no library item and no placement", () => {
    const pick = pickFromLiveFile("lf", files[1]!);
    expect(pick).toEqual({ assetUrl: "/media-folders/lf/b%20c.mp4", mediaType: "video", name: "b c.mp4", liveFolderId: "lf" });
    expect(pick).not.toHaveProperty("mediaItemId");
    expect(pick).not.toHaveProperty("fit");
  });

  it("a folder not set up on this computer offers no files and says so", () => {
    expect(liveFolderChoices({ files, configured: false }, "any")).toEqual({
      files: [],
      message: "These graphics are on the show computer.",
    });
    expect(LIVE_FOLDER_REMOTE_NOTE).toBe("These graphics are on the show computer.");
  });

  it("an empty or not-yet-loaded folder says what is happening", () => {
    expect(liveFolderChoices(undefined, "any")).toEqual({ files: [], message: "Looking in the folder…" });
    expect(liveFolderChoices({ files: [], configured: true }, "any").message).toBe("No photos or videos in this folder yet.");
    expect(liveFolderChoices({ files, configured: true }, "video").message).toBeNull();
  });

  it("warns that a removed or renamed file shows nothing", () => {
    expect(LIVE_FOLDER_PICK_NOTE).toBe("If a file is removed or renamed in the folder, it shows nothing.");
  });
});
