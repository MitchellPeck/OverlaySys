/**
 * Pure template-designer operations. Recipes take an Immer draft of the
 * template; helpers that only read take the plain template.
 */
import type { Draft } from "immer";
import {
  LayerSchema,
  TrackSchema,
  type Field,
  type Keyframe,
  type Layer,
  type Template,
  type Timeline,
  type Track,
} from "@overlaysys/core";
import { alignRects, distributeRects, type AlignMode } from "./stageGeometry";

type Recipe = (d: Draft<Template>) => void;
type Rect = { x: number; y: number; w: number; h: number };

export type TimelineKey = "in" | "out" | "loop";
const TIMELINE_KEYS: TimelineKey[] = ["in", "out", "loop"];

// ───── Tree helpers ─────────────────────────────────────────────────────────

/** Mutable lookup of a layer and the array that holds it. */
export function locateLayer<L extends Layer | Draft<Layer>>(
  layers: L[],
  id: string,
): { layer: L; siblings: L[]; index: number; parent: L | null } | null {
  function walk(arr: L[], parent: L | null): ReturnType<typeof locateLayer<L>> {
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i]!;
      if (l.id === id) return { layer: l, siblings: arr, index: i, parent };
      if (l.type === "group") {
        const found = walk(l.children as L[], l);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(layers, null);
}

/** `layer`'s id plus every descendant id. */
export function subtreeIds(layer: Layer, out = new Set<string>()): Set<string> {
  out.add(layer.id);
  if (layer.type === "group") for (const c of layer.children) subtreeIds(c, out);
  return out;
}

export function allLayerIds(layers: Layer[], out = new Set<string>()): Set<string> {
  for (const l of layers) subtreeIds(l, out);
  return out;
}

/** Drop ids whose ancestor is also in `ids` (acting on the ancestor covers them). */
export function topmostIds(layers: Layer[], ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    const loc = locateLayer(layers, id);
    if (!loc) return false;
    let parent = loc.parent;
    while (parent) {
      if (set.has(parent.id)) return false;
      parent = locateLayer(layers, parent.id)?.parent ?? null;
    }
    return true;
  });
}

