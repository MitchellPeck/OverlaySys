// PCO Services Live sync: polls the Live state of the show's Planning Center
// plan, exposes it as a StageServiceView for confidence monitors and drives the
// current-item timer (source "pco") while the service is live. Read-only and
// runtime only: off by default, a server restart turns it off.

import { CURRENT_ITEM_TIMER_ID, mapPcoLive, type StageServiceView } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "../shows";
import * as timers from "../timers";
import { createPcoClient, PcoAuthError, type PcoClient } from "./pcoClient";
import { getPcoAuthorization } from "./pcoTokens";

export const POLL_MS = 5000;
export const MAX_BACKOFF_MS = 60_000;

type Status = "idle" | "live" | "notStarted" | "ended" | "error";

interface SyncState {
  enabled: boolean;
  showId: string | null;
  status: Status;
  error?: string;
  lastPolledAt: number | null;
  view: StageServiceView | null;
}

const IDLE: SyncState = { enabled: false, showId: null, status: "idle", lastPolledAt: null, view: null };

let state: SyncState = IDLE;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every start/stop so an in-flight poll from an old run is ignored. */
let generation = 0;
const listeners = new Set<() => void>();

function registerDriver(): void {
  timers.setItemTimerDriver(() => state.enabled && state.view?.status === "live");
}
registerDriver();

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch (err) {
      console.warn("[pcoLiveSync] listener failed", err);
    }
  }
}

export function subscribeLiveSync(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getServiceView(): StageServiceView | null {
  return state.enabled ? state.view : null;
}

export function getLiveSyncShowId(): string | null {
  return state.enabled ? state.showId : null;
}

export function liveSyncStateMessage(): ServerMessage {
  return {
    type: "pco_live_state",
    enabled: state.enabled,
    showId: state.showId,
    status: state.status,
    ...(state.error !== undefined ? { error: state.error } : {}),
    lastPolledAt: state.lastPolledAt,
    service: getServiceView(),
  };
}

function cancelLoop(): void {
  generation++;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function clearPcoItemTimer(): void {
  timers.dispatchTimers({ type: "clearItem", source: "pco" });
}

/** The most common (serviceTypeId, planId) among the rows; ties → the first row's. */
function pickPlan(rows: { sourceRef?: { serviceTypeId: string; planId: string } }[]) {
  const counts = new Map<string, { serviceTypeId: string; planId: string; n: number }>();
  for (const r of rows) {
    if (!r.sourceRef) continue;
    const { serviceTypeId, planId } = r.sourceRef;
    const key = JSON.stringify([serviceTypeId, planId]);
    const c = counts.get(key) ?? { serviceTypeId, planId, n: 0 };
    c.n++;
    counts.set(key, c);
  }
  let best: { serviceTypeId: string; planId: string; n: number } | null = null;
  // Map iteration follows first appearance, so a strict > keeps the earliest on ties.
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best;
}

function driveItemTimer(view: StageServiceView, now: number): void {
  const cur = view.current;
  if (view.status === "live" && cur && cur.lengthSec) {
    const durationMs = cur.lengthSec * 1000;
    const anchor = cur.startedAt + durationMs;
    const existing = timers.getTimers().find((t) => t.id === CURRENT_ITEM_TIMER_ID);
    if (existing && existing.source === "pco" && existing.rowId === cur.id && existing.anchor === anchor) return;
    timers.dispatchTimers(
      { type: "setItem", source: "pco", rowId: cur.id, label: cur.title, anchor, durationMs, overtime: true },
      now,
    );
    return;
  }
  clearPcoItemTimer();
}

export async function startLiveSync(
  showId: string,
  deps: { client?: PcoClient; now?: () => number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = deps.now ?? Date.now;
  const show = await shows.getShow(showId);
  const plan = show ? pickPlan(show.rows) : null;
  if (!plan) return { ok: false, error: "This show has no Planning Center items." };
  let client = deps.client;
  if (!client) {
    const auth = getPcoAuthorization();
    if (!auth) return { ok: false, error: "Planning Center is not connected." };
    client = createPcoClient(auth);
  }

  const differentShow = state.enabled && state.showId !== showId;
  cancelLoop();
  if (differentShow) clearPcoItemTimer();
  state = { enabled: true, showId, status: "idle", lastPolledAt: null, view: null };
  notify();

  const gen = generation;
  const c = client;
  let delay = POLL_MS;
  const poll = async (): Promise<void> => {
    pollTimer = null;
    try {
      const raw = await c.getLive(plan.serviceTypeId, plan.planId);
      if (gen !== generation) return;
      const view = mapPcoLive(raw);
      const t = now();
      state = { enabled: true, showId, status: view.status, lastPolledAt: t, view };
      delay = POLL_MS;
      driveItemTimer(view, t);
      notify();
    } catch (err) {
      if (gen !== generation) return;
      if (err instanceof PcoAuthError) {
        // Stop polling but stay enabled so the operator sees why.
        state = {
          ...state,
          status: "error",
          error: err.message,
          view: state.view ? { ...state.view, status: "error", error: err.message } : null,
        };
        clearPcoItemTimer();
        notify();
        return;
      }
      // Network or server error: keep the last view and status, back off.
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      console.warn("[pcoLiveSync] poll failed", err);
    }
    pollTimer = setTimeout(() => void poll(), delay);
  };
  void poll();
  return { ok: true };
}

export function stopLiveSync(): void {
  const wasEnabled = state.enabled;
  cancelLoop();
  clearPcoItemTimer();
  state = IDLE;
  if (wasEnabled) notify();
}

export function _resetForTest(): void {
  cancelLoop();
  state = IDLE;
  listeners.clear();
  registerDriver();
}
