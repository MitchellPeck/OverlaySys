import { describe, expect, it } from "vitest";
import {
  MediaFitSchema,
  MediaPositionSchema,
  mediaObjectPosition,
  resolveMediaPlacement,
  type MediaPosition,
} from "./mediaPlacement";

describe("mediaObjectPosition", () => {
  it("maps all nine positions to CSS object-position", () => {
    const want: Record<MediaPosition, string> = {
      "top-left": "0% 0%",
      top: "50% 0%",
      "top-right": "100% 0%",
      left: "0% 50%",
      center: "50% 50%",
      right: "100% 50%",
      "bottom-left": "0% 100%",
      bottom: "50% 100%",
      "bottom-right": "100% 100%",
    };
    expect(MediaPositionSchema.options).toHaveLength(9);
    for (const p of MediaPositionSchema.options) expect(mediaObjectPosition(p)).toBe(want[p]);
  });
});

describe("MediaFitSchema", () => {
  it("has the four sizes", () => {
    expect(MediaFitSchema.options).toEqual(["cover", "contain", "scale-down", "fill"]);
  });
});

describe("resolveMediaPlacement", () => {
  it("the first layer that sets a value wins, per field", () => {
    expect(resolveMediaPlacement("image", { position: "bottom" }, { fit: "scale-down", position: "top" })).toEqual({
      fit: "scale-down",
      position: "bottom",
    });
  });
  it("falls back to what plays today: photos fill the screen, videos fit inside, centred", () => {
    expect(resolveMediaPlacement("image")).toEqual({ fit: "cover", position: "center" });
    expect(resolveMediaPlacement("video", undefined, {})).toEqual({ fit: "contain", position: "center" });
  });
});
