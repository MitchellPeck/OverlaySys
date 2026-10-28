import { current, isDraft, type Draft } from "immer";
import {
  NEW_WIDGET_DEFAULTS,
  StageWidgetSchema,
  type StageLayout,
  type StageRect,
  type StageWidget,
  type StageWidgetKind,
} from "@overlaysys/core";
import { alignRects, applyStageWidgetPatch, distributeRects, moveRect, type AlignMode, type StageWidgetPatch } from "@overlaysys/editor-kit";

type Recipe = (d: Draft<StageLayout>) => void;

const NEW_W = 480;
const NEW_H = 200;
const GRID = 40;

function unlocked(d: Draft<StageLayout>, ids: string[]): Draft<StageWidget>[] {
  return d.widgets.filter((w) => ids.includes(w.id) && !w.locked);
}

function overlaps(a: StageRect, b: StageRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Default rect size / style / props for a new widget of `kind`, from NEW_WIDGET_DEFAULTS. */
function newWidgetOf(kind: StageWidgetKind, id: string, size: { w: number; h: number }): { widget: StageWidget; w: number; h: number } {
  const def = NEW_WIDGET_DEFAULTS[kind];
  const w = Math.min(def?.rect?.w ?? NEW_W, size.w);
  const h = Math.min(def?.rect?.h ?? NEW_H, size.h);
  const widget = StageWidgetSchema.parse({
    id,
    kind,
    rect: { x: 0, y: 0, w, h },
    ...(def?.style ? { style: def.style } : {}),
    ...(def?.props ? { props: def.props } : {}),
  });
  return { widget, w, h };
}

/**
 * Pure placement: the first free slot on a 40 px grid (left to right, top to
 * bottom) for a rect of the widget's default size. If the layout has no free
 * slot, cascade +40/+40 from the last widget, clamped inside the layout.
 * `viewport` (optional) limits the scan to that region of the layout.
 */
export function placeNewWidget(
  layout: StageLayout,
  w: number,
  h: number,
  viewport?: Partial<StageRect>,
): { x: number; y: number } {
  const x0 = Math.max(0, viewport?.x ?? 0);
  const y0 = Math.max(0, viewport?.y ?? 0);
  const x1 = Math.min(layout.size.w, x0 + (viewport?.w ?? layout.size.w));
  const y1 = Math.min(layout.size.h, y0 + (viewport?.h ?? layout.size.h));
  for (let y = y0; y + h <= y1; y += GRID) {
    for (let x = x0; x + w <= x1; x += GRID) {
      const r = { x, y, w, h };
      if (!layout.widgets.some((o) => overlaps(r, o.rect))) return { x, y };
    }
  }
  const last = layout.widgets.at(-1);
  const x = Math.max(0, Math.min((last?.rect.x ?? 0) + GRID, layout.size.w - w));
  const y = Math.max(0, Math.min((last?.rect.y ?? 0) + GRID, layout.size.h - h));
  return { x, y };
}

function randomId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Adds a widget of `kind` at the first free slot (see `placeNewWidget`), on top. Returns the new layout and the widget id. */
export function addWidget(
  layout: StageLayout,
  kind: StageWidgetKind,
  viewport?: Partial<StageRect>,
  id: string = randomId(kind),
): { layout: StageLayout; id: string } {
  const { widget, w, h } = newWidgetOf(kind, id, layout.size);
  const pos = placeNewWidget(layout, w, h, viewport);
  const placed = { ...widget, rect: { ...widget.rect, ...pos } } as StageWidget;
  return { layout: { ...layout, widgets: [...layout.widgets, placed] }, id };
}

/** Recipe form of `addWidget` for the editor store's `commit`. */
export function addWidgetOp(kind: StageWidgetKind, id: string, viewport?: Partial<StageRect>): Recipe {
  return (d) => {
    const base = (isDraft(d) ? current(d) : d) as StageLayout;
    const { layout } = addWidget(base, kind, viewport, id);
    d.widgets.push(layout.widgets.at(-1) as Draft<StageWidget>);
  };
}

export function removeWidgets(ids: string[]): Recipe {
  return (d) => {
    d.widgets = d.widgets.filter((w) => !ids.includes(w.id));
  };
}

/** Copies are appended on top, offset by +20/+20, and always unlocked (a locked copy couldn't be dragged off its original). */
export function duplicateWidgets(ids: string[], newId: (old: string) => string): Recipe {
  return (d) => {
    const copies: StageWidget[] = [];
    for (const w of d.widgets) {
      if (!ids.includes(w.id)) continue;
      const c = JSON.parse(JSON.stringify(w)) as StageWidget;
      c.id = newId(w.id);
      c.rect = moveRect(w.rect, 20, 20);
      delete c.locked;
      copies.push(c);
    }
    d.widgets.push(...(copies as Draft<StageWidget>[]));
  };
}

export function moveWidgetZ(id: string, to: "up" | "down" | "top" | "bottom"): Recipe {
  return (d) => {
    const i = d.widgets.findIndex((w) => w.id === id);
    if (i < 0) return;
    const last = d.widgets.length - 1;
    const j = to === "top" ? last : to === "bottom" ? 0 : to === "up" ? Math.min(i + 1, last) : Math.max(i - 1, 0);
    if (j === i) return;
    const [w] = d.widgets.splice(i, 1);
    d.widgets.splice(j, 0, w!);
  };
}

export function toggleHidden(id: string): Recipe {
  return (d) => {
    const w = d.widgets.find((x) => x.id === id);
    if (w) w.hidden = !w.hidden;
  };
}

export function toggleLocked(id: string): Recipe {
  return (d) => {
    const w = d.widgets.find((x) => x.id === id);
    if (w) w.locked = !w.locked;
  };
}

export function nudgeWidgets(ids: string[], dx: number, dy: number): Recipe {
  return (d) => {
    for (const w of unlocked(d, ids)) w.rect = moveRect(w.rect, dx, dy);
  };
}

/**
 * Aligns the unlocked widgets among `ids`. With a single unlocked widget (even
 * if locked ones are selected too) it aligns to the canvas, like `alignRects`.
 */
export function alignWidgets(ids: string[], mode: AlignMode): Recipe {
  return (d) => {
    const ws = unlocked(d, ids);
    if (ws.length === 0) return;
    const out = alignRects(ws.map((w) => w.rect), mode, d.size);
    ws.forEach((w, i) => (w.rect = out[i]!));
  };
}

export function distributeWidgets(ids: string[], axis: "x" | "y"): Recipe {
  return (d) => {
    const ws = unlocked(d, ids);
    if (ws.length < 3) return;
    const out = distributeRects(ws.map((w) => w.rect), axis);
    ws.forEach((w, i) => (w.rect = out[i]!));
  };
}

export type WidgetPatch = StageWidgetPatch;

/** Delegates to the shared `applyStageWidgetPatch` (partial rect merge, 20px clamp, undefined removes a key). */
export function patchWidget(id: string, patch: WidgetPatch): Recipe {
  return (d) => {
    const i = d.widgets.findIndex((x) => x.id === id);
    if (i < 0) return;
    const w = d.widgets[i]!;
    d.widgets[i] = applyStageWidgetPatch((isDraft(w) ? current(w) : w) as StageWidget, patch) as Draft<StageWidget>;
  };
}
