// Turns an offscreen `paint` image into exactly one signal-sized BGRA frame.
// Offscreen windows paint at the display's scale factor, so on a Retina Mac a
// 1920×1080 window arrives as 3840×2160; a frame of the wrong size would tear
// the picture, so it is scaled to the format first.

import type { SignalFormat } from "@overlaysys/core";

export interface ImageLike {
  getSize(): { width: number; height: number };
  resize(o: { width: number; height: number }): ImageLike;
  toBitmap(): Buffer;
}

export function frameFromImage(img: ImageLike, f: SignalFormat): Buffer {
  const { width, height } = img.getSize();
  const sized = width === f.width && height === f.height ? img : img.resize({ width: f.width, height: f.height });
  return sized.toBitmap();
}
