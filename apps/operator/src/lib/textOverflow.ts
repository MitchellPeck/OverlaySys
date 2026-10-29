import type { Template } from "@overlaysys/core";

/**
 * Text-overflow warnings (WS2.13, D21: warnings only, no auto-shrink). The
 * Live item region measures a graphic's mounted thumbnail and reports fields
 * whose text doesn't fit its layer box.
 */

export type FieldMeasure = {
  key: string;
  label: string;
  text: string;
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
};

export type OverflowWarning = { key: string; label: string; shown: number; total: number; message: string };

/** Layout rounding: a box this many px over is still a fit. */
const SLACK = 1;

const ratio = (client: number, scroll: number) => (scroll > client + SLACK ? Math.min(1, client / scroll) : 1);

/**
 * Fields whose text overflows its box, with an estimate of how much shows:
 * shown = floor(total × min(1, clientW/scrollW) × min(1, clientH/scrollH)).
 * One entry per field (the worst of its layers).
 */
export function overflowSummary(m: FieldMeasure[]): OverflowWarning[] {
  const byKey = new Map<string, OverflowWarning>();
  for (const f of m) {
    const total = f.text.length;
    if (total === 0 || f.clientW <= 0 || f.clientH <= 0) continue;
    const r = ratio(f.clientW, f.scrollW) * ratio(f.clientH, f.scrollH);
    if (r >= 1) continue;
    const shown = Math.floor(total * r);
    const prev = byKey.get(f.key);
    if (prev && prev.shown <= shown) continue;
    byKey.set(f.key, {
      key: f.key,
      label: f.label,
      shown,
      total,
      message: `${f.label} doesn't fit: about ${shown} of ${total} characters shown`,
    });
  }
  return [...byKey.values()];
}

type Layer = Template["layers"][number];

function walkVisible(layers: Layer[], visit: (l: Layer) => void): void {
  for (const l of layers) {
    if (l.visible === false) continue;
    visit(l);
    if (l.type === "group") walkVisible(l.children, visit);
  }
}

/** Visible text layers bound to a field, in paint order. */
export function textFieldLayers(t: Pick<Template, "layers">): { layerId: string; fieldKey: string }[] {
  const out: { layerId: string; fieldKey: string }[] = [];
  walkVisible(t.layers ?? [], (l) => {
    if (l.type === "text" && typeof l.content !== "string") out.push({ layerId: l.id, fieldKey: l.content.fieldKey });
  });
  return out;
}

type Box = { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };

/**
 * Measure each field-bound text layer of a mounted template. `lookup` returns
 * the layer's box element and its text span (the engine renders a text layer
 * as `<div data-layer-id><span/></div>`), or null when it isn't in the DOM.
 */
export function measureTextLayers(
  t: Pick<Template, "layers" | "fields">,
  data: Record<string, string>,
  lookup: (layerId: string) => { box: Box; span: Box | null } | null,
): FieldMeasure[] {
  const labels = new Map((t.fields ?? []).map((f) => [f.key, f.label]));
  const out: FieldMeasure[] = [];
  for (const { layerId, fieldKey } of textFieldLayers(t)) {
    const el = lookup(layerId);
    if (!el) continue;
    const span = el.span ?? el.box;
    out.push({
      key: fieldKey,
      label: labels.get(fieldKey) ?? fieldKey,
      text: data[fieldKey] ?? "",
      scrollW: Math.max(el.box.scrollWidth, span.scrollWidth),
      clientW: el.box.clientWidth,
      scrollH: Math.max(el.box.scrollHeight, span.scrollHeight),
      clientH: el.box.clientHeight,
    });
  }
  return out;
}
