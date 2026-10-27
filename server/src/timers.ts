// Standalone stage timers, held in server memory only (a restart drops them).
// Mutated through dispatchTimers / createTimer (pure reducer in @overlaysys/core).
// The server never ticks: consumers compute the display from anchor / pausedAt.

import { randomUUID } from "node:crypto";
import { reduceTimers, type StageTimerInstance, type TimerAction } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";

type Listener = (t: StageTimerInstance[]) => void;

let timers: StageTimerInstance[] = [];
const listeners = new Set<Listener>();

export function getTimers(): StageTimerInstance[] {
  return timers;
}

export function subscribeTimers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function _resetForTest(): void {
  timers = [];
  listeners.clear();
}

function commit(next: StageTimerInstance[]): void {
  if (next === timers) return;
  timers = next;
  for (const l of [...listeners]) {
    try {
      l(timers);
    } catch (err) {
      console.warn("[timers] listener failed", err);
    }
  }
}

export function dispatchTimers(a: TimerAction, now: number = Date.now()): void {
  commit(reduceTimers(timers, a, now));
}

export function createTimer(input: {
  label: string;
  mode: StageTimerInstance["mode"];
  durationMs?: number;
  overtime: boolean;
}): string {
  const id = randomUUID();
  dispatchTimers({ type: "create", id, ...input });
  return id;
}

export function timersStateMessage(): ServerMessage {
  return { type: "timers_state", timers };
}
