import { describe, expect, it } from "vitest";
import { MediaItemSchema } from "./mediaItem";
import { RundownRowSchema } from "./show";
import { DeckSchema } from "./deck";

describe("media schemas", () => {
  it("MediaItemSchema rejects a file item without assetUrl", () => {
    const r = MediaItemSchema.safeParse({ id: "m1", name: "A", kind: "file", mediaType: "image", createdAt: "2026-01-01" });
    expect(r.success).toBe(false);
  });
  it("a live-folder item needs no assetUrl", () => {
    const r = MediaItemSchema.safeParse({ id: "m1", name: "Folder", kind: "live-folder", createdAt: "2026-01-01" });
    expect(r.success).toBe(true);
  });
  it('RundownRowSchema parses an image row with fit "cover"', () => {
    const r = RundownRowSchema.parse({ kind: "media", mediaType: "image", id: "r1", assetUrl: "/assets/a.png" });
    expect(r).toMatchObject({ kind: "media", fit: "cover" });
  });
  it('an existing {kind:"video"} row parses unchanged with endAction "clear"', () => {
    const r = RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/assets/a.mp4" });
    expect(r).toMatchObject({ kind: "video", endAction: "clear" });
  });
  it("DeckSchema accepts a media slide", () => {
    const r = DeckSchema.safeParse({
      id: "d1",
      name: "D",
      defaultTemplateId: "t",
      licensing: { kind: "own" },
      createdAt: "2026-01-01",
      slides: [{ id: "s1", data: {}, media: { assetUrl: "/assets/a.png", mediaType: "image" }, holdSec: 8 }],
    });
    expect(r.success).toBe(true);
  });
  it("old rows and decks parse unchanged; new size/position fields are accepted", () => {
    const photo = RundownRowSchema.parse({ kind: "media", mediaType: "image", id: "r1", assetUrl: "/a.png" });
    expect(photo).not.toHaveProperty("position");
    const video = RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/a.mp4" });
    expect(video).not.toHaveProperty("fit");
    expect(video).not.toHaveProperty("position");
    expect(
      RundownRowSchema.parse({ kind: "media", mediaType: "image", id: "r1", assetUrl: "/a.png", fit: "scale-down", position: "bottom" }),
    ).toMatchObject({ fit: "scale-down", position: "bottom" });
    expect(RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/a.mp4", fit: "cover", position: "top" })).toMatchObject({
      fit: "cover",
      position: "top",
    });
    const base = { id: "d1", name: "D", defaultTemplateId: "t", licensing: { kind: "own" }, createdAt: "2026-01-01" };
    const old = DeckSchema.parse({ ...base, slides: [{ id: "s1", data: {}, media: { assetUrl: "/a.png", mediaType: "image" } }] });
    expect(old).not.toHaveProperty("mediaFit");
    expect(old.slides[0]).not.toHaveProperty("fit");
    const placed = DeckSchema.parse({
      ...base,
      mediaFit: "contain",
      mediaPosition: "bottom",
      slides: [{ id: "s1", data: {}, media: { assetUrl: "/a.png", mediaType: "image" }, fit: "fill", position: "left" }],
      liveFolderId: "f1",
      folderOrder: [{ file: "a.png", fit: "scale-down", position: "top-right" }],
    });
    expect(placed).toMatchObject({ mediaFit: "contain", mediaPosition: "bottom", folderOrder: [{ fit: "scale-down", position: "top-right" }] });
    expect(DeckSchema.safeParse({ ...base, slides: [], mediaFit: "zoom" }).success).toBe(false);
    expect(MediaItemSchema.parse({ id: "m", name: "M", kind: "file", mediaType: "image", assetUrl: "/a.png", createdAt: "x", fit: "scale-down", position: "bottom" })).toMatchObject({ fit: "scale-down", position: "bottom" });
  });
  it("ChannelMedia from an older server gets position center", async () => {
    const { ChannelMediaSchema } = await import("./channel");
    const m = ChannelMediaSchema.parse({
      rowId: "r", assetUrl: "/a.png", volume: 1, endAction: "hold", takenAt: 1, paused: false,
      playback: { status: "playing", currentTime: 0, duration: 0, updatedAt: 1 },
    });
    expect(m.position).toBe("center");
    expect(ChannelMediaSchema.parse({ ...m, fit: "scale-down" }).fit).toBe("scale-down");
  });
});
