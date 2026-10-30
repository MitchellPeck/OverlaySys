import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@overlaysys/core";
import {
  sourceActions,
  uploadAnyFile,
  uploadFieldFile,
  uploadMediaSource,
  uploadRefusal,
  urlFromPick,
  type SourceUploadDeps,
} from "./mediaSourceChoice";

const file = (name: string, type: string) => new File(["x"], name, { type });

function deps(cloud: boolean, over: Partial<SourceUploadDeps> = {}) {
  const saved: MediaItem[] = [];
  const d: SourceUploadDeps = {
    cloud,
    upload: vi.fn(async (f: File) => ({ url: `/assets/${f.name}`, mime: f.type })),
    probe: vi.fn(async () => ({ width: 1920, height: 1080 })),
    save: vi.fn(async (item: MediaItem) => {
      saved.push(item);
    }),
    ...over,
  };
  return { d, saved };
}

describe("sourceActions", () => {
  it("offers Choose from Media and Upload on the show computer", () => {
    expect(sourceActions(false)).toEqual(["library", "upload"]);
  });
  it("offers only Upload in cloud mode", () => {
    expect(sourceActions(true)).toEqual(["upload"]);
  });
});

describe("urlFromPick", () => {
  const photo = { mediaItemId: "m1", assetUrl: "/assets/a.png", mediaType: "image" as const, name: "A" };
  const video = { mediaItemId: "m2", assetUrl: "/assets/b.mp4", mediaType: "video" as const, name: "B" };
  it("an image field gets the picked photo's asset URL", () => {
    expect(urlFromPick(photo, "image")).toEqual({ url: "/assets/a.png" });
  });
  it("an image field refuses a video item", () => {
    expect(urlFromPick(video, "image")).toBeNull();
  });
  it("a video field refuses a photo item and takes a video", () => {
    expect(urlFromPick(photo, "video")).toBeNull();
    expect(urlFromPick(video, "video")).toEqual({ url: "/assets/b.mp4" });
  });
  it("a closed picker is no pick", () => {
    expect(urlFromPick(null, "image")).toBeNull();
  });
});

describe("uploadRefusal", () => {
  it("refuses the wrong kind of file in plain words", () => {
    expect(uploadRefusal(file("a.mp4", "video/mp4"), "image")).toBe("Choose a photo.");
    expect(uploadRefusal(file("a.png", "image/png"), "video")).toBe("Choose a video file.");
    expect(uploadRefusal(file("a.pdf", "application/pdf"), "any")).toBe("Choose a photo or video.");
  });
  it("accepts a matching file", () => {
    expect(uploadRefusal(file("a.png", "image/png"), "image")).toBeNull();
    expect(uploadRefusal(file("a.mp4", "video/mp4"), "any")).toBeNull();
  });
});

describe("typeless files (empty browser type, e.g. .mov)", () => {
  const typeless = (name: string) => file(name, "");
  it("a typeless .mov is accepted for video and any, refused for image", () => {
    expect(uploadRefusal(typeless("clip.mov"), "video")).toBeNull();
    expect(uploadRefusal(typeless("clip.mov"), "any")).toBeNull();
    expect(uploadRefusal(typeless("clip.mov"), "image")).toBe("Choose a photo.");
  });
  it("a typeless .png is accepted for image; a typeless .txt is refused", () => {
    expect(uploadRefusal(typeless("Logo.PNG"), "image")).toBeNull();
    expect(uploadRefusal(typeless("notes.txt"), "any")).toBe("Choose a photo or video.");
  });
  it("a typeless .mov uploaded for a video field joins Media as a video", async () => {
    const { d, saved } = deps(false, { upload: vi.fn(async (f: File) => ({ url: `/assets/${f.name}`, mime: "application/octet-stream" })) });
    const pick = await uploadMediaSource(typeless("clip.mov"), "video", d);
    expect(saved[0]).toMatchObject({ mediaType: "video", assetUrl: "/assets/clip.mov" });
    expect(pick.mediaType).toBe("video");
  });
  it("a typeless .mov in cloud mode is a video", async () => {
    const { d } = deps(true, { upload: vi.fn(async (f: File) => ({ url: `/assets/${f.name}`, mime: "" })) });
    await expect(uploadMediaSource(typeless("clip.mov"), "video", d)).resolves.toMatchObject({ mediaType: "video" });
  });
  it("the designer sends a typeless .mov to Media", async () => {
    const { d, saved } = deps(false, { upload: vi.fn(async (f: File) => ({ url: `/assets/${f.name}`, mime: "" })) });
    await expect(uploadAnyFile(typeless("clip.mov"), d)).resolves.toBe("/assets/clip.mov");
    expect(saved).toHaveLength(1);
  });
});

describe("uploadMediaSource", () => {
  it("on the show computer the upload joins Media and links to the new item", async () => {
    const { d, saved } = deps(false);
    const pick = await uploadMediaSource(file("Banner.png", "image/png"), "image", d);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Banner", mediaType: "image", assetUrl: "/assets/Banner.png" });
    expect(pick).toEqual({ mediaItemId: saved[0]!.id, assetUrl: "/assets/Banner.png", mediaType: "image", name: "Banner" });
  });
  it("in cloud mode it is a plain upload, nothing saved to Media", async () => {
    const { d, saved } = deps(true);
    const pick = await uploadMediaSource(file("loop.mp4", "video/mp4"), "video", d);
    expect(saved).toHaveLength(0);
    expect(pick).toEqual({ assetUrl: "/assets/loop.mp4", mediaType: "video", name: "loop.mp4" });
  });
  it("refuses the wrong kind before uploading anything", async () => {
    const { d } = deps(false);
    await expect(uploadMediaSource(file("loop.mp4", "video/mp4"), "image", d)).rejects.toThrow("Choose a photo.");
    expect(d.upload).not.toHaveBeenCalled();
  });
});

describe("uploadFieldFile", () => {
  it("returns the imported item's URL for a template field", async () => {
    const { d, saved } = deps(false);
    await expect(uploadFieldFile(file("a.png", "image/png"), "image", d)).resolves.toBe("/assets/a.png");
    expect(saved).toHaveLength(1);
  });
  it("turns a failed upload into a plain sentence", async () => {
    const { d } = deps(false, { upload: vi.fn(async () => Promise.reject(new Error("asset upload failed (413)"))) });
    await expect(uploadFieldFile(file("big.mp4", "video/mp4"), "video", d)).rejects.toThrow(
      "Couldn't upload big.mp4: That file is too large for this computer's upload limit.",
    );
  });
});

describe("uploadAnyFile (designer)", () => {
  it("photos and videos join Media", async () => {
    const { d, saved } = deps(false);
    await expect(uploadAnyFile(file("bg.mp4", "video/mp4"), d)).resolves.toBe("/assets/bg.mp4");
    expect(saved).toHaveLength(1);
  });
  it("other files (fonts) upload as before and stay out of Media", async () => {
    const { d, saved } = deps(false);
    await expect(uploadAnyFile(file("Inter.woff2", "font/woff2"), d)).resolves.toBe("/assets/Inter.woff2");
    expect(saved).toHaveLength(0);
  });
});
