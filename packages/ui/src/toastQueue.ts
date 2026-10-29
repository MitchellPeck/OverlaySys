// Pure toast queue: durations, dedupe and the 3-toast cap. No React, no DOM —
// unit-tested in node with an injected clock.

export type ToastTone = "info" | "ok" | "warn" | "error";

export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick(): void };
  /** ms until auto-dismiss; `null` = persistent (stays until dismissed by id, never evicted by non-persistent toasts). */
  durationMs?: number | null;
};

export type ToastEntry = {
  id: string;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick(): void };
  createdAt: number;
  expiresAt: number;
};

export const TOAST_MAX = 3;
export const TOAST_DEDUPE_MS = 1000;
const DEFAULT_MS = 4000;
const LONG_MS = 8000;

export function toastDuration(o: ToastOptions): number {
  if (o.durationMs === null) return Infinity;
  if (o.durationMs !== undefined) return o.durationMs;
  return o.tone === "error" || o.action ? LONG_MS : DEFAULT_MS;
}

export type ToastQueue = {
  /** Add a toast; returns its id (the existing id when deduped). */
  push(o: ToastOptions): string;
  dismiss(id: string): void;
  /** Drop every toast whose time is up. */
  expire(): void;
  /** Oldest first. The reference changes only when the entries do. */
  list(): ToastEntry[];
};

/** Keep at most TOAST_MAX: drop the oldest non-persistent first, then the oldest. */
function capEntries(list: ToastEntry[]): ToastEntry[] {
  const out = [...list];
  while (out.length > TOAST_MAX) {
    const i = out.findIndex((e) => e.expiresAt !== Infinity);
    out.splice(i === -1 ? 0 : i, 1);
  }
  return out;
}

export function createToastQueue(now: () => number): ToastQueue {
  let entries: ToastEntry[] = [];
  let seq = 0;

  return {
    push(o) {
      const t = now();
      const tone = o.tone ?? "info";
      const dupe = entries.find(
        (e) => e.message === o.message && e.tone === tone && t - e.createdAt < TOAST_DEDUPE_MS,
      );
      if (dupe) return dupe.id;
      const entry: ToastEntry = {
        id: `t${++seq}`,
        message: o.message,
        tone,
        action: o.action,
        createdAt: t,
        expiresAt: t + toastDuration(o),
      };
      entries = capEntries([...entries, entry]);
      return entry.id;
    },
    dismiss(id) {
      if (!entries.some((e) => e.id === id)) return;
      entries = entries.filter((e) => e.id !== id);
    },
    expire() {
      const t = now();
      if (!entries.some((e) => e.expiresAt <= t)) return;
      entries = entries.filter((e) => e.expiresAt > t);
    },
    list() {
      return entries;
    },
  };
}
