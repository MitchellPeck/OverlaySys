"use client";

import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { Template } from "@overlaysys/core";

const HISTORY_LIMIT = 50;

type EditorState = {
  draft: Template | null;
  selectedLayerId: string | null;
  selectedKeyframe: { trackKey: string; index: number } | null; // trackKey = `${layerId}::${property}`
  activeTimeline: "in" | "out";
  scrubTime: number;
  playing: boolean;
  loop: boolean;
  dirty: boolean;
  history: Template[];
  redoStack: Template[];

  setDraft(t: Template | null): void;
  /** Apply a recipe and push the previous state to undo history. */
  commit(recipe: (d: Draft<Template>) => void): void;
  /** Apply a recipe without touching history. Used during drag/scrub. */
  applyLive(recipe: (d: Draft<Template>) => void): void;
  /** Snapshot the current draft into history without changing anything. Use at drag start. */
  pushHistory(): void;

  setSelectedLayer(id: string | null): void;
  setSelectedKeyframe(k: { trackKey: string; index: number } | null): void;
  setActiveTimeline(which: "in" | "out"): void;
  setScrubTime(t: number): void;
  setPlaying(p: boolean): void;
  setLoop(l: boolean): void;

  undo(): void;
  redo(): void;
  markSaved(): void;
};

export const useEditor = create<EditorState>((set, get) => ({
  draft: null,
  selectedLayerId: null,
  selectedKeyframe: null,
  activeTimeline: "in",
  scrubTime: 0,
  playing: false,
  loop: false,
  dirty: false,
  history: [],
  redoStack: [],

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
      selectedLayerId: null,
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
    set((s) => {
      const history = [...s.history, cur].slice(-HISTORY_LIMIT);
      return { draft: next, history, redoStack: [], dirty: true };
    });
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
    }));
  },

  setSelectedLayer(id) {
    set({ selectedLayerId: id, selectedKeyframe: null });
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
    const { draft, history, redoStack } = get();
    if (!draft || history.length === 0) return;
    const prev = history[history.length - 1]!;
    set({
      draft: prev,
      history: history.slice(0, -1),
      redoStack: [...redoStack, draft],
      dirty: true,
    });
  },
  redo() {
    const { draft, history, redoStack } = get();
    if (!draft || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    set({
      draft: next,
      history: [...history, draft],
      redoStack: redoStack.slice(0, -1),
      dirty: true,
    });
  },

  markSaved() {
    set({ dirty: false });
  },
}));
