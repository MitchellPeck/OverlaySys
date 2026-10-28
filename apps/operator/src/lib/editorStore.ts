"use client";

import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { Layer, Template } from "@overlaysys/core";

const HISTORY_LIMIT = 50;

type EditorState = {
  draft: Template | null;
  /** Primary selection (the last layer selected), used by the inspector and timeline. */
  selectedLayerId: string | null;
  /** Every selected layer, in selection order. The primary is the last one. */
  selectedLayerIds: string[];
  selectedKeyframe: { trackKey: string; index: number } | null; // trackKey = `${layerId}::${property}`
  activeTimeline: "in" | "out";
  scrubTime: number;
  playing: boolean;
  loop: boolean;
  dirty: boolean;
  history: Template[];
  redoStack: Template[];
  /**
   * Set by pushHistory: what the drag's snapshot displaced, so cancelDrag can
   * drop the entry instead of leaving a no-op undo step. Cleared by any
   * other history-changing action.
   */
  dragUndo: { dirty: boolean; history: Template[]; redoStack: Template[] } | null;

  /** Load a template (or clear). Resets history, selection and the playhead. */
  setDraft(t: Template | null): void;
  /** Apply a recipe and push the previous state to undo history. */
  commit(recipe: (d: Draft<Template>) => void): void;
  /** Apply a recipe without touching history. Used during drag/scrub. */
  applyLive(recipe: (d: Draft<Template>) => void): void;
  /** Snapshot the current draft into history without changing anything. Use once, just before a drag's first change. */
  pushHistory(): void;
  /** A drag was cancelled after pushHistory: pop its entry and restore the pre-drag draft. */
  cancelDrag(): void;

  setSelectedLayer(id: string | null): void;
  /** Replace the selection, or (additive) toggle each id in or out of it. */
  selectLayers(ids: string[], additive?: boolean): void;
  setSelectedKeyframe(k: { trackKey: string; index: number } | null): void;
  setActiveTimeline(which: "in" | "out"): void;
  setScrubTime(t: number): void;
  setPlaying(p: boolean): void;
  setLoop(l: boolean): void;

  undo(): void;
  redo(): void;
  markSaved(): void;
};

function allLayerIds(layers: Layer[], out = new Set<string>()): Set<string> {
  for (const l of layers) {
    out.add(l.id);
    if (l.type === "group") allLayerIds(l.children, out);
  }
  return out;
}

/** Drop selected ids that no longer exist in `t`; same array when nothing changed. */
function prune(ids: string[], t: Template): string[] {
  const live = allLayerIds(t.layers);
  const next = ids.filter((id) => live.has(id));
  return next.length === ids.length ? ids : next;
}

function selection(ids: string[]): { selectedLayerIds: string[]; selectedLayerId: string | null } {
  return { selectedLayerIds: ids, selectedLayerId: ids[ids.length - 1] ?? null };
}

/** Selection fields after `next` replaced the draft; keyframe selection kept only if its track survives. */
function afterDraftChange(s: EditorState, next: Template) {
  const ids = prune(s.selectedLayerIds, next);
  const sel = ids === s.selectedLayerIds ? {} : selection(ids);
  const kf = s.selectedKeyframe;
  const keepKf =
    kf &&
    next.timelines[s.activeTimeline].tracks.some(
      (t) => `${t.layerId}::${t.property}` === kf.trackKey && kf.index < t.keyframes.length,
    );
  return { ...sel, selectedKeyframe: keepKf ? kf : null };
}

export const useEditor = create<EditorState>((set, get) => ({
  draft: null,
  selectedLayerId: null,
  selectedLayerIds: [],
  selectedKeyframe: null,
  activeTimeline: "in",
  scrubTime: 0,
  playing: false,
  loop: false,
  dirty: false,
  history: [],
  redoStack: [],
  dragUndo: null,

  setDraft(t) {
    // Land the playhead on the "design pose" so what the author sees on open
    // matches the on-air rest state: end of in-timeline for "in", start of
    // out-timeline for "out". Default the active timeline to "in".
    const initialScrub = t ? t.timelines.in.duration : 0;
    set({
      draft: t,
      dirty: false,
      history: [],
      redoStack: [],
      dragUndo: null,
      ...selection([]),
      selectedKeyframe: null,
      activeTimeline: "in",
      scrubTime: initialScrub,
    });
  },

  commit(recipe) {
    const cur = get().draft;
    if (!cur) return;
    const next = produce(cur, recipe);
    if (next === cur) return; // no-op; don't pollute history
    set((s) => ({
      draft: next,
      history: [...s.history, cur].slice(-HISTORY_LIMIT),
      redoStack: [],
      dirty: true,
      dragUndo: null,
      ...afterDraftChange(s, next),
    }));
  },

  applyLive(recipe) {
    const cur = get().draft;
    if (!cur) return;
    const next = produce(cur, recipe);
    if (next === cur) return;
    set({ draft: next, dirty: true });
  },

  pushHistory() {
    const cur = get().draft;
    if (!cur) return;
    set((s) => ({
      history: [...s.history, cur].slice(-HISTORY_LIMIT),
      redoStack: [],
      dragUndo: { dirty: s.dirty, history: s.history, redoStack: s.redoStack },
    }));
  },

  cancelDrag() {
    const s = get();
    if (!s.dragUndo || s.history.length === 0) return;
    const prev = s.history[s.history.length - 1]!;
    set({
      draft: prev,
      history: s.dragUndo.history,
      redoStack: s.dragUndo.redoStack,
      dirty: s.dragUndo.dirty,
      dragUndo: null,
      ...afterDraftChange(s, prev),
    });
  },

  setSelectedLayer(id) {
    set({ ...selection(id ? [id] : []), selectedKeyframe: null });
  },
  selectLayers(ids, additive) {
    if (!additive) {
      set({ ...selection([...ids]), selectedKeyframe: null });
      return;
    }
    const next = [...get().selectedLayerIds];
    for (const id of ids) {
      const i = next.indexOf(id);
      if (i >= 0) next.splice(i, 1);
      else next.push(id);
    }
    set({ ...selection(next), selectedKeyframe: null });
  },
  setSelectedKeyframe(k) {
    set({ selectedKeyframe: k });
  },
  setActiveTimeline(which) {
    // Land on the design-pose end of whichever timeline becomes active:
    // - in: end of in (design pose at rest)
    // - out: start of out (design pose, before the out animation runs)
    const cur = get().draft;
    const time = which === "in" ? (cur?.timelines.in.duration ?? 0) : 0;
    set({ activeTimeline: which, scrubTime: time, selectedKeyframe: null });
  },
  setScrubTime(t) {
    set({ scrubTime: t });
  },
  setPlaying(p) {
    set({ playing: p });
  },
  setLoop(l) {
    set({ loop: l });
  },

  undo() {
    const s = get();
    if (!s.draft || s.history.length === 0) return;
    const prev = s.history[s.history.length - 1]!;
    set({
      draft: prev,
      history: s.history.slice(0, -1),
      redoStack: [...s.redoStack, s.draft],
      dirty: true,
      dragUndo: null,
      ...afterDraftChange(s, prev),
    });
  },
  redo() {
    const s = get();
    if (!s.draft || s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1]!;
    set({
      draft: next,
      history: [...s.history, s.draft],
      redoStack: s.redoStack.slice(0, -1),
      dirty: true,
      dragUndo: null,
      ...afterDraftChange(s, next),
    });
  },

  markSaved() {
    set({ dirty: false });
  },
}));
