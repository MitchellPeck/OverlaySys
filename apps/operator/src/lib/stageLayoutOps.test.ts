import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { StageLayoutSchema, defaultStageWidget, type StageLayout, type StageRect } from "@overlaysys/core";
import {
  addWidget, addWidgetOp, alignWidgets, distributeWidgets, duplicateWidgets, moveWidgetZ,
  nudgeWidgets, patchWidget, removeWidgets, toggleHidden, toggleLocked,
} from "./stageLayoutOps";

const blank = StageLayoutSchema.parse({ id: "l", name: "L", widgets: [] }) as StageLayout;
const three = () => ["a", "b", "c"].reduce((l, id) => produce(l, addWidgetOp("text", id)), blank);
const order = (l: StageLayout) => l.widgets.map((w) => w.id).join("");

describe("stageLayoutOps", () => {
  it("addWidgetOp puts a 480×200 widget on top at the first free slot", () => {
    const l = produce(blank, addWidgetOp("clock", "clock-1"));
    expect(l.widgets.at(-1)).toMatchObject({ id: "clock-1", kind: "clock", rect: { x: 0, y: 0, w: 480, h: 200 } });
  });
  it("addWidgetOp clamps inside a small canvas", () => {
    const small = { ...blank, size: { w: 300, h: 100 } };
    const l = produce(small, addWidgetOp("text", "t"));
    expect(l.widgets[0]!.rect).toEqual({ x: 0, y: 0, w: 300, h: 100 });
  });
  it("removeWidgets removes by id", () => {
    expect(order(produce(three(), removeWidgets(["a", "c"])))).toBe("b");
  });
  it("moveWidgetZ top/bottom/up/down reorders the array", () => {
    expect(order(produce(three(), moveWidgetZ("a", "top")))).toBe("bca");
    expect(order(produce(three(), moveWidgetZ("c", "bottom")))).toBe("cab");
    expect(order(produce(three(), moveWidgetZ("a", "up")))).toBe("bac");
    expect(order(produce(three(), moveWidgetZ("c", "down")))).toBe("acb");
    const l = three();
    expect(produce(l, moveWidgetZ("c", "up"))).toBe(l);
  });
  it("toggleHidden / toggleLocked flip flags", () => {
    const l = produce(three(), (d) => {
      toggleHidden("a")(d);
      toggleLocked("b")(d);
    });
    expect(l.widgets[0]!.hidden).toBe(true);
    expect(l.widgets[1]!.locked).toBe(true);
  });
  it("nudge and align skip locked widgets", () => {
    let l = produce(three(), toggleLocked("b"));
    const before = l.widgets[1]!.rect;
    l = produce(l, nudgeWidgets(["a", "b"], 10, 0));
    expect(l.widgets[0]!.rect.x).toBe(10);
    expect(l.widgets[1]!.rect).toEqual(before);
    l = produce(l, alignWidgets(["a", "b"], "left"));
    expect(l.widgets[1]!.rect).toEqual(before);
  });
  it("distributeWidgets spreads three widgets", () => {
    let l = three();
    l = produce(l, patchWidget("a", { rect: { x: 0, y: 0, w: 100, h: 100 } }));
    l = produce(l, patchWidget("b", { rect: { x: 50, y: 0, w: 100, h: 100 } }));
    l = produce(l, patchWidget("c", { rect: { x: 400, y: 0, w: 100, h: 100 } }));
    l = produce(l, distributeWidgets(["a", "b", "c"], "x"));
    expect(l.widgets.map((w) => w.rect.x)).toEqual([0, 200, 400]);
  });
  it("patchWidget merges style and props", () => {
    const l = produce(blank, addWidgetOp("clock", "c"));
    const fs = l.widgets[0]!.style.fontSize;
    const p = produce(l, patchWidget("c", { style: { color: "#ff0000" } }));
    expect(p.widgets[0]!.style).toMatchObject({ color: "#ff0000", fontSize: fs });
    const before = Object.keys(l.widgets[0]!.props as object);
    const p2 = produce(l, patchWidget("c", { props: { seconds: true } }));
    const props = p2.widgets[0]!.props as Record<string, unknown>;
    expect(props.seconds).toBe(true);
    for (const k of before) expect(props).toHaveProperty(k);
  });
  it("patchWidget merges a partial rect and clamps w/h to 20", () => {
    const l = produce(blank, addWidgetOp("clock", "c"));
    const p = produce(l, patchWidget("c", { rect: { w: 3 } }));
    expect(p.widgets[0]!.rect).toEqual({ ...l.widgets[0]!.rect, w: 20 });
  });
  it("patchWidget removes a style key set to undefined", () => {
    const l = produce(blank, addWidgetOp("clock", "c"));
    const withBg = produce(l, patchWidget("c", { style: { background: "#111111" } }));
    expect(withBg.widgets[0]!.style.background).toBe("#111111");
    const cleared = produce(withBg, patchWidget("c", { style: { background: undefined } }));
    expect("background" in cleared.widgets[0]!.style).toBe(false);
  });
  it("duplicateWidgets offsets +20 and gets new ids", () => {
    const l = produce(three(), duplicateWidgets(["a"], (o) => `${o}-copy`));
    expect(l.widgets).toHaveLength(4);
    const c = l.widgets.at(-1)!;
    expect(c.id).toBe("a-copy");
    expect(c.rect.x).toBe(l.widgets[0]!.rect.x + 20);
    expect(c.rect.y).toBe(l.widgets[0]!.rect.y + 20);
  });
  it("duplicateWidgets produces unlocked copies of locked widgets", () => {
    const l = produce(produce(three(), toggleLocked("a")), duplicateWidgets(["a"], (o) => `${o}-copy`));
    expect(l.widgets[0]!.locked).toBe(true);
    expect(l.widgets.at(-1)!.locked).toBeFalsy();
  });
  it("align with only one unlocked widget in the selection aligns it to the canvas", () => {
    let l = produce(three(), toggleLocked("b"));
    l = produce(l, alignWidgets(["a", "b"], "left"));
    expect(l.widgets[0]!.rect.x).toBe(0);
    l = produce(l, alignWidgets(["a", "b"], "bottom"));
    expect(l.widgets[0]!.rect.y).toBe(1080 - l.widgets[0]!.rect.h);
  });
});

