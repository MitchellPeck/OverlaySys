import { describe, expect, it } from "vitest";
import { buildImportedItem, importMediaFile, mediaTypeOf, stripExtension } from "./importMedia";

const up = (url: string, mime: string) => ({ url, sha256: "abc", size: 10, mime });
const now = "2026-10-30T10:00:00.000Z";

describe("importMedia", () => {
  it("png becomes an image item named without its extension", () => {
    const item = buildImportedItem({ fileName: "Easter Banner.final.png", upload: up("/assets/abc.png", "image/png"), id: "m-1", now })!;
    expect(item).toEqual({ id: "m-1", name: "Easter Banner.final", kind: "file", mediaType: "image", assetUrl: "/assets/abc.png", createdAt: now });
  });
  it("mp4 becomes a video item with known size and duration", () => {
    const item = buildImportedItem({
      fileName: "loop.mp4", upload: up("/assets/x.mp4", "video/mp4"), id: "m-2", now, width: 1920, height: 1080, durationSec: 12.5, folder: "Worship",
    })!;
    expect(item).toMatchObject({ mediaType: "video", name: "loop", width: 1920, height: 1080, durationSec: 12.5, folder: "Worship" });
  });
  it("drops unknown dimensions and an empty folder", () => {
    const item = buildImportedItem({ fileName: "a.png", upload: up("/assets/a.png", "image/png"), id: "m", now, folder: "  " })!;
    expect("width" in item).toBe(false);
    expect("folder" in item).toBe(false);
  });
  it("rejects files that are not photos or videos", () => {
    expect(buildImportedItem({ fileName: "a.pdf", upload: up("/assets/a.pdf", "application/pdf"), id: "m", now })).toBeNull();
    expect(mediaTypeOf("application/octet-stream")).toBeNull();
  });
  it("strips only the last extension and keeps dotfiles", () => {
    expect(stripExtension("a.b.mov")).toBe("a.b");
    expect(stripExtension("noext")).toBe("noext");
    expect(stripExtension(".hidden")).toBe(".hidden");
  });
  it("makes safe ids", async () => {
    const { newMediaId } = await import("./importMedia");
    const id = newMediaId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newMediaId()).not.toBe(id);
  });
});

describe("importMediaFile", () => {
  const file = (name: string) => ({ name }) as File;
  it("uploads, probes and saves one library item", async () => {
    const saved: unknown[] = [];
    const item = await importMediaFile(file("Intro.mp4"), {
      upload: async () => up("/assets/i.mp4", "video/mp4"),
      probe: async () => ({ durationSec: 4 }),
      save: async (m) => void saved.push(m),
    }, now);
    expect(item).toMatchObject({ name: "Intro", mediaType: "video", assetUrl: "/assets/i.mp4", durationSec: 4, createdAt: now });
    expect(item.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(saved).toEqual([item]);
  });
  it("refuses a file that isn't a photo or video, saving nothing", async () => {
    let saves = 0;
    const deps = { upload: async () => up("/assets/a.pdf", "application/pdf"), probe: async () => ({}), save: async () => void saves++ };
    await expect(importMediaFile(file("a.pdf"), deps, now)).rejects.toThrow("That file isn't a photo or video.");
    expect(saves).toBe(0);
  });
});
