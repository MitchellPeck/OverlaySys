import { describe, expect, it } from "vitest";
import type { ImageRow, VideoRow } from "@overlaysys/core";
import { mediaRowTakeMessage } from "./mediaTake";

const FADE = { style: "fade", durationMs: 500 } as const;
const video = (over: Partial<VideoRow> = {}): VideoRow => ({
  kind: "video", id: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "clear", transitionIn: FADE, transitionOut: FADE, ...over,
});

describe("mediaRowTakeMessage", () => {
  it("mediaRowTakeMessage builds image and video takes with loop and muted", () => {
    expect(mediaRowTakeMessage(video({ loop: true, muted: true }), "program", "show-1")).toEqual({
      type: "media_take", channel: "program", rowId: "v1", showId: "show-1",
      assetUrl: "/a.mp4", volume: 1, endAction: "clear", mediaType: "video", loop: true, muted: true,
      transitionIn: FADE, transitionOut: FADE,
    });
    const img: ImageRow = {
      kind: "media", mediaType: "image", id: "p1", assetUrl: "/assets/p.png", label: "Welcome", fit: "cover",
      transitionIn: { style: "cut", durationMs: 0 }, transitionOut: FADE,
    };
    expect(mediaRowTakeMessage(img, "alt")).toEqual({
      type: "media_take", channel: "alt", rowId: "p1", assetUrl: "/assets/p.png", label: "Welcome",
      volume: 1, endAction: "hold", mediaType: "image", fit: "cover",
      transitionIn: { style: "cut", durationMs: 0 }, transitionOut: FADE,
    });
  });

  it("leaves loop and muted off a video take that doesn't set them", () => {
    const msg = mediaRowTakeMessage(video(), "program");
    expect(msg).not.toHaveProperty("loop");
    expect(msg).not.toHaveProperty("muted");
  });

  it("omits showId when there is none", () => {
    expect(mediaRowTakeMessage(video(), "program")).not.toHaveProperty("showId");
    expect(mediaRowTakeMessage(video(), "program", null)).not.toHaveProperty("showId");
  });
});
