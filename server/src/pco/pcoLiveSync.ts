// PCO Services Live sync: polls the Live state of the show's Planning Center
// plan, exposes it as a StageServiceView for confidence monitors and drives the
// current-item timer (source "pco") while the service is live. Read-only and
// runtime only: off by default, a server restart turns it off.

import { ZodError } from "zod";
import { CURRENT_ITEM_TIMER_ID, mapPcoLive, type StageServiceView } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "../shows";
import * as timers from "../timers";
import { createPcoClient, PcoAuthError, type PcoClient } from "./pcoClient";
import { clearPcoAuthorizationIf, getPcoAuthorization } from "./pcoTokens";

export const POLL_MS = 5000;
export const MAX_BACKOFF_MS = 60_000;
/**
 * An unchanged poll still rebroadcasts this often, refreshing lastPolledAt.
 * Under the operator's 35 s "stale" threshold (STALE_MS in StagePanel) by a
 * poll's margin, so a healthy sync never reads as stale between heartbeats.
 */
export const HEARTBEAT_MS = 25_000;
const NOT_UNDERSTOOD = "Planning Center response not understood";

/** A response we couldn't read: schema mismatch or malformed JSON. */
function isParseFailure(err: unknown): boolean {
  return err instanceof ZodError || err instanceof SyntaxError || (err instanceof Error && err.name === "ZodError");
}

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
  // Live on an item with no length: PCO owns the item timer (take-based
  // timers are suppressed), so no countdown of any source may linger.
  if (view.status === "live") timers.dispatchTimers({ type: "clearItem" }, now);
  else clearPcoItemTimer();
}

export async function startLiveSync(
  showId: string,
  deps: { client?: PcoClient; now?: () => number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = deps.now ?? Date.now;
  // A start/stop that lands while we await the show supersedes this call.
  const startedAtGeneration = generation;
  const show = await shows.getShow(showId);
  if (generation !== startedAtGeneration) {
    // The newer start/stop owns the outcome; pco_live_state tells clients.
    return { ok: true };
  }
  const plan = show ? pickPlan(show.rows) : null;
  if (!plan) return { ok: false, error: "This show has no Planning Center items." };
  let client = deps.client;
  const usedAuth = getPcoAuthorization();
  if (!client) {
    if (!usedAuth) return { ok: false, error: "Planning Center is not connected." };
    client = createPcoClient(usedAuth);
  }

  const differentShow = state.enabled && state.showId !== showId;
  // Restarting the same show keeps what monitors already show (and the item
  // timer it drives) until the first poll lands.
  const carry = state.enabled && !differentShow ? state : null;
  cancelLoop();
  if (differentShow) clearPcoItemTimer();
  state = {
    enabled: true,
    showId,
    status: carry?.status ?? "idle",
    lastPolledAt: carry?.lastPolledAt ?? null,
    view: carry?.view ?? null,
  };
  notify();

  const gen = generation;
  const c = client;
  let delay = POLL_MS;
  let lastNotifiedAt = -Infinity;
  /**
   * Broadcast only real changes, plus a heartbeat every HEARTBEAT_MS so the
   * operator's staleness check against lastPolledAt keeps working.
   */
  const commit = (next: SyncState, t: number): void => {
    const changed =
      next.enabled !== state.enabled ||
      next.status !== state.status ||
      next.error !== state.error ||
      JSON.stringify(next.view) !== JSON.stringify(state.view);
    state = next;
    if (changed || t - lastNotifiedAt >= HEARTBEAT_MS) {
      lastNotifiedAt = t;
      notify();
    }
  };
  /** Status "error" on the sync and its view; releases the item timer. */
  const fail = (message: string): void => {
    clearPcoItemTimer();
    commit(
      {
        ...state,
        status: "error",
        error: message,
        view: state.view ? { ...state.view, status: "error", error: message } : null,
      },
      now(),
    );
  };
  const poll = async (): Promise<void> => {
    pollTimer = null;
    try {
      const raw = await c.getLive(plan.serviceTypeId, plan.planId);
      if (gen !== generation) return;
      const t = now();
      const view = mapPcoLive(raw, t);
      delay = POLL_MS;
      commit({ enabled: true, showId, status: view.status, lastPolledAt: t, view }, t);
      driveItemTimer(view, t);
    } catch (err) {
      if (gen !== generation) return;
      if (err instanceof PcoAuthError) {
        // The credential PCO just rejected is dead; drop it unless replaced.
        if (usedAuth) clearPcoAuthorizationIf(usedAuth);
        // Stop polling but stay enabled so the operator sees why.
        fail(err.message);
        return;
      }
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      console.warn("[pcoLiveSync] poll failed", err);
      if (isParseFailure(err)) {
        // PCO answered with something we can't read: say so, keep trying.
        fail(NOT_UNDERSTOOD);
      } else {
        // Network or server error (5xx, 403, 404…): keep the last view and
        // status, surface the error, back off.
        commit({ ...state, error: err instanceof Error ? err.message : String(err) }, now());
      }
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
