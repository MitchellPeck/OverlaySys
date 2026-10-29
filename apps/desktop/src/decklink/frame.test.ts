import { describe, expect, it } from "vitest";
import { findFormat } from "@overlaysys/core";
import { frameFromImage, type ImageLike } from "./frame";

function fakeImage(width: number, height: number): ImageLike & { resized: boolean } {
  const img = {
    resized: false,
    getSize: () => ({ width, height }),
    resize: (o: { width: number; height: number }) => {
      const r = fakeImage(o.width, o.height);
      img.resized = true;
      return r;
    },
    toBitmap: () => Buffer.alloc(width * height * 4),
  };
  return img;
}

describe("frameFromImage", () => {
  it("scales a Retina (2x) paint down to the signal size", () => {
    const img = fakeImage(3840, 2160);
    const buf = frameFromImage(img, findFormat("1080p59.94"));
    expect(img.resized).toBe(true);
    expect(buf.length).toBe(8_294_400);
  });

  it("passes a correctly sized paint straight through", () => {
    const img = fakeImage(1920, 1080);
    expect(frameFromImage(img, findFormat("1080p59.94")).length).toBe(8_294_400);
    expect(img.resized).toBe(false);
  });
});
