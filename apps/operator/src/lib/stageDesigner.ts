import type { StageRect } from "@overlaysys/core";

/** Canvas size presets for the stage layout designer; anything else is "custom". */
export const STAGE_SIZE_PRESETS: { w: number; h: number }[] = [
  { w: 1920, h: 1080 },
  { w: 3840, h: 2160 },
  { w: 1920, h: 1200 },
  { w: 1600, h: 1200 },
];

/** `"WxH"` for a matching preset, otherwise `"custom"`. */
export function sizePresetKey(size: { w: number; h: number }): string {
  const p = STAGE_SIZE_PRESETS.find((s) => s.w === size.w && s.h === size.h);
  return p ? `${p.w}x${p.h}` : "custom";
}

export type StageEditorShortcut = "undo" | "redo" | "save" | "delete" | "duplicate";

type KeyLike = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** Page-level shortcuts. Callers skip this while an input has focus. Arrow nudges live in StageCanvas. */
export function stageEditorShortcut(e: KeyLike): StageEditorShortcut | null {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    if (e.code === "KeyZ") return e.shiftKey ? "redo" : "undo";
    if (e.code === "KeyS" && !e.shiftKey) return "save";
    if (e.code === "KeyD" && !e.shiftKey) return "duplicate";
    return null;
  }
  if (e.code === "Delete" || e.code === "Backspace" || e.key === "Delete" || e.key === "Backspace") return "delete";
  return null;
}

/**
 * Throttle: an idle call fires at once; calls inside the window collapse into
 * one trailing call with the latest arguments, so sends are at least `ms` apart.
 */
export function createTrailingThrottle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  function fire(args: A) {
    last = Date.now();
    fn(...args);
  }

  return {
    call(...args: A) {
      const wait = last + ms - Date.now();
      if (wait <= 0 && !timer) {
        fire(args);
        return;
      }
      pending = args;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const a = pending;
        pending = null;
        if (a) fire(a);
      }, Math.max(0, wait));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/** A w×h rect centered on `p`, shrunk to fit and kept inside the canvas. */
export function centeredRectAt(p: { x: number; y: number }, w: number, h: number, canvas: { w: number; h: number }): StageRect {
  const rw = Math.min(w, canvas.w);
  const rh = Math.min(h, canvas.h);
  const x = Math.max(0, Math.min(canvas.w - rw, p.x - rw / 2));
  const y = Math.max(0, Math.min(canvas.h - rh, p.y - rh / 2));
  return { x: Math.round(x), y: Math.round(y), w: rw, h: rh };
}
