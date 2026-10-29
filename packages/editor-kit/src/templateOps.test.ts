import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { TemplateSchema, type Layer, type Template } from "@overlaysys/core";
import {
  alignLayers,
  applyAnimationPreset,
  clampTimelineDuration,
  copyLayersPayload,
  dedupeFontFaces,
  distributeLayers,
  duplicateLayers,
  fieldKeyError,
  fieldUsage,
  fontUsage,
  minTimelineDuration,
  moveLayersZ,
  nudgeLayers,
  parseLayersPayload,
  pasteLayers,
  placementForNewLayer,
  removeField,
  removeLayers,
  renameFieldKey,
  toggleLayerLocked,
  topmostIds,
  upsertKeyframe,
  visibleArtboardRect,
} from "./templateOps";
import { TEMPLATE_STARTERS, templateFromStarter } from "./templateStarters";
import { findLayer } from "./utils";

const T = { rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };

function shape(id: string, x = 0, y = 0, w = 100, h = 50, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id.toUpperCase(),
    visible: true,
    transform: { ...T, x, y, w, h },
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

function text(id: string, content: Extract<Layer, { type: "text" }>["content"], color: string | { fieldKey: string } = "#fff"): Layer {
  return {
    id,
    name: id.toUpperCase(),
    visible: true,
    transform: { ...T, x: 0, y: 0, w: 200, h: 60 },
    type: "text",
    content,
    style: {
      fontFamily: "Inter",
      fontSize: 40,
      fontWeight: 600,
      italic: false,
      underline: false,
      color,
      letterSpacing: 0,
      lineHeight: 1.1,
      align: "left",
      verticalAlign: "top",
    },
  };
}

function tpl(layers: Layer[], extra: Partial<Template> = {}): Template {
  return {
    id: "t",
    name: "t",
    size: { w: 1920, h: 1080 },
    fonts: [],
    fields: [
      { key: "name", label: "Name", type: "text", default: "Ann" },
      { key: "accent", label: "Accent", type: "color", default: "#00ff00" },
    ],
    layers,
    timelines: { in: { duration: 1, tracks: [] }, out: { duration: 0.5, tracks: [] } },
    ...extra,
  };
}

const group = (id: string, children: Layer[]): Layer => ({
  id,
  name: id,
  visible: true,
  transform: { ...T, x: 10, y: 10, w: 400, h: 200 },
  type: "group",
  children,
});

describe("removeLayers", () => {
  it("drops the subtree, its tracks in every timeline, and dangling clipBy refs", () => {
    const t = tpl([group("g", [shape("a"), shape("b")]), shape("c", 0, 0, 10, 10, { clipBy: { layerId: "a", hide: "inside" } })], {
      timelines: {
        in: { duration: 1, tracks: [{ layerId: "a", property: "x", keyframes: [] }, { layerId: "c", property: "x", keyframes: [] }] },
        out: { duration: 1, tracks: [{ layerId: "b", property: "opacity", keyframes: [] }] },
        loop: { duration: 1, tracks: [{ layerId: "g", property: "y", keyframes: [] }] },
      },
    });
    const next = produce(t, removeLayers(["g"]));
    expect(next.layers.map((l) => l.id)).toEqual(["c"]);
    expect(next.layers[0]!.clipBy).toBeUndefined();
    expect(next.timelines.in.tracks.map((x) => x.layerId)).toEqual(["c"]);
    expect(next.timelines.out.tracks).toEqual([]);
    expect(next.timelines.loop!.tracks).toEqual([]);
  });
});

describe("duplicateLayers", () => {
  it("copies tracks, remaps inner clipBy, inserts above and reports the new ids", () => {
    const t = tpl([group("g", [shape("a"), shape("b", 0, 0, 1, 1, { clipBy: { layerId: "a", hide: "outside" } })]), shape("z")], {
      timelines: {
        in: { duration: 1, tracks: [{ layerId: "a", property: "x", keyframes: [{ t: 0, value: -5, easing: "power2.out" }] }] },
        out: { duration: 1, tracks: [] },
      },
    });
    let n = 0;
    const created: string[] = [];
    const next = produce(t, duplicateLayers(["g"], created, (l) => `${l.id}-copy${n++}`));
    expect(created).toEqual(["g-copy0"]);
    expect(next.layers.map((l) => l.id)).toEqual(["g", "g-copy0", "z"]);
    const copy = next.layers[1]!;
    if (copy.type !== "group") throw new Error();
    expect(copy.children.map((c) => c.id)).toEqual(["a-copy1", "b-copy2"]);
    expect(copy.children[1]!.clipBy).toEqual({ layerId: "a-copy1", hide: "outside" });
    expect(next.timelines.in.tracks.map((x) => x.layerId)).toEqual(["a", "a-copy1"]);
    expect(next.timelines.in.tracks[1]!.keyframes[0]!.value).toBe(-5);
  });

  it("duplicates nested layers inside their group and unlocks copies", () => {
    const t = tpl([group("g", [shape("a", 0, 0, 1, 1, { locked: true })])]);
    const created: string[] = [];
    const next = produce(t, duplicateLayers(["a"], created, () => "a2"));
    const g = next.layers[0]!;
    if (g.type !== "group") throw new Error();
    expect(g.children.map((c) => c.id)).toEqual(["a", "a2"]);
    expect(g.children[1]!.locked).toBeUndefined();
  });
});

describe("clipboard", () => {
  it("round-trips layers with their tracks and pastes offset with fresh ids", () => {
    const t = tpl([shape("a", 10, 20), shape("b")], {
      timelines: {
        in: { duration: 1, tracks: [{ layerId: "a", property: "opacity", keyframes: [{ t: 0, value: 0, easing: "power2.out" }] }] },
        out: { duration: 1, tracks: [{ layerId: "b", property: "opacity", keyframes: [] }] },
      },
    });
    const clip = copyLayersPayload(t, ["a"])!;
    const parsed = parseLayersPayload(JSON.stringify(clip))!;
    expect(parsed.layers.map((l) => l.id)).toEqual(["a"]);
    expect(parsed.tracks.in).toHaveLength(1);
    expect(parsed.tracks.out).toHaveLength(0);
    const created: string[] = [];
    const next = produce(t, pasteLayers(parsed, created, 20, () => "a-paste"));
    expect(created).toEqual(["a-paste"]);
    const pasted = next.layers[2]!;
    expect(pasted.transform.x).toBe(30);
    expect(pasted.transform.y).toBe(40);
    expect(next.timelines.in.tracks.map((x) => x.layerId)).toEqual(["a", "a-paste"]);
  });

  it("rejects anything that isn't a layer payload", () => {
    expect(parseLayersPayload("hello")).toBeNull();
    expect(parseLayersPayload(JSON.stringify({ kind: "other" }))).toBeNull();
    expect(parseLayersPayload(JSON.stringify({ kind: "overlaysys/layers", layers: [{ id: 1 }] }))).toBeNull();
  });
});

describe("geometry", () => {
  it("nudges unlocked topmost layers only", () => {
    const t = tpl([group("g", [shape("a")]), shape("l", 0, 0, 1, 1, { locked: true })]);
    const next = produce(t, nudgeLayers(["g", "a", "l"], 10, -1));
    expect(next.layers[0]!.transform).toMatchObject({ x: 20, y: 9 });
    expect(findLayer(next.layers, "a")!.transform).toMatchObject({ x: 0, y: 0 });
    expect(next.layers[1]!.transform).toMatchObject({ x: 0, y: 0 });
  });

  it("aligns several layers to their bounds and one to the canvas", () => {
    const t = tpl([shape("a", 100, 0, 100, 10), shape("b", 300, 0, 50, 10)]);
    const left = produce(t, alignLayers(["a", "b"], "left"));
    expect(left.layers.map((l) => l.transform.x)).toEqual([100, 100]);
    const centred = produce(t, alignLayers(["b"], "hcenter"));
    expect(centred.layers[1]!.transform.x).toBe((1920 - 50) / 2);
  });

  it("aligns a single nested layer to its group's box", () => {
    const t = tpl([group("g", [shape("a", 0, 0, 100, 10)])]);
    const next = produce(t, alignLayers(["a"], "right"));
    expect(findLayer(next.layers, "a")!.transform.x).toBe(300);
  });

  it("distributes three layers evenly", () => {
    const t = tpl([shape("a", 0, 0, 10, 10), shape("b", 15, 0, 10, 10), shape("c", 100, 0, 10, 10)]);
    const next = produce(t, distributeLayers(["a", "b", "c"], "x"));
    expect(next.layers.map((l) => l.transform.x)).toEqual([0, 50, 100]);
  });

  it("moves layers in z-order within their sibling array", () => {
    const t = tpl([shape("a"), shape("b"), shape("c")]);
    expect(produce(t, moveLayersZ(["a"], "up")).layers.map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(produce(t, moveLayersZ(["a"], "top")).layers.map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(produce(t, moveLayersZ(["c"], "bottom")).layers.map((l) => l.id)).toEqual(["c", "a", "b"]);
    // Two adjacent layers step up together without swapping.
    expect(produce(t, moveLayersZ(["a", "b"], "up")).layers.map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(produce(t, moveLayersZ(["b", "c"], "up")).layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("toggles lock", () => {
    const t = tpl([shape("a")]);
    const locked = produce(t, toggleLayerLocked("a"));
    expect(locked.layers[0]!.locked).toBe(true);
    expect(produce(locked, toggleLayerLocked("a")).layers[0]!.locked).toBeUndefined();
  });

  it("topmostIds drops descendants of selected groups", () => {
    const t = tpl([group("g", [shape("a")]), shape("b")]);
    expect(topmostIds(t.layers, ["a", "g", "b"])).toEqual(["g", "b"]);
  });
});

describe("fields", () => {
  const t = tpl([
    text("t1", { fieldKey: "name" }, { fieldKey: "accent" }),
    group("g", [shape("s", 0, 0, 1, 1, { fill: { kind: "linear-gradient", angle: 0, stops: [{ at: 0, color: { fieldKey: "accent" } }] } } as Partial<Layer>)]),
  ]);

  it("validates keys", () => {
    expect(fieldKeyError(t.fields, 0, "")).toMatch(/empty/);
    expect(fieldKeyError(t.fields, 0, "two words")).toMatch(/letters/);
    expect(fieldKeyError(t.fields, 0, "accent")).toMatch(/already/);
    expect(fieldKeyError(t.fields, 0, "fullName")).toBeNull();
  });

  it("renames a key and rewrites every binding, nested ones included", () => {
    const next = produce(t, renameFieldKey("accent", "brand"));
    expect(next.fields.map((f) => f.key)).toEqual(["name", "brand"]);
    expect(fieldUsage(next, "brand")).toEqual(["T1", "S"]);
    expect(fieldUsage(next, "accent")).toEqual([]);
  });

  it("refuses a rename onto an existing key", () => {
    expect(produce(t, renameFieldKey("accent", "name"))).toBe(t);
  });

  it("removing a field turns its bindings into literal defaults", () => {
    const next = produce(t, removeField("accent"));
    expect(next.fields.map((f) => f.key)).toEqual(["name"]);
    const t1 = findLayer(next.layers, "t1")!;
    if (t1.type !== "text") throw new Error();
    expect(t1.style.color).toBe("#00ff00");
    expect(t1.content).toEqual({ fieldKey: "name" });
    const s = findLayer(next.layers, "s")!;
    if (s.type !== "shape" || s.fill.kind !== "linear-gradient") throw new Error();
    expect(s.fill.stops[0]!.color).toBe("#00ff00");
  });
});

describe("timelines", () => {
  const t = tpl([shape("a")], {
    timelines: {
      in: { duration: 2, tracks: [{ layerId: "a", property: "x", keyframes: [{ t: 0, value: 0, easing: "power2.out" }, { t: 1.5, value: 10, easing: "power3.out" }] }] },
      out: { duration: 0.5, tracks: [] },
    },
  });

  it("never shortens a timeline past its last keyframe", () => {
    expect(minTimelineDuration(t.timelines.in)).toBe(1.5);
    expect(clampTimelineDuration(t.timelines.in, 0.4)).toBe(1.5);
    expect(clampTimelineDuration(t.timelines.in, 3)).toBe(3);
    expect(clampTimelineDuration(t.timelines.out, 0)).toBe(0.05);
  });

  it("auto-key updates the keyframe at the playhead or inserts one", () => {
    const updated = produce(t, upsertKeyframe("in", "a", "x", 1.5, 42));
    expect(updated.timelines.in.tracks[0]!.keyframes.map((k) => k.value)).toEqual([0, 42]);
    const inserted = produce(t, upsertKeyframe("in", "a", "x", 0.75, 5));
    const kfs = inserted.timelines.in.tracks[0]!.keyframes;
    expect(kfs).toHaveLength(3);
    expect(kfs[2]).toEqual({ t: 0.75, value: 5, easing: "power2.out" });
    // No track: not animated, nothing to key.
    expect(produce(t, upsertKeyframe("in", "a", "y", 0.5, 1))).toBe(t);
  });
});

describe("applyAnimationPreset", () => {
  it("fade in ends at the design opacity, fade out starts there", () => {
    const t = tpl([shape("a", 0, 0, 10, 10, { transform: { ...T, x: 0, y: 0, w: 10, h: 10, opacity: 0.8 } } as Partial<Layer>)]);
    const inT = produce(t, applyAnimationPreset("a", "in", "fade"));
    const kIn = inT.timelines.in.tracks[0]!.keyframes;
    expect(kIn[0]!.value).toBe(0);
    expect(kIn[kIn.length - 1]!.value).toBe(0.8);
    const outT = produce(t, applyAnimationPreset("a", "out", "fade"));
    const kOut = outT.timelines.out.tracks[0]!.keyframes;
    expect(kOut[0]!.value).toBe(0.8);
    expect(kOut[kOut.length - 1]!.value).toBe(0);
  });

  it("slides fully off the matching canvas edge and lands on offset 0", () => {
    const t = tpl([shape("a", 100, 200, 300, 50)]);
    const left = produce(t, applyAnimationPreset("a", "in", "slide-left")).timelines.in.tracks[0]!;
    expect(left.property).toBe("x");
    expect(left.keyframes.map((k) => k.value)).toEqual([-400, 0]);
    const bottom = produce(t, applyAnimationPreset("a", "in", "slide-bottom")).timelines.in.tracks[0]!;
    expect(bottom.keyframes.map((k) => k.value)).toEqual([880, 0]);
  });

  it("replaces the layer's existing tracks for those properties and lengthens a short timeline", () => {
    const t = tpl([shape("a")], {
      timelines: {
        in: { duration: 0.2, tracks: [{ layerId: "a", property: "opacity", keyframes: [] }, { layerId: "a", property: "x", keyframes: [] }] },
        out: { duration: 0.5, tracks: [] },
      },
    });
    const next = produce(t, applyAnimationPreset("a", "in", "fade"));
    expect(next.timelines.in.tracks.map((x) => x.property)).toEqual(["x", "opacity"]);
    expect(next.timelines.in.duration).toBeGreaterThanOrEqual(0.6);
  });

  it("wipe and pop use the wipe and scale tracks", () => {
    const t = tpl([shape("a")]);
    expect(produce(t, applyAnimationPreset("a", "in", "wipe")).timelines.in.tracks.map((x) => x.property)).toEqual(["wipe"]);
    const pop = produce(t, applyAnimationPreset("a", "out", "scale-pop"));
    expect(pop.timelines.out.tracks.map((x) => x.property).sort()).toEqual(["opacity", "scaleX", "scaleY"]);
    expect(pop.layers[0]!.transform.anchorX).toBe(0.5);
  });
});

describe("fontUsage", () => {
  it("lists the text layers using a family", () => {
    const t = tpl([text("t1", "hi"), group("g", [text("t2", "yo")])]);
    expect(fontUsage(t, "Inter")).toEqual(["T1", "T2"]);
    expect(fontUsage(t, "Other")).toEqual([]);
  });
});

describe("starters", () => {
  it("every starter parses, keeps the given id/name, and only animates its own layers", () => {
    for (const s of TEMPLATE_STARTERS) {
      const t = templateFromStarter(s.id, "template-x", "My graphic");
      expect(TemplateSchema.safeParse(t).success, s.id).toBe(true);
      expect(t.id).toBe("template-x");
      expect(t.name).toBe("My graphic");
      for (const which of ["in", "out"] as const) {
        for (const tr of t.timelines[which].tracks) {
          expect(findLayer(t.layers, tr.layerId), `${s.id}:${tr.layerId}`).not.toBeNull();
          for (const k of tr.keyframes) expect(k.t).toBeLessThanOrEqual(t.timelines[which].duration);
        }
      }
      for (const l of t.layers) {
        const bindings = JSON.stringify(l).match(/"fieldKey":"([^"]+)"/g) ?? [];
        for (const b of bindings) {
          const key = b.split(":")[1]!.replace(/"/g, "");
          expect(t.fields.some((f) => f.key === key), `${s.id}:${key}`).toBe(true);
        }
      }
    }
  });

  it("unknown starter ids give a blank template", () => {
    expect(templateFromStarter("nope", "x", "X").layers).toEqual([]);
  });
});

describe("placementForNewLayer", () => {
  it("centres the layer in the visible artboard area", () => {
    expect(placementForNewLayer({ x: 0, y: 0, w: 960, h: 540 }, { w: 400, h: 100 })).toEqual({ x: 280, y: 220 });
  });

  it("returns whole pixels for a fractional view", () => {
    const p = placementForNewLayer({ x: 10.5, y: 3.25, w: 701.3, h: 399.9 }, { w: 400, h: 100 });
    expect(Number.isInteger(p.x)).toBe(true);
    expect(Number.isInteger(p.y)).toBe(true);
  });
});

describe("visibleArtboardRect", () => {
  it("is the whole artboard when it all fits", () => {
    expect(visibleArtboardRect({ w: 1000, h: 600 }, { w: 1920, h: 1080 }, { x: 0, y: 0 }, 0.5)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("is the panned window when zoomed in", () => {
    // 2× zoom on a 960×540 host shows 480×270 artboard px around the centre, panned 200 screen px left.
    expect(visibleArtboardRect({ w: 960, h: 540 }, { w: 1920, h: 1080 }, { x: -200, y: 0 }, 2)).toEqual({ x: 820, y: 405, w: 480, h: 270 });
  });

  it("falls back to the whole artboard when it's panned out of view", () => {
    expect(visibleArtboardRect({ w: 100, h: 100 }, { w: 1920, h: 1080 }, { x: 5000, y: 0 }, 1)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});

describe("dedupeFontFaces", () => {
  it("keeps the first entry per family, ignoring case", () => {
    const out = dedupeFontFaces([
      { family: "Work Sans", src: "a" },
      { family: "work sans", src: "b" },
      { family: "Inter", src: "c" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.src).toBe("a");
  });
});
