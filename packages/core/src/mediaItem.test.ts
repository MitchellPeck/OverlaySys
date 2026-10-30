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
});
