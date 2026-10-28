import type { StageLayout, StageRect } from "@overlaysys/core";

/** Key-order-insensitive deep equality; a key holding `undefined` counts as absent. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** Same entity apart from key order and `updatedAt` (the server re-parses and stamps on save). */
export function entitiesEqualIgnoringStamp<T extends { updatedAt?: string }>(a: T, b: T): boolean {
  return deepEqual({ ...a, updatedAt: undefined }, { ...b, updatedAt: undefined });
}

/** Same layout apart from key order and `updatedAt` (the server re-parses and stamps on save). */
export function stageLayoutsEqual(a: StageLayout, b: StageLayout): boolean {
  return entitiesEqualIgnoringStamp(a, b);
}

/**
 * Whether an incoming copy of the open entity (a server broadcast) should
 * replace the draft, which resets undo history and selection. Never while
 * dirty; never for the echo of our own just-acked save; never when it only
 * differs in key order or `updatedAt`.
 */
export function shouldAdoptIncoming<T extends { id: string; updatedAt?: string }>(
  state: { draft: T | null; dirty: boolean; awaitingEchoId: string | null },
  incoming: T,
): boolean {
  if (state.dirty) return false;
  if (state.awaitingEchoId === incoming.id) return false;
  if (!state.draft || state.draft.id !== incoming.id) return true;
  return !entitiesEqualIgnoringStamp(state.draft, incoming);
}

/** `shouldAdoptIncoming` for stage layouts. */
export function shouldAdoptIncomingLayout(
  state: { draft: StageLayout | null; dirty: boolean; awaitingEchoId: string | null },
  incoming: StageLayout,
): boolean {
  return shouldAdoptIncoming(state, incoming);
}

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

export type StageEditorShortcut =
  | "undo"
  | "redo"
  | "save"
  | "delete"
  | "duplicate"
  | "forward"
  | "backward"
  | "front"
  | "back";

type KeyLike = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** Page-level shortcuts. Callers skip this while an input has focus. Arrow nudges live in StageCanvas. */
export function stageEditorShortcut(e: KeyLike): StageEditorShortcut | null {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    if (e.code === "KeyZ") return e.shiftKey ? "redo" : "undo";
    if (e.code === "KeyS" && !e.shiftKey) return "save";
    if (e.code === "KeyD" && !e.shiftKey) return "duplicate";
    // ⌘] / ⌘[ step the z-order; with Shift, all the way to front / back.
    if (e.code === "BracketRight") return e.shiftKey ? "front" : "forward";
    if (e.code === "BracketLeft") return e.shiftKey ? "back" : "backward";
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

/**
 * Whether a click on an `<a href>` should ask before leaving a dirty editor.
 * Only same-origin navigations that would replace this page in-app count:
 * modified / middle clicks, other targets and downloads open elsewhere, other
 * origins unload the page (beforeunload covers them), and a hash-only change
 * stays on the page.
 */
export function shouldConfirmLinkNavigation(c: {
  dirty: boolean;
  href: string;
  currentHref: string;
  button: number;
  /** Any of meta / ctrl / shift / alt held. */
  modified: boolean;
  defaultPrevented: boolean;
  target: string | null;
  download: boolean;
}): boolean {
  if (!c.dirty || c.defaultPrevented || c.button !== 0 || c.modified || c.download) return false;
  if (c.target && c.target !== "_self") return false;
  let to: URL;
  let from: URL;
  try {
    from = new URL(c.currentHref);
    to = new URL(c.href, from);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  return !(to.pathname === from.pathname && to.search === from.search);
}

/** A w×h rect centered on `p`, shrunk to fit and kept inside the canvas. */
export function centeredRectAt(p: { x: number; y: number }, w: number, h: number, canvas: { w: number; h: number }): StageRect {
  const rw = Math.min(w, canvas.w);
  const rh = Math.min(h, canvas.h);
  const x = Math.max(0, Math.min(canvas.w - rw, p.x - rw / 2));
  const y = Math.max(0, Math.min(canvas.h - rh, p.y - rh / 2));
  return { x: Math.round(x), y: Math.round(y), w: rw, h: rh };
}

/**
 * A store transition that is a local edit: the draft object changed and the
 * result is dirty. Covers edits made while already dirty (e.g. while a save
 * was in flight), which a clean→dirty watch misses. Adopting a server copy
 * (setDraft, clean) is not an edit.
 */
export function isLocalDraftEdit<T>(
  prev: { draft: T | null; dirty: boolean },
  next: { draft: T | null; dirty: boolean },
): boolean {
  return next.draft !== prev.draft && next.draft !== null && next.dirty;
}

/**
 * Back/forward guard. While dirty the page pushes a same-URL sentinel entry
 * and remembers its href (`armedHref`). A popstate that leaves us at that
 * href, not standing on a sentinel, means ours was just popped (it is the top
 * entry, so only Back can pop it). Anything else (another URL, e.g. a stale
 * sentinel left at a layout we have since moved away from, or landing ON a
 * sentinel) is not ours. "back": go on to where the user was heading;
 * "repush": they cancelled, re-arm. `confirm` is only called when dirty.
 */
export function sentinelPopAction(c: {
  armedHref: string | null;
  currentHref: string;
  /** history.state carries the sentinel flag: we landed on one. */
  onSentinel: boolean;
  dirty: boolean;
  confirm: () => boolean;
}): "none" | "back" | "repush" {
  if (!c.armedHref || c.onSentinel || c.currentHref !== c.armedHref) return "none";
  if (!c.dirty) return "back";
  return c.confirm() ? "back" : "repush";
}

/**
 * After a save (draft clean) remove our sentinel so none is left behind: only
 * when we are still standing on it at the armed href.
 */
export function shouldDisarmSentinel(c: {
  armedHref: string | null;
  currentHref: string;
  onSentinel: boolean;
  dirty: boolean;
}): boolean {
  return !c.dirty && !!c.armedHref && c.onSentinel && c.currentHref === c.armedHref;
}
