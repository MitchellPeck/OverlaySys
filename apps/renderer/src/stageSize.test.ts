import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE_SIZE, readSizeOverride, resolveStageSize } from "./stageSize";

describe("readSizeOverride", () => {
  it("parses WxH", () => {
    expect(readSizeOverride("?channel=a&size=3840x2160")).toEqual({ w: 3840, h: 2160 });
  });
  it("ignores garbage", () => {
    expect(readSizeOverride("?size=big")).toBeNull();
    expect(readSizeOverride("?size=0x0")).toBeNull();
    expect(readSizeOverride("")).toBeNull();
  });
});

describe("resolveStageSize", () => {
  it("override wins", () => {
    expect(resolveStageSize({ w: 1280, h: 720 }, { w: 3840, h: 2160 }, DEFAULT_STAGE_SIZE)).toEqual({ w: 1280, h: 720 });
  });
  it("follows the template on air", () => {
    expect(resolveStageSize(null, { w: 1080, h: 1920 }, DEFAULT_STAGE_SIZE)).toEqual({ w: 1080, h: 1920 });
  });
  it("keeps the previous size (same object) when nothing changes", () => {
    const prev = { w: 3840, h: 2160 };
    expect(resolveStageSize(null, null, prev)).toBe(prev);
    expect(resolveStageSize(null, { w: 3840, h: 2160 }, prev)).toBe(prev);
  });
});