function timelinesOf(d: Draft<Template> | Template): { key: TimelineKey; tl: Timeline | Draft<Timeline> }[] {
  return TIMELINE_KEYS.flatMap((key) => {
    const tl = d.timelines[key];
    return tl ? [{ key, tl }] : [];
  });
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ───── Remove / duplicate / paste ───────────────────────────────────────────

/**
 * Remove layers (and their subtrees), their tracks in every timeline, and any
 * `clipBy` that pointed at a removed layer.
 */
export function removeLayers(ids: string[]): Recipe {
  return (d) => {
    const removed = new Set<string>();
    for (const id of ids) {
      const loc = locateLayer(d.layers, id);
      if (!loc) continue;
      subtreeIds(loc.layer as Layer, removed);
      loc.siblings.splice(loc.index, 1);
    }
    if (removed.size === 0) return;
    for (const { tl } of timelinesOf(d)) {
      tl.tracks = tl.tracks.filter((t) => !removed.has(t.layerId));
    }
    const visit = (l: Draft<Layer>) => {
      if (l.clipBy && removed.has(l.clipBy.layerId)) delete l.clipBy;
      if (l.type === "group") l.children.forEach(visit);
    };
    d.layers.forEach(visit);
  };
}

/** Deep copy of `layer` with fresh ids; `idMap` records old → new for every node. */
function copyWithNewIds(layer: Layer, newId: (old: Layer) => string, idMap: Map<string, string>): Layer {
  const copy = clone(layer);
  const reassign = (l: Layer) => {
    const old = l.id;
    l.id = newId(l);
    idMap.set(old, l.id);
    if (l.type === "group") l.children.forEach(reassign);
  };
  reassign(copy);
  // A clipBy inside the copied subtree follows the copy; outside refs stay.
  const remap = (l: Layer) => {
    if (l.clipBy) {
      const to = idMap.get(l.clipBy.layerId);
      if (to) l.clipBy = { ...l.clipBy, layerId: to };
    }
    if (l.type === "group") l.children.forEach(remap);
  };
  remap(copy);
  return copy;
}

function copyTracks(tracks: readonly Track[], idMap: Map<string, string>): Track[] {
  const out: Track[] = [];
  for (const t of tracks) {
    const to = idMap.get(t.layerId);
    if (to) out.push({ ...clone(t), layerId: to });
  }
  return out;
}

/** Fresh id for a layer of `type`. */
export function newLayerId(type: Layer["type"]): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Duplicate layers in place (each copy right above its original), copying
 * their animation tracks. Copies are unlocked. `created` receives the new
 * top-level ids in order, for selecting them.
 */
export function duplicateLayers(ids: string[], created: string[], newId: (old: Layer) => string = (l) => newLayerId(l.type)): Recipe {
  return (d) => {
    const plain = d.layers as unknown as Layer[];
    for (const id of topmostIds(plain, ids)) {
      const loc = locateLayer(d.layers, id);
      if (!loc) continue;
      const idMap = new Map<string, string>();
      const copy = copyWithNewIds(loc.layer as Layer, newId, idMap);
      delete copy.locked;
      loc.siblings.splice(loc.index + 1, 0, copy as Draft<Layer>);
      for (const { tl } of timelinesOf(d)) tl.tracks.push(...copyTracks(tl.tracks as Track[], idMap));
      created.push(copy.id);
    }
  };
}

export const LAYER_CLIPBOARD_KIND = "overlaysys/layers";

export type LayerClipboard = {
  kind: typeof LAYER_CLIPBOARD_KIND;
  layers: Layer[];
  tracks: { in: Track[]; out: Track[] };
};

/** Clipboard payload for the given layers (topmost only) and their tracks. */
export function copyLayersPayload(t: Template, ids: string[]): LayerClipboard | null {
  const layers: Layer[] = [];
  const included = new Set<string>();
  for (const id of topmostIds(t.layers, ids)) {
    const loc = locateLayer(t.layers, id);
    if (!loc) continue;
    layers.push(clone(loc.layer));
    subtreeIds(loc.layer, included);
  }
  if (layers.length === 0) return null;
  const pick = (tl: Timeline) => tl.tracks.filter((tr) => included.has(tr.layerId)).map(clone);
  return { kind: LAYER_CLIPBOARD_KIND, layers, tracks: { in: pick(t.timelines.in), out: pick(t.timelines.out) } };
}

/** Parse clipboard text; null unless it's a valid layer payload. */
export function parseLayersPayload(text: string): LayerClipboard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as Partial<LayerClipboard> | null;
  if (!r || r.kind !== LAYER_CLIPBOARD_KIND || !Array.isArray(r.layers)) return null;
  const layers: Layer[] = [];
  for (const l of r.layers) {
    const p = LayerSchema.safeParse(l);
    if (!p.success) return null;
    layers.push(p.data);
  }
  const tracks = (arr: unknown): Track[] =>
    Array.isArray(arr) ? arr.flatMap((t) => {
      const p = TrackSchema.safeParse(t);
      return p.success ? [p.data] : [];
    }) : [];
  return { kind: LAYER_CLIPBOARD_KIND, layers, tracks: { in: tracks(r.tracks?.in), out: tracks(r.tracks?.out) } };
}

/** Paste on top of the stack, offset by `offset` px, with fresh ids; `created` receives the new ids. */
export function pasteLayers(
  clip: LayerClipboard,
  created: string[],
  offset = 20,
  newId: (old: Layer) => string = (l) => newLayerId(l.type),
): Recipe {
  return (d) => {
    const idMap = new Map<string, string>();
    for (const l of clip.layers) {
      const copy = copyWithNewIds(l, newId, idMap);
      copy.transform = { ...copy.transform, x: copy.transform.x + offset, y: copy.transform.y + offset };
      delete copy.locked;
      d.layers.push(copy as Draft<Layer>);
      created.push(copy.id);
    }
    d.timelines.in.tracks.push(...copyTracks(clip.tracks.in, idMap));
    d.timelines.out.tracks.push(...copyTracks(clip.tracks.out, idMap));
  };
}