describe("addWidget (first free slot)", () => {
  const overlaps = (a: StageRect, b: StageRect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("places 3 timers on an empty 1920x1080 layout as non-overlapping 600x300 rects", () => {
    let l = blank;
    for (let i = 0; i < 3; i++) l = addWidget(l, "timer").layout;
    const rects = l.widgets.map((w) => w.rect);
    expect(rects).toHaveLength(3);
    for (const r of rects) expect(r).toMatchObject({ w: 600, h: 300 });
    expect(rects[0]).toMatchObject({ x: 0, y: 0 });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });
  it("returns the id of the new widget, which is last", () => {
    const { layout, id } = addWidget(blank, "clock");
    expect(layout.widgets.at(-1)!.id).toBe(id);
  });
  it("cascades +40/+40 from the last widget when the layout is full and stays inside", () => {
    const full = produce(blank, (d) => {
      d.widgets.push({ ...defaultStageWidget("text", "big", { x: 0, y: 0, w: 1920, h: 1080 }) } as never);
    });
    const a = addWidget(full, "timer");
    expect(a.layout.widgets.at(-1)!.rect).toMatchObject({ x: 40, y: 40, w: 600, h: 300 });
    let l = a.layout;
    for (let i = 0; i < 60; i++) l = addWidget(l, "timer").layout;
    for (const w of l.widgets) {
      expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(1920);
      expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(1080);
    }
  });
  it("a new timer shows its label at font size 160", () => {
    const w = addWidget(blank, "timer").layout.widgets[0]!;
    expect(w.kind === "timer" && w.props.showLabel).toBe(true);
    expect(w.style.fontSize).toBe(160);
  });
});
