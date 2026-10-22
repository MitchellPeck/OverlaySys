// The one confidence-monitor state shared by every stage channel: active
// sermon notes, point/scroll position and the booth message. Mutated only
// through dispatchStage (pure reducer in @overlaysys/core) and onRowTaken.

import {
  INITIAL_STAGE_STATE,
  reduceStageState,
  splitPoints,
  type NotesPoint,
  type RowSource,
  type SermonNotes,
  type StageAction,
  type StageState,
} from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "./shows";

type Listener = (s: StageState) => void;

let state: StageState = INITIAL_STAGE_STATE;
const listeners = new Set<Listener>();

export function getStageState(): StageState {
  return state;
}

export function subscribeStageState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function _resetForTest(): void {
  state = INITIAL_STAGE_STATE;
  listeners.clear();
}

/** The active notes document and its points, or null when none / deleted. */
export async function activeNotes(s: StageState = state): Promise<{ notes: SermonNotes; points: NotesPoint[] } | null> {
  if (!s.notes) return null;
  const show = await shows.getShow(s.notes.showId);
  const notes = show?.sermonNotes?.find((n) => n.id === s.notes!.notesId);
  return notes ? { notes, points: splitPoints(notes.body) } : null;
}

function commit(next: StageState): void {
  if (next === state) return;
  state = next;
  for (const l of [...listeners]) {
    try {
      l(state);
    } catch (err) {
      console.warn("[stageState] listener failed", err);
    }
  }
}

export async function dispatchStage(action: StageAction): Promise<void> {
  const count = action.type === "select" ? 0 : (await activeNotes())?.points.length ?? 0;
  commit(reduceStageState(state, action, count));
}

/** Called whenever a channel's liveRow is set. */
export async function onRowTaken(source: RowSource): Promise<void> {
  let next = state;
  if (next.notes && next.notes.showId !== source.showId) {
    next = reduceStageState(next, { type: "select", showId: source.showId, notesId: null }, 0);
  }
  const show = await shows.getShow(source.showId);
  const row = show?.rows.find((r) => r.id === source.rowId);
  if (row?.sermonNotesId) {
    next = reduceStageState(next, { type: "select", showId: source.showId, notesId: row.sermonNotesId }, 0);
  }
  commit(next);
}

export async function stageStateMessage(): Promise<ServerMessage> {
  const active = await activeNotes();
  const points = active?.points ?? [];
  const idx = Math.min(state.pointIdx, Math.max(0, points.length - 1));
  return {
    type: "stage_state",
    state,
    pointCount: points.length,
    title: active?.notes.title ?? null,
    pointHeading: points[idx]?.heading ?? null,
    nextHeading: points[idx + 1]?.heading ?? null,
  };
}
