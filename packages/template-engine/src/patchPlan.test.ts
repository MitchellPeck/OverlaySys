import { describe, expect, it } from "vitest";
import type { Layer, Template } from "@overlaysys/core";
import { planTemplatePatch } from "./patchPlan";

const T = { x: 0, y: 0, w: 100, h: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };

function shape(id: string, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    visible: true,
    transform: { ...T },
    type: "shape",
    shape: "rect",
    fill: { kind: "solid", color: "#f00" },
    cornerRadius: 0,
    sides: 6,
    starPoints: 5,
    starInnerRatio: 0.5,
    blur: 0,
    ...extra,
  } as Layer;
}

/** Copy-and-edit (no immer in this package; the plan compares by value where identity differs). */
function produce<T>(base: T, fn: (d: T) => void): T {
  const d = JSON.parse(JSON.stringify(base)) as T;
  fn(d);
  return d;
}

function tpl(layers: Layer[]): Template {
  return {
    id: "t",
    name: "t",
    size: { w: 1920, h: 1080 },
    fields: [{ key: "name", label: "Name", type: "text" }],
    fonts: [],
    layers,
    timelines: { in: { duration: 1, tracks: [] }, out: { duration: 0.5, tracks: [] } },
  };
}

describe("planTemplatePatch", () => {
  const base = tpl([
    shape("a"),
    { id: "g", name: "g", visible: true, transform: { ...T }, type: "group", children: [shape("b")] },
  ]);

  it("is a no-op for the same object", () => {
    expect(planTemplatePatch(base, base)).toEqual({ layers: [], timelines: false });
  });

  it("restyles only the layer whose props changed (drag frame)", () => {
    const next = produce(base, (d) => {
      d.layers[0]!.transform.x = 40;
    });
    const plan = planTemplatePatch(base, next)!;
    expect(plan.layers.map((l) => l.id)).toEqual(["a"]);
    expect(plan.timelines).toBe(false);
  });

  it("restyles a nested child without restyling its unchanged group", () => {
    const next = produce(base, (d) => {
      const g = d.layers[1]!;
      if (g.type === "group") g.children[0]!.transform.y = 9;
    });
    expect(planTemplatePatch(base, next)!.layers.map((l) => l.id)).toEqual(["b"]);
  });

  it("flags timeline edits", () => {
    const next = produce(base, (d) => {
      d.timelines.in.tracks.push({ layerId: "a", property: "x", keyframes: [] });
    });
    expect(planTemplatePatch(base, next)).toEqual({ layers: [], timelines: true });
  });

  it("asks for a remount on structural changes", () => {
    expect(planTemplatePatch(base, produce(base, (d) => void d.layers.pop()))).toBeNull();
    expect(planTemplatePatch(base, produce(base, (d) => void d.layers.reverse()))).toBeNull();
    expect(planTemplatePatch(base, produce(base, (d) => void (d.size.w = 3840)))).toBeNull();
    expect(planTemplatePatch(base, produce(base, (d) => void (d.fields[0]!.type = "color")))).toBeNull();
    expect(planTemplatePatch(base, produce(base, (d) => void d.fonts.push({ family: "X", src: "x" })))).toBeNull();
  });

  it("ignores field label/default edits", () => {
    const next = produce(base, (d) => {
      d.fields[0]!.label = "Full name";
      d.fields[0]!.default = "Ann";
    });
    expect(planTemplatePatch(base, next)).toEqual({ layers: [], timelines: false });
  });

  it("remounts when a clipBy reference moves (its clip-path is baked at build)", () => {
    const clipped = tpl([shape("ref"), shape("c", { clipBy: { layerId: "ref", hide: "inside" } })]);
    const next = produce(clipped, (d) => {
      d.layers[0]!.transform.x = 5;
    });
    expect(planTemplatePatch(clipped, next)).toBeNull();
    // Moving the clipped layer itself is fine.
    const moved = produce(clipped, (d) => {
      d.layers[1]!.transform.x = 5;
    });
    expect(planTemplatePatch(clipped, moved)!.layers.map((l) => l.id)).toEqual(["c"]);
  });

  it("remounts when a text layer's binding changes, not when its literal text does", () => {
    const text: Layer = {
      id: "t1",
      name: "t1",
      visible: true,
      transform: { ...T },
      type: "text",
      content: "hi",
      style: {
        fontFamily: "Inter",
        fontSize: 48,
        fontWeight: 600,
        italic: false,
        underline: false,
        color: "#fff",
        letterSpacing: 0,
        lineHeight: 1.1,
        align: "left",
        verticalAlign: "top",
      },
    };
    const t = tpl([text]);
    const literal = produce(t, (d) => {
      const l = d.layers[0]!;
      if (l.type === "text") l.content = "hello";
    });
    expect(planTemplatePatch(t, literal)!.layers).toHaveLength(1);
    const bound = produce(t, (d) => {
      const l = d.layers[0]!;
      if (l.type === "text") l.content = { fieldKey: "name" };
    });
    expect(planTemplatePatch(t, bound)).toBeNull();
  });
});