// ───── Geometry: nudge / align / distribute / z-order / lock ────────────────

function layerRect(l: Layer): Rect {
  return { x: l.transform.x, y: l.transform.y, w: l.transform.w ?? 0, h: l.transform.h ?? 0 };
}

function unlockedLayers(d: Draft<Template>, ids: string[]): Draft<Layer>[] {
  const out: Draft<Layer>[] = [];
  for (const id of topmostIds(d.layers as unknown as Layer[], ids)) {
    const loc = locateLayer(d.layers, id);
    if (loc && !loc.layer.locked) out.push(loc.layer);
  }
  return out;
}

export function nudgeLayers(ids: string[], dx: number, dy: number): Recipe {
  return (d) => {
    for (const l of unlockedLayers(d, ids)) {
      l.transform.x += dx;
      l.transform.y += dy;
    }
  };
}

/** Align the unlocked layers among `ids`; a single one aligns to the canvas (or its parent group's box). */
export function alignLayers(ids: string[], mode: AlignMode): Recipe {
  return (d) => {
    const ls = unlockedLayers(d, ids);
    if (ls.length === 0) return;
    let canvas = d.size;
    if (ls.length === 1) {
      const parent = locateLayer(d.layers, ls[0]!.id)?.parent;
      if (parent?.transform.w !== undefined && parent.transform.h !== undefined) {
        canvas = { w: parent.transform.w, h: parent.transform.h };
      }
    }
    const out = alignRects(ls.map((l) => layerRect(l as Layer)), mode, canvas);
    ls.forEach((l, i) => {
      l.transform.x = out[i]!.x;
      l.transform.y = out[i]!.y;
    });
  };
}

export function distributeLayers(ids: string[], axis: "x" | "y"): Recipe {
  return (d) => {
    const ls = unlockedLayers(d, ids);
    if (ls.length < 3) return;
    const out = distributeRects(ls.map((l) => layerRect(l as Layer)), axis);
    ls.forEach((l, i) => {
      l.transform[axis] = out[i]![axis];
    });
  };
}

export type ZMove = "up" | "down" | "top" | "bottom";

/** Move each layer within its own sibling array (array order = z-order, last on top). */
export function moveLayersZ(ids: string[], to: ZMove): Recipe {
  return (d) => {
    const targets = topmostIds(d.layers as unknown as Layer[], ids);
    // Stepping several layers one way: go from the leading edge so they don't leapfrog.
    const ordered = targets
      .map((id) => ({ id, index: locateLayer(d.layers, id)?.index ?? -1 }))
      .sort((a, b) => (to === "up" || to === "top" ? b.index - a.index : a.index - b.index));
    for (const { id } of ordered) {
      const loc = locateLayer(d.layers, id);
      if (!loc) continue;
      const arr = loc.siblings;
      const i = loc.index;
      const last = arr.length - 1;
      let j =
        to === "top" ? last : to === "bottom" ? 0 : to === "up" ? Math.min(i + 1, last) : Math.max(i - 1, 0);
      // Don't swap past another moving sibling.
      if ((to === "up" || to === "down") && targets.includes(arr[j]!.id)) j = i;
      if (j === i) continue;
      const [l] = arr.splice(i, 1);
      arr.splice(j, 0, l!);
    }
  };
}

export function toggleLayerLocked(id: string): Recipe {
  return (d) => {
    const loc = locateLayer(d.layers, id);
    if (!loc) return;
    if (loc.layer.locked) delete loc.layer.locked;
    else loc.layer.locked = true;
  };
}

export function toggleLayerVisible(id: string): Recipe {
  return (d) => {
    const loc = locateLayer(d.layers, id);
    if (loc) loc.layer.visible = !loc.layer.visible;
  };
}

// ───── Fields ───────────────────────────────────────────────────────────────

