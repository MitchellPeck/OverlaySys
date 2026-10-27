"use client";

import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { StageLayout } from "@overlaysys/core";

const HISTORY_LIMIT = 50;

export type StageSampleKind =
  | "song"
  | "scripture"
  | "sermon"
  | "videoTimer"
  | "message"
  | "itemCountdown"
  | "pcoLive";

type StageEditorState = {
  draft: StageLayout | null;
  selectedIds: string[];
  sampleKind: StageSampleKind;
  dirty: boolean;
  history: StageLayout[];
  redoStack: StageLayout[];

  setDraft(l: StageLayout | null): void;
  /** Apply a recipe and push the previous state to undo history. */
  commit(recipe: (d: Draft<StageLayout>) => void): void;
  /** Apply a recipe without touching history. Used during drag. */
  applyLive(recipe: (d: Draft<StageLayout>) => void): void;
  /** Snapshot the current draft into history. Use once at drag start. */
  pushHistory(): void;
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

  setDraft(l) {
    set({ draft: l, dirty: false, history: [], redoStack: [], selectedIds: [] });
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
    set((s) => ({ history: [...s.history, cur].slice(-HISTORY_LIMIT), redoStack: [] }));
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
