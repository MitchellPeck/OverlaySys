import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { StageLayoutSchema, type StageLayout } from "@overlaysys/core";
import {
  addWidget, alignWidgets, distributeWidgets, duplicateWidgets, moveWidgetZ,
  nudgeWidgets, patchWidget, removeWidgets, toggleHidden, toggleLocked,
} from "./stageLayoutOps";

const blank = StageLayoutSchema.parse({ id: "l", name: "L", widgets: [] }) as StageLayout;
const three = () => ["a", "b", "c"].reduce((l, id) => produce(l, addWidget("text", id)), blank);
const order = (l: StageLayout) => l.widgets.map((w) => w.id).join("");

describe("stageLayoutOps", () => {
  it("addWidget centers a 480×200 widget on top", () => {
    const l = produce(blank, addWidget("clock", "clock-1"));
    expect(l.widgets.at(-1)).toMatchObject({ id: "clock-1", kind: "clock", rect: { x: 720, y: 440, w: 480, h: 200 } });
  });
  it("addWidget clamps inside a small canvas", () => {
    const small = { ...blank, size: { w: 300, h: 100 } };
    const l = produce(small, addWidget("text", "t"));
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
    expect(l.widgets[0]!.rect.x).toBe(730);
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
    const l = produce(blank, addWidget("clock", "c"));
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
    const l = produce(blank, addWidget("clock", "c"));
    const p = produce(l, patchWidget("c", { rect: { w: 3 } }));
    expect(p.widgets[0]!.rect).toEqual({ ...l.widgets[0]!.rect, w: 20 });
  });
  it("patchWidget removes a style key set to undefined", () => {
    const l = produce(blank, addWidget("clock", "c"));
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
});