const FIELD_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Why `key` can't be the key of field `index` (null when it can). */
export function fieldKeyError(fields: readonly Field[], index: number, key: string): string | null {
  if (!key) return "Key can't be empty";
  if (!FIELD_KEY_RE.test(key)) return "Use letters, digits, _ or -, starting with a letter";
  if (fields.some((f, i) => i !== index && f.key === key)) return `Another field already uses "${key}"`;
  return null;
}

type BindingVisitor = (ref: { fieldKey: string }) => void;

/** Visit every field binding on a layer (content, src, colors, gradient stops, shadow). */
function visitLayerBindings(l: Layer | Draft<Layer>, visit: BindingVisitor): void {
  const v = (x: unknown) => {
    if (x && typeof x === "object" && "fieldKey" in x) visit(x as { fieldKey: string });
  };
  switch (l.type) {
    case "text":
      v(l.content);
      v(l.style.color);
      break;
    case "image":
    case "video":
      v(l.src);
      break;
    case "shape":
      if (l.fill.kind === "solid") v(l.fill.color);
      else l.fill.stops.forEach((s) => v(s.color));
      if (l.shadow) v(l.shadow.color);
      break;
    case "group":
      l.children.forEach((c: Layer | Draft<Layer>) => visitLayerBindings(c, visit));
      break;
  }
}

/** Names of the layers bound to field `key`. */
export function fieldUsage(t: Template, key: string): string[] {
  const names: string[] = [];
  const walk = (l: Layer) => {
    let hit = false;
    if (l.type !== "group") {
      visitLayerBindings(l, (ref) => {
        if (ref.fieldKey === key) hit = true;
      });
    }
    if (hit) names.push(l.name);
    if (l.type === "group") l.children.forEach(walk);
  };
  t.layers.forEach(walk);
  return names;
}

/** Rename a field key and rewrite every layer binding that used it. */
export function renameFieldKey(oldKey: string, newKey: string): Recipe {
  return (d) => {
    if (oldKey === newKey) return;
    const f = d.fields.find((x) => x.key === oldKey);
    if (!f || d.fields.some((x) => x.key === newKey)) return;
    f.key = newKey;
    for (const l of d.layers) {
      visitLayerBindings(l, (ref) => {
        if (ref.fieldKey === oldKey) ref.fieldKey = newKey;
      });
    }
  };
}

/**
 * Remove a field. Bindings to it become literals holding the field's default
 * (or empty / white for colors), so layers keep rendering the same thing.
 */
export function removeField(key: string): Recipe {
  return (d) => {
    const f = d.fields.find((x) => x.key === key);
    if (!f) return;
    const literal = f.default ?? "";
    const colorLiteral = f.default || "#ffffff";
    d.fields = d.fields.filter((x) => x.key !== key);
    const isRef = (x: unknown): boolean =>
      !!x && typeof x === "object" && (x as { fieldKey?: string }).fieldKey === key;
    const walk = (l: Draft<Layer>) => {
      switch (l.type) {
        case "text":
          if (isRef(l.content)) l.content = literal;
          if (isRef(l.style.color)) l.style.color = colorLiteral;
          break;
        case "image":
        case "video":
          if (isRef(l.src)) l.src = literal;
          break;
        case "shape":
          if (l.fill.kind === "solid") {
            if (isRef(l.fill.color)) l.fill.color = colorLiteral;
          } else {
            for (const s of l.fill.stops) if (isRef(s.color)) s.color = colorLiteral;
          }
          if (l.shadow && isRef(l.shadow.color)) l.shadow.color = "rgba(0,0,0,0.5)";
          break;
        case "group":
          l.children.forEach(walk);
          break;
      }
    };
    d.layers.forEach(walk);
  };
}

// ───── Timelines ────────────────────────────────────────────────────────────

/** Shortest duration that keeps every keyframe of `tl` inside the timeline. */
export function minTimelineDuration(tl: Timeline): number {
  let max = 0;
  for (const t of tl.tracks) for (const k of t.keyframes) max = Math.max(max, k.t);
  return Math.max(0.05, max);
}

