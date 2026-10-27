import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STAGE_LAYOUTS,
  DEFAULT_STAGE_LAYOUT_ID,
  LYRICS_LAYOUT,
  SCRIPTURE_LAYOUT,
  SPEAKER_LAYOUT,
  STAGE_WIDGET_LABELS,
  type StageWidgetKind,
  defaultStageWidget,
  isBuiltInStageLayoutId,
  stageLayoutMeta,
  StageLayoutSchema,
  StageWidgetSchema,
  resolveBuiltInStageLayout,
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

  it("timer widget defaults", () => {
    const base = { id: "t", kind: "timer", rect: { x: 0, y: 0, w: 10, h: 10 } };
    const w = StageWidgetSchema.parse({ ...base, props: {} });
    if (w.kind !== "timer") throw new Error("narrowing");
    expect(w.props).toEqual({
      source: "firstActive",
      warnBelowSec: 60,
      warnColor: "#ffb703",
      overColor: "#ef233c",
      showLabel: false,
    });
    for (const source of ["currentItem", { timerId: "x" }]) {
      const p = StageWidgetSchema.parse({ ...base, props: { source } });
      if (p.kind !== "timer") throw new Error("narrowing");
      expect(p.props.source).toEqual(source);
    }
  });

  it("Speaker layout still parses", () => {
    expect(StageLayoutSchema.parse(SPEAKER_LAYOUT)).toEqual(SPEAKER_LAYOUT);
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

describe("resolveBuiltInStageLayout", () => {
  it("returns the matching built-in", () => {
    expect(resolveBuiltInStageLayout("speaker").id).toBe("speaker");
  });
  it("falls back to the default for unknown or missing ids", () => {
    expect(resolveBuiltInStageLayout(undefined).id).toBe(DEFAULT_STAGE_LAYOUT_ID);
    expect(resolveBuiltInStageLayout("nope").id).toBe(DEFAULT_STAGE_LAYOUT_ID);
  });
});

describe("notes and message widgets", () => {
  it("fill defaults", () => {
    const n = StageWidgetSchema.parse({ id: "n", kind: "sermonNotes", rect: { x: 0, y: 0, w: 10, h: 10 } });
    if (n.kind !== "sermonNotes") throw new Error("narrowing");
    expect(n.props).toEqual({ highlightColor: "#ffd166", dimPast: true, showCounter: true, anchor: 0.33 });
    const m = StageWidgetSchema.parse({ id: "m", kind: "message", rect: { x: 0, y: 0, w: 10, h: 10 } });
    if (m.kind !== "message") throw new Error("narrowing");
    expect(m.props).toEqual({ flash: true });
  });
  it("Speaker layout includes notes and message widgets", () => {
    const kinds = SPEAKER_LAYOUT.widgets.map((w) => w.kind);
    expect(kinds).toContain("sermonNotes");
    expect(kinds).toContain("message");
  });
});

describe("Phase 5 built-ins and helpers", () => {
  it("ships three read-only built-ins", () => {
    expect(BUILT_IN_STAGE_LAYOUTS.map((l) => l.id)).toEqual(["speaker", "lyrics", "scripture"]);
    for (const l of BUILT_IN_STAGE_LAYOUTS) {
      expect(l.builtIn).toBe(true);
      expect(StageLayoutSchema.parse(l)).toEqual(l);
    }
  });
  it("lyrics is lyrics-first", () => {
    const kinds = LYRICS_LAYOUT.widgets.map((w) => w.kind);
    expect(kinds).toEqual(expect.arrayContaining(["currentSlide", "nextSlide", "clock", "message"]));
    const cur = LYRICS_LAYOUT.widgets.find((w) => w.kind === "currentSlide")!;
    expect(cur.rect.w * cur.rect.h).toBeGreaterThan(0.5 * 1920 * 1080 * 0.5);
  });
  it("scripture has reference text, next verse and a notes sidebar", () => {
    const kinds = SCRIPTURE_LAYOUT.widgets.map((w) => w.kind);
    expect(kinds).toEqual(expect.arrayContaining(["currentSlide", "nextSlide", "sermonNotes", "message"]));
  });
  it("widgets of every built-in stay inside the canvas", () => {
    for (const l of BUILT_IN_STAGE_LAYOUTS)
      for (const w of l.widgets) {
        expect(w.rect.x).toBeGreaterThanOrEqual(0);
        expect(w.rect.y).toBeGreaterThanOrEqual(0);
        expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(l.size.w);
        expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(l.size.h);
      }
  });
  it("isBuiltInStageLayoutId", () => {
    expect(isBuiltInStageLayoutId("lyrics")).toBe(true);
    expect(isBuiltInStageLayoutId("stage-layout-1234")).toBe(false);
  });
  it("defaultStageWidget fills schema defaults for every kind", () => {
    for (const kind of Object.keys(STAGE_WIDGET_LABELS) as StageWidgetKind[]) {
      const w = defaultStageWidget(kind, "w1", { x: 0, y: 0, w: 100, h: 50 });
      expect(w.kind).toBe(kind);
      expect(w.style.fontSize).toBe(64);
    }
    expect(defaultStageWidget("timer", "t", { x: 0, y: 0, w: 1, h: 1 }).props).toMatchObject({ source: "firstActive" });
  });
  it("serviceProgress defaults and label", () => {
    const w = defaultStageWidget("serviceProgress", "s", { x: 0, y: 0, w: 100, h: 50 });
    if (w.kind !== "serviceProgress") throw new Error("narrowing");
    expect(w.props).toEqual({ showPosition: true, showEnd: true, showDelta: true, clock: "12h" });
    expect(STAGE_WIDGET_LABELS.serviceProgress).toBe("Service progress");
  });
  it("rowTitle.prefer defaults to rundown", () => {
    const w = defaultStageWidget("rowTitle", "r", { x: 0, y: 0, w: 100, h: 50 });
    if (w.kind !== "rowTitle") throw new Error("narrowing");
    expect(w.props.prefer).toBe("rundown");
    expect(w.props.showNext).toBe(true);
  });
  it("stageLayoutMeta", () => {
    expect(stageLayoutMeta(SPEAKER_LAYOUT)).toEqual({ id: "speaker", name: "Speaker", size: { w: 1920, h: 1080 }, builtIn: true });
  });
});

describe("stage layout id safety and meta", () => {
  it.each(["speaker", "stage-layout-aaaa1111", "draft_1"])("accepts %s", (id) => {
    expect(StageLayoutSchema.safeParse({ id, name: "x", widgets: [] }).success).toBe(true);
  });
  it.each(["../x", "a/b", "", "a.b", "x".repeat(65)])("rejects %j", (id) => {
    expect(StageLayoutSchema.safeParse({ id, name: "x", widgets: [] }).success).toBe(false);
  });
  it("built-in ids pass the schema", () => {
    for (const l of BUILT_IN_STAGE_LAYOUTS) expect(StageLayoutSchema.safeParse(l).success).toBe(true);
  });
  it("stageLayoutMeta copies size", () => {
    expect(stageLayoutMeta(SPEAKER_LAYOUT).size).not.toBe(SPEAKER_LAYOUT.size);
  });
});
