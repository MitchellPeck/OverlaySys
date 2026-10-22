import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STAGE_LAYOUTS,
  DEFAULT_STAGE_LAYOUT_ID,
  SPEAKER_LAYOUT,
  StageLayoutSchema,
  StageWidgetSchema,
  resolveStageLayout,
} from "./stageLayout";

describe("StageWidgetSchema", () => {
  it("fills style and props defaults", () => {
    const w = StageWidgetSchema.parse({ id: "c", kind: "clock", rect: { x: 0, y: 0, w: 100, h: 50 } });
    expect(w.kind).toBe("clock");
    expect(w.style.fontSize).toBe(64);
    expect(w.style.autoFit).toBe(true);
    if (w.kind !== "clock") throw new Error("narrowing");
    expect(w.props).toEqual({ format: "12h", seconds: false });
  });

  it("accepts a timer pinned to a channel", () => {
    const w = StageWidgetSchema.parse({
      id: "t",
      kind: "timer",
      rect: { x: 0, y: 0, w: 10, h: 10 },
      props: { source: { channel: "program" } },
    });
    if (w.kind !== "timer") throw new Error("narrowing");
    expect(w.props.source).toEqual({ channel: "program" });
  });

  it("rejects zero-size rects", () => {
    expect(() =>
      StageWidgetSchema.parse({ id: "x", kind: "text", rect: { x: 0, y: 0, w: 0, h: 10 } }),
    ).toThrow();
  });
});

describe("built-in layouts", () => {
  it("Speaker layout is valid and has unique widget ids", () => {
    const parsed = StageLayoutSchema.parse(SPEAKER_LAYOUT);
    const ids = parsed.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parsed.builtIn).toBe(true);
  });

  it("every widget fits inside the canvas", () => {
    for (const layout of BUILT_IN_STAGE_LAYOUTS) {
      for (const w of layout.widgets) {
        expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(layout.size.w);
        expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(layout.size.h);
      }
    }
  });
});

describe("resolveStageLayout", () => {
  it("returns the matching built-in", () => {
    expect(resolveStageLayout("speaker").id).toBe("speaker");
  });
  it("falls back to the default for unknown or missing ids", () => {
    expect(resolveStageLayout(undefined).id).toBe(DEFAULT_STAGE_LAYOUT_ID);
    expect(resolveStageLayout("nope").id).toBe(DEFAULT_STAGE_LAYOUT_ID);
  });
});