/** Set a timeline's duration, never cutting off a keyframe. Returns the applied value. */
export function clampTimelineDuration(tl: Timeline, requested: number): number {
  return Math.max(minTimelineDuration(tl), requested);
}

/** Keyframes closer than this (seconds) count as "at the playhead". */
export const KEYFRAME_EPS = 1 / 120;

/**
 * Write `value` into the keyframe at `time` on the layer's `property` track
 * (creating it if missing), or update the existing one there. No-op when the
 * layer has no such track: auto-key only edits animated properties.
 */
export function upsertKeyframe(
  which: "in" | "out",
  layerId: string,
  property: Track["property"],
  time: number,
  value: number,
): Recipe {
  return (d) => {
    const track = d.timelines[which].tracks.find((t) => t.layerId === layerId && t.property === property);
    if (!track) return;
    const at = track.keyframes.find((k) => Math.abs(k.t - time) <= KEYFRAME_EPS);
    if (at) {
      at.value = value;
      return;
    }
    const before = [...track.keyframes].sort((a, b) => a.t - b.t).filter((k) => k.t < time).pop();
    track.keyframes.push({ t: time, value, easing: (before?.easing ?? "power2.out") as Keyframe["easing"] });
  };
}

export function hasTrack(t: Template, which: "in" | "out", layerId: string, property: Track["property"]): boolean {
  return t.timelines[which].tracks.some((tr) => tr.layerId === layerId && tr.property === property);
}

// ───── Animation presets ────────────────────────────────────────────────────

export type AnimationPreset =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-top"
  | "slide-bottom"
  | "wipe"
  | "scale-pop";

export const ANIMATION_PRESETS: { id: AnimationPreset; label: string }[] = [
  { id: "fade", label: "Fade" },
  { id: "slide-left", label: "Slide ←" },
  { id: "slide-right", label: "Slide →" },
  { id: "slide-top", label: "Slide ↑" },
  { id: "slide-bottom", label: "Slide ↓" },
  { id: "wipe", label: "Wipe" },
  { id: "scale-pop", label: "Pop" },
];

const PRESET_IN_S = 0.6;
const PRESET_OUT_S = 0.4;

/**
 * One-click in/out animation for a layer. The in animation ends at the
 * layer's design pose; the out animation starts there. x/y tracks are offsets
 * from the design position (the engine applies them as translate), so a slide
 * moves the layer fully off the canvas on that side. Replaces the layer's
 * existing tracks for the properties the preset uses, in that timeline only.
 * The timeline is lengthened if it's shorter than the preset.
 */
