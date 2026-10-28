import type { Field, Layer, Template } from "@overlaysys/core";

/**
 * What an edit-mode patch must do to turn the DOM built for `prev` into the
 * one for `next`: restyle `layers` (their own props changed) and rebuild the
 * GSAP timelines if `timelines` changed. `null` means the change is
 * structural and the template has to be remounted.
 */
export type PatchPlan = { layers: Layer[]; timelines: boolean };

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function fieldShape(fields: Field[]): string {
  return JSON.stringify(fields.map((f) => [f.key, f.type, f.timeMode, f.timeFormat]));
}

function bindingKey(v: string | { fieldKey: string }): string | null {
  return typeof v === "string" ? null : v.fieldKey;
}

/** Own props of a layer: a group's children are compared separately. */
function ownProps(l: Layer): unknown {
  return l.type === "group" ? { ...l, children: undefined } : l;
}

/** Props the engine can't patch in place on a video (it owns playback state). */
function videoCore(l: Layer): unknown {
  if (l.type !== "video") return null;
  const { transform: _t, visible: _v, name: _n, locked: _l, ...rest } = l;
  return rest;
}

export function planTemplatePatch(prev: Template, next: Template): PatchPlan | null {
  if (prev === next) return { layers: [], timelines: false };
  if (prev.id !== next.id || !same(prev.size, next.size)) return null;
  // Fonts are registered at mount.
  if (prev.fonts !== next.fonts && !same(prev.fonts, next.fonts)) return null;
  if (prev.fields !== next.fields && fieldShape(prev.fields) !== fieldShape(next.fields)) return null;

  const changed: Layer[] = [];
  const changedGeometry = new Set<string>();
  let structural = false;

  function walk(a: Layer[], b: Layer[]): void {
    if (structural) return;
    if (a.length !== b.length) {
      structural = true;
      return;
    }
    for (let i = 0; i < a.length && !structural; i++) {
      const pa = a[i]!;
      const pb = b[i]!;
      if (pa === pb) continue;
      if (pa.id !== pb.id || pa.type !== pb.type || !same(pa.clipBy, pb.clipBy)) {
        structural = true;
        return;
      }
      if (pa.type === "video" && !same(videoCore(pa), videoCore(pb))) {
        structural = true;
        return;
      }
      if (pa.type === "text" && pb.type === "text" && bindingKey(pa.content) !== bindingKey(pb.content)) {
        // Time-field bindings are registered at build time.
        structural = true;
        return;
      }
      if (pa.type === "group" && pb.type === "group") {
        walk(pa.children, pb.children);
        if (!same(ownProps(pa), ownProps(pb))) changed.push(pb);
      } else if (!same(pa, pb)) {
        changed.push(pb);
      }
      if (!same(pa.transform, pb.transform)) changedGeometry.add(pb.id);
    }
  }
  walk(prev.layers, next.layers);
  if (structural) return null;

  // A clipBy wrapper's clip-path is computed from its reference's box at build.
  if (changedGeometry.size > 0) {
    let refMoved = false;
    const visit = (l: Layer) => {
      if (l.clipBy && changedGeometry.has(l.clipBy.layerId)) refMoved = true;
      if (l.type === "group") l.children.forEach(visit);
    };
    next.layers.forEach(visit);
    if (refMoved) return null;
  }

  return { layers: changed, timelines: prev.timelines !== next.timelines && !same(prev.timelines, next.timelines) };
}
