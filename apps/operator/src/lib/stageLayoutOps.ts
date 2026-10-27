import type { Draft } from "immer";
import {
  defaultStageWidget,
  type StageLayout,
  type StageRect,
  type StageWidget,
  type StageWidgetKind,
} from "@overlaysys/core";
import { alignRects, distributeRects, moveRect, type AlignMode } from "@overlaysys/editor-kit";

type Recipe = (d: Draft<StageLayout>) => void;

const NEW_W = 480;
const NEW_H = 200;

function unlocked(d: Draft<StageLayout>, ids: string[]): Draft<StageWidget>[] {
  return d.widgets.filter((w) => ids.includes(w.id) && !w.locked);
}

/** New 480x200 widget, centered on the canvas (clamped inside it), on top. */
export function addWidget(kind: StageWidgetKind, id: string): Recipe {
  return (d) => {
    const w = Math.min(NEW_W, d.size.w);
    const h = Math.min(NEW_H, d.size.h);
    const rect: StageRect = { x: (d.size.w - w) / 2, y: (d.size.h - h) / 2, w, h };
    d.widgets.push(defaultStageWidget(kind, id, rect) as Draft<StageWidget>);
  };
}

export function removeWidgets(ids: string[]): Recipe {
  return (d) => {
    d.widgets = d.widgets.filter((w) => !ids.includes(w.id));
  };
}

/** Copies are appended on top, offset by +20/+20. */
export function duplicateWidgets(ids: string[], newId: (old: string) => string): Recipe {
  return (d) => {
    const copies: StageWidget[] = [];
    for (const w of d.widgets) {
      if (!ids.includes(w.id)) continue;
      const c = JSON.parse(JSON.stringify(w)) as StageWidget;
      c.id = newId(w.id);
      c.rect = moveRect(w.rect, 20, 20);
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

export type WidgetPatch = {
  rect?: StageRect;
  style?: Partial<StageWidget["style"]>;
  props?: Record<string, unknown>;
};

/** Shallow-merges `style` and `props`; `rect` replaces. */
export function patchWidget(id: string, patch: WidgetPatch): Recipe {
  return (d) => {
    const w = d.widgets.find((x) => x.id === id);
    if (!w) return;
    if (patch.rect) w.rect = patch.rect;
    if (patch.style) w.style = { ...w.style, ...patch.style };
    if (patch.props) (w as { props: object }).props = { ...w.props, ...patch.props };
  };
}
