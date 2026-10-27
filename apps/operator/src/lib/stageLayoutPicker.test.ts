import { describe, expect, it } from "vitest";
import type { ChannelConfig, StageLayoutMeta } from "@overlaysys/core";
import { channelsUsingLayout, layoutPickerModel } from "./stageLayoutPicker";

const meta = (id: string, name: string): StageLayoutMeta => ({
  id,
  name,
  size: { w: 1920, h: 1080 },
  builtIn: false,
});
const ch = (o: Record<string, unknown>) => o as unknown as ChannelConfig;

describe("channelsUsingLayout", () => {
  it("returns only stage channels with that layoutId", () => {
    const channels = [
      ch({ id: "a", kind: "stage", layoutId: "x" }),
      ch({ id: "b", kind: "stage", layoutId: "y" }),
      ch({ id: "c", kind: "graphics", layoutId: "x" }),
      ch({ id: "d", kind: "stage" }),
    ];
    expect(channelsUsingLayout(channels, "x").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("layoutPickerModel", () => {
  it("falls back to built-ins before the list arrives", () => {
    const m = layoutPickerModel([], undefined);
    expect(m.options.map((o) => o.id)).toEqual(["speaker", "lyrics", "scripture"]);
    expect(m.value).toBe("speaker");
    expect(m.missingId).toBeNull();
  });
  it("does not flag a custom id as missing before the list arrives", () => {
    expect(layoutPickerModel([], "stage-layout-1").missingId).toBeNull();
  });
  it("shows a custom id by its raw id (not Speaker) before the list arrives", () => {
    const m = layoutPickerModel([], "stage-layout-1");
    expect(m.value).toBe("stage-layout-1");
    expect(m.options[0]).toEqual({ id: "stage-layout-1", label: "stage-layout-1" });
    expect(m.missingId).toBeNull();
  });
  it("lists stored layouts", () => {
    const m = layoutPickerModel([meta("speaker", "Speaker"), meta("stage-layout-1", "Mine")], "stage-layout-1");
    expect(m.options).toHaveLength(2);
    expect(m.missingId).toBeNull();
  });
  it("flags a stored id that no longer exists", () => {
    const m = layoutPickerModel([meta("speaker", "Speaker")], "stage-layout-gone");
    expect(m.missingId).toBe("stage-layout-gone");
    expect(m.value).toBe("stage-layout-gone");
    expect(m.options[0]).toEqual({ id: "stage-layout-gone", label: "stage-layout-gone (missing — Speaker)" });
  });
});
