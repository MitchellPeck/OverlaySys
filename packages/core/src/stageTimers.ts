import { z } from "zod";
import { encodeTimerValue } from "./timeField";

/**
 * Standalone stage timers: instances that need no graphic template. They are
 * pure data (`anchor` / `pausedAt`) — the server never ticks them; every
 * consumer derives the display from these fields.
 */

export const CURRENT_ITEM_TIMER_ID = "current-item";
export const MAX_TIMER_DURATION_MS = 86_400_000;
export const MAX_MANUAL_TIMERS = 20;

const MAX_LABEL_LENGTH = 60;

export const StageTimerInstanceSchema = z.object({
  id: z.string(),
  label: z.string().max(MAX_LABEL_LENGTH),
  mode: z.enum(["countdown", "countup"]),
  durationMs: z.number().optional(),
  /** Countdown: target end. Count-up: start. `null` = not started. */
  anchor: z.number().nullable(),
  pausedAt: z.number().optional(),
  overtime: z.boolean(),
  source: z.enum(["manual", "item", "pco"]),
  rowId: z.string().optional(),
});
export type StageTimerInstance = z.infer<typeof StageTimerInstanceSchema>;

type TimerMode = StageTimerInstance["mode"];

export type TimerAction =
  | { type: "create"; id: string; label: string; mode: TimerMode; durationMs?: number; overtime: boolean }
  | { type: "start" | "pause" | "resume" | "reset" | "delete"; id: string }
  | { type: "adjust"; id: string; deltaMs: number }
  | {
      type: "setItem";
      label: string;
      anchor: number;
      durationMs?: number;
      overtime: boolean;
      source: "item" | "pco";
      rowId: string;
    }
  | { type: "clearItem"; source?: "item" | "pco" };

function clampDuration(ms: number | undefined): number {
  if (ms == null || !Number.isFinite(ms)) return 0;
  return Math.min(MAX_TIMER_DURATION_MS, Math.max(0, ms));
}

function cleanLabel(label: string): string {
  return label.trim().slice(0, MAX_LABEL_LENGTH).trim() || "Timer";
}

/** Fresh anchor for a timer started at `now`. */
function startAnchor(t: StageTimerInstance, now: number): number {
  return t.mode === "countdown" ? now + (t.durationMs ?? 0) : now;
}

function resumed(t: StageTimerInstance, now: number): StageTimerInstance {
  const { pausedAt, ...rest } = t;
  return { ...rest, anchor: (t.anchor as number) + (now - (pausedAt as number)) };
}

function replaceAt(
  timers: StageTimerInstance[],
  index: number,
  next: StageTimerInstance,
): StageTimerInstance[] {
  const out = timers.slice();
  out[index] = next;
  return out;
}

export function reduceTimers(
  timers: StageTimerInstance[],
  a: TimerAction,
  now: number,
): StageTimerInstance[] {
  switch (a.type) {
    case "create": {
      if (timers.some((t) => t.id === a.id)) return timers;
      if (timers.filter((t) => t.source === "manual").length >= MAX_MANUAL_TIMERS) return timers;
      const t: StageTimerInstance = {
        id: a.id,
        label: cleanLabel(a.label),
        mode: a.mode,
        anchor: null,
        overtime: a.overtime,
        source: "manual",
      };
      if (a.mode === "countdown") t.durationMs = clampDuration(a.durationMs);
      return [...timers, t];
    }
    case "setItem": {
      if (!Number.isFinite(a.anchor)) return timers;
      const item: StageTimerInstance = {
        id: CURRENT_ITEM_TIMER_ID,
        label: cleanLabel(a.label),
        mode: "countdown",
        anchor: a.anchor,
        overtime: a.overtime,
        source: a.source,
        rowId: a.rowId,
      };
      if (a.durationMs != null) item.durationMs = clampDuration(a.durationMs);
      const i = timers.findIndex((t) => t.id === CURRENT_ITEM_TIMER_ID);
      return i >= 0 ? replaceAt(timers, i, item) : [item, ...timers];
    }
    case "clearItem": {
      const i = timers.findIndex((t) => t.id === CURRENT_ITEM_TIMER_ID);
      if (i < 0) return timers;
      if (a.source && timers[i]!.source !== a.source) return timers;
      return timers.filter((_, j) => j !== i);
    }
    case "delete": {
      if (!timers.some((t) => t.id === a.id)) return timers;
      return timers.filter((t) => t.id !== a.id);
    }
  }

  const i = timers.findIndex((t) => t.id === a.id);
  if (i < 0) return timers;
  const t = timers[i]!;
  const notStarted = t.anchor == null;
  const paused = !notStarted && t.pausedAt != null;

  switch (a.type) {
    case "start": {
      if (notStarted) return replaceAt(timers, i, { ...t, anchor: startAnchor(t, now) });
      if (paused) return replaceAt(timers, i, resumed(t, now));
      return timers;
    }
    case "pause": {
      if (notStarted || paused) return timers;
      return replaceAt(timers, i, { ...t, pausedAt: now });
    }
    case "resume": {
      if (!paused) return timers;
      return replaceAt(timers, i, resumed(t, now));
    }
    case "reset": {
      if (notStarted) return timers;
      if (paused) {
        const { pausedAt: _p, ...rest } = t;
        return replaceAt(timers, i, { ...rest, anchor: null });
      }
      return replaceAt(timers, i, { ...t, anchor: startAnchor(t, now) });
    }
    case "adjust": {
      if (!Number.isFinite(a.deltaMs)) return timers;
      if (t.mode === "countdown") {
        if (notStarted) {
          return replaceAt(timers, i, { ...t, durationMs: clampDuration((t.durationMs ?? 0) + a.deltaMs) });
        }
        return replaceAt(timers, i, { ...t, anchor: (t.anchor as number) + a.deltaMs });
      }
      if (notStarted) return timers;
      const anchor = Math.min((t.anchor as number) - a.deltaMs, t.pausedAt ?? now);
      return replaceAt(timers, i, { ...t, anchor });
    }
  }
}

/**
 * Remaining ms for a countdown (negative once over; the full duration when not
 * started) or elapsed ms for a count-up (0 when not started).
 */
export function timerMs(
  t: { mode: TimerMode; anchor: number | null; pausedAt?: number; durationMs?: number },
  now: number,
): number {
  if (t.anchor == null) return t.mode === "countdown" ? (t.durationMs ?? 0) : 0;
  const at = t.pausedAt ?? now;
  return t.mode === "countdown" ? t.anchor - at : Math.max(0, at - t.anchor);
}

export function timerPhase(
  mode: TimerMode,
  ms: number,
  overtime: boolean,
  warnBelowMs: number,
): "normal" | "warn" | "over" {
  if (mode !== "countdown") return "normal";
  if (ms < 0) return overtime ? "over" : "warn";
  return ms < warnBelowMs ? "warn" : "normal";
}

/** Encoded `TimerValue` for the feed. A not-started timer reads as paused at its start. */
export function stageTimerValue(t: StageTimerInstance, now: number): string {
  if (t.anchor == null) {
    return encodeTimerValue({ anchor: startAnchor(t, now), pausedAt: now });
  }
  return encodeTimerValue({ anchor: t.anchor, ...(t.pausedAt != null ? { pausedAt: t.pausedAt } : {}) });
}
