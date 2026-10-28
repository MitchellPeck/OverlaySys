import { describe, expect, it } from "vitest";
import { isPreviewingChannel } from "./stagePreviewTag";

describe("isPreviewingChannel", () => {
  it("is true when the channel has a preview", () => {
    expect(isPreviewingChannel([{ channel: "stage1", layoutId: "x" }], "stage1")).toBe(true);
  });
  it("is false for a different channel", () => {
    expect(isPreviewingChannel([{ channel: "stage2", layoutId: "x" }], "stage1")).toBe(false);
  });
  it("is false for no previews", () => {
    expect(isPreviewingChannel([], "stage1")).toBe(false);
  });
});
