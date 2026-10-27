"use client";

import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { StageLayout, StageSampleKind } from "@overlaysys/core";

const HISTORY_LIMIT = 50;

type StageEditorState = {
  draft: StageLayout | null;
  selectedIds: string[];
  sampleKind: StageSampleKind;
  dirty: boolean;
  history: StageLayout[];
  redoStack: StageLayout[];
  /**
   * Set by pushHistory: what the drag's snapshot displaced, so cancelDrag can
   * drop the entry instead of leaving a no-op undo step. Cleared by any
   * other history-changing action.
   */
  dragUndo: { dirty: boolean; history: StageLayout[]; redoStack: StageLayout[] } | null;

  setDraft(l: StageLayout | null): void;
  /** Apply a recipe and push the previous state to undo history. */
  commit(recipe: (d: Draft<StageLayout>) => void): void;
  /** Apply a recipe without touching history. Used during drag. */
  applyLive(recipe: (d: Draft<StageLayout>) => void): void;
  /** Snapshot the current draft into history. Use once at drag start. */
  pushHistory(): void;
  /** A drag was cancelled after pushHistory: pop its entry and restore the pre-drag draft. */
  cancelDrag(): void;
  undo(): void;
  redo(): void;
  markSaved(): void;
  select(ids: string[], additive?: boolean): void;
  setSampleKind(k: StageSampleKind): void;
};

function prune(ids: string[], layout: StageLayout): string[] {
  const live = new Set(layout.widgets.map((w) => w.id));
  const next = ids.filter((id) => live.has(id));
  return next.length === ids.length ? ids : next;
}

export const useStageEditor = create<StageEditorState>((set, get) => ({
  draft: null,
  selectedIds: [],
  sampleKind: "song",
  dirty: false,
  history: [],
  redoStack: [],
  dragUndo: null,

  setDraft(l) {
    set({ draft: l, dirty: false, history: [], redoStack: [], selectedIds: [], dragUndo: null });
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
      selectedIds: prune(s.selectedIds, next),
      dragUndo: null,
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
    const { history, dragUndo, selectedIds } = get();
    if (!dragUndo || history.length === 0) return;
    const prev = history[history.length - 1]!;
    set({
      draft: prev,
      history: dragUndo.history,
      redoStack: dragUndo.redoStack,
      dirty: dragUndo.dirty,
      selectedIds: prune(selectedIds, prev),
      dragUndo: null,
    });
  },

  undo() {
    const { draft, history, redoStack, selectedIds } = get();
    if (!draft || history.length === 0) return;
    const prev = history[history.length - 1]!;
    set({
      draft: prev,
      history: history.slice(0, -1),
      redoStack: [...redoStack, draft],
      dirty: true,
      selectedIds: prune(selectedIds, prev),
      dragUndo: null,
    });
  },

  redo() {
    const { draft, history, redoStack, selectedIds } = get();
    if (!draft || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    set({
      draft: next,
      history: [...history, draft],
      redoStack: redoStack.slice(0, -1),
      dirty: true,
      selectedIds: prune(selectedIds, next),
      dragUndo: null,
    });
  },

  markSaved() {
    set({ dirty: false });
  },

  select(ids, additive) {
    if (!additive) {
      set({ selectedIds: ids });
      return;
    }
    const next = [...get().selectedIds];
    for (const id of ids) {
      const i = next.indexOf(id);
      if (i >= 0) next.splice(i, 1);
      else next.push(id);
    }
    set({ selectedIds: next });
  },

  setSampleKind(k) {
    set({ sampleKind: k });
  },
}));