export function applyAnimationPreset(layerId: string, which: "in" | "out", preset: AnimationPreset): Recipe {
  return (d) => {
    const loc = locateLayer(d.layers, layerId);
    if (!loc) return;
    const l = loc.layer;
    const tr = l.transform;
    const tl = d.timelines[which];
    const span = which === "in" ? PRESET_IN_S : PRESET_OUT_S;
    if (tl.duration < span) tl.duration = span;
    const inE = "power3.out";
    const outE = "power2.in";
    const box = loc.parent?.transform.w !== undefined && loc.parent.transform.h !== undefined
      ? { w: loc.parent.transform.w, h: loc.parent.transform.h }
      : d.size;
    const w = tr.w ?? 0;
    const h = tr.h ?? 0;

    /** Keyframes from `from` to `to` (in) or design → `to` (out). */
    const ramp = (rest: number, away: number): Keyframe[] =>
      which === "in"
        ? [
            { t: 0, value: away, easing: inE },
            { t: span, value: rest, easing: inE },
          ]
        : [
            { t: 0, value: rest, easing: outE },
            { t: span, value: away, easing: outE },
          ];

    const tracks: Track[] = [];
    switch (preset) {
      case "fade":
        tracks.push({ layerId, property: "opacity", keyframes: ramp(tr.opacity, 0) });
        break;
      case "slide-left":
        tracks.push({ layerId, property: "x", keyframes: ramp(0, -(tr.x + w)) });
        break;
      case "slide-right":
        tracks.push({ layerId, property: "x", keyframes: ramp(0, box.w - tr.x) });
        break;
      case "slide-top":
        tracks.push({ layerId, property: "y", keyframes: ramp(0, -(tr.y + h)) });
        break;
      case "slide-bottom":
        tracks.push({ layerId, property: "y", keyframes: ramp(0, box.h - tr.y) });
        break;
      case "wipe":
        tracks.push({ layerId, property: "wipe", keyframes: ramp(1, 0) });
        break;
      case "scale-pop": {
        // Pop from the centre.
        tr.anchorX = 0.5;
        tr.anchorY = 0.5;
        const pop = (rest: number): Keyframe[] =>
          which === "in"
            ? [
                { t: 0, value: 0, easing: "power2.out" },
                { t: span * 0.7, value: rest * 1.08, easing: "power2.out" },
                { t: span, value: rest, easing: "power1.inOut" },
              ]
            : [
                { t: 0, value: rest, easing: "power1.inOut" },
                { t: span * 0.3, value: rest * 1.08, easing: "power1.inOut" },
                { t: span, value: 0, easing: "power2.in" },
              ];
        tracks.push({ layerId, property: "scaleX", keyframes: pop(tr.scaleX) });
        tracks.push({ layerId, property: "scaleY", keyframes: pop(tr.scaleY) });
        tracks.push({ layerId, property: "opacity", keyframes: ramp(tr.opacity, 0) });
        break;
      }
    }
    const props = new Set(tracks.map((t) => t.property));
    tl.tracks = tl.tracks.filter((t) => !(t.layerId === layerId && props.has(t.property)));
    tl.tracks.push(...tracks);
  };
}

// ───── Fonts ────────────────────────────────────────────────────────────────

/** Names of the text layers whose font family is `family`. */
export function fontUsage(t: Template, family: string): string[] {
  const names: string[] = [];
  const walk = (l: Layer) => {
    if (l.type === "text" && l.style.fontFamily === family) names.push(l.name);
    if (l.type === "group") l.children.forEach(walk);
  };
  t.layers.forEach(walk);
  return names;
}

export function removeTemplateFont(family: string): Recipe {
  return (d) => {
    d.fonts = d.fonts.filter((f) => f.family !== family);
  };
}

/**
 * One entry per family (case-insensitive), keeping the first. Older templates
 * can embed the same family twice; the duplicate adds nothing.
 */
export function dedupeFontFaces<F extends { family: string; src: string }>(fonts: F[]): F[] {
  const seen = new Set<string>();
  return fonts.filter((f) => {
    const k = f.family.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ───── New layers ───────────────────────────────────────────────────────────

/**
 * The part of the artboard the canvas currently shows, in artboard px. The
 * artboard is centred in the host, then panned by `pan` (screen px) and
 * scaled by `scale`. Falls back to the whole artboard if none of it is visible.
 */
export function visibleArtboardRect(
  host: { w: number; h: number },
  artboard: { w: number; h: number },
  pan: { x: number; y: number },
  scale: number,
): Rect {
  const whole = { x: 0, y: 0, w: artboard.w, h: artboard.h };
  if (!(scale > 0) || host.w <= 0 || host.h <= 0) return whole;
  const cx = artboard.w / 2 - pan.x / scale;
  const cy = artboard.h / 2 - pan.y / scale;
  const x0 = Math.max(0, cx - host.w / scale / 2);
  const x1 = Math.min(artboard.w, cx + host.w / scale / 2);
  const y0 = Math.max(0, cy - host.h / scale / 2);
  const y1 = Math.min(artboard.h, cy + host.h / scale / 2);
  if (x1 <= x0 || y1 <= y0) return whole;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where a new layer of `size` lands: centred in `view` (the visible artboard area), whole pixels. */
export function placementForNewLayer(
  view: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.round(view.x + (view.w - size.w) / 2),
    y: Math.round(view.y + (view.h - size.h) / 2),
  };
}
