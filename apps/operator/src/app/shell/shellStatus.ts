// Pure view-model helpers for the shell's status surfaces (disconnected
// banner, desktop toasts, sync pill, first-run checklist). Kept free of React
// and the DOM so they're unit-testable.

import type { DesktopEvent } from "@/lib/desktop";
import type { SyncStatusSnapshot } from "@/lib/useSyncStatus";

export type Tone = "good" | "warn" | "bad" | "dim";

// ── Disconnected banner ────────────────────────────────────────────────────

/** Grace period so a normal reconnect blip doesn't flash a full-width banner. */
export const DISCONNECTED_GRACE_MS = 1500;

/**
 * Whether to show the "Disconnected — takes are not being sent" banner.
 * `notOpenSince` is when the socket last left "open" (or page load, if it has
 * never opened). The banner shows once the grace period has passed.
 */
export function shouldShowDisconnected(
  conn: "connecting" | "open" | "closed",
  notOpenSince: number,
  now: number,
): boolean {
  if (conn === "open") return false;
  return now - notOpenSince >= DISCONNECTED_GRACE_MS;
}

// ── Desktop host events ────────────────────────────────────────────────────

export interface DesktopToast {
  tone: Tone;
  text: string;
  /** Sticky toasts stay until dismissed; others auto-dismiss. */
  sticky: boolean;
}

function targetLabel(target: string): string {
  return target === "operator" ? "The console" : `Output “${target}”`;
}

export function describeDesktopEvent(ev: DesktopEvent): DesktopToast {
  switch (ev.kind) {
    case "server-restarting":
      return {
        tone: "bad",
        text: `Server stopped (${ev.reason}). Restarting in ${Math.round(ev.delayMs / 1000)}s — attempt ${ev.attempt}.`,
        sticky: false,
      };
    case "server-restarted":
      return { tone: "good", text: `Server restarted on port ${ev.port}. Check what's on air.`, sticky: false };
    case "server-failed":
      return { tone: "bad", text: `Server restart failed: ${ev.reason}. Retrying.`, sticky: true };
    case "window-reloaded":
      return { tone: "warn", text: `${targetLabel(ev.target)} crashed and was reloaded (${ev.reason}).`, sticky: false };
    case "window-reload-gave-up":
      return {
        tone: "bad",
        text: `${targetLabel(ev.target)} keeps crashing (${ev.reason}). Close and reopen it from Settings → Channels.`,
        sticky: true,
      };
    case "output-hidden":
      return {
        tone: "warn",
        text: `Output “${ev.channelId}” was closed: ${ev.reason}. It reopens when the display is back (if set to auto-open).`,
        sticky: true,
      };
  }
}

// ── Cloud sync pill ────────────────────────────────────────────────────────

export interface SyncView {
  tone: Tone;
  label: string;
  /** Multi-line detail for the popover. */
  details: string[];
  /** Text worth copying into a bug report (null when nothing went wrong). */
  error: string | null;
}

/** Compact "Xs/m/h ago". The pill polls every 10s, so under a minute is "just now". */
export function formatRelative(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Null when there's nothing to show (signed out, nothing went wrong). */
export function syncView(status: SyncStatusSnapshot, now: number): SyncView | null {
  const { running, lastRanAt, lastError, lastResult } = status;
  const last = lastRanAt ? `Last pass ${formatRelative(lastRanAt, now)}` : "No pass yet";
  if (!status.paired) {
    // Not paired: either signed out (nothing to show) or the server refused
    // the tokens — a misconfigured build must never vanish silently.
    if (!lastError) return null;
    return { tone: "bad", label: "sync unavailable", details: [lastError], error: lastError };
  }
  if (running) return { tone: "warn", label: "syncing…", details: [last], error: null };
  if (lastError) return { tone: "bad", label: "sync error", details: [last, lastError], error: lastError };
  if (lastResult && lastResult.errors.length > 0) {
    const lines = lastResult.errors.map((e) => `[${e.kind}:${e.id}] ${e.message}`);
    return {
      tone: "bad",
      label: `sync ${lastResult.errors.length} err`,
      details: [last, ...lines.slice(0, 8), ...(lines.length > 8 ? [`…and ${lines.length - 8} more`] : [])],
      error: lines.join("\n"),
    };
  }
  if (lastRanAt) {
    const overwrites = lastResult?.overwrites ?? [];
    const counts = lastResult ? `Pulled ${lastResult.pulled}, pushed ${lastResult.pushed}` : null;
    const warnings = lastResult?.warnings ?? [];
    if (warnings.length > 0) {
      const lines = warnings.map((w) => `[${w.kind}:${w.id}] ${w.message}`);
      return {
        tone: "warn",
        label: `synced · ${warnings.length} kept local`,
        details: [
          last,
          ...(counts ? [counts] : []),
          "Cloud copies not applied (they would lose local data):",
          ...lines.slice(0, 8),
          ...(lines.length > 8 ? [`…and ${lines.length - 8} more`] : []),
        ],
        error: lines.join("\n"),
      };
    }
    if (overwrites.length > 0) {
      return {
        tone: "warn",
        label: `synced · ${overwrites.length} overwrite${overwrites.length === 1 ? "" : "s"}`,
        details: [
          last,
          ...(counts ? [counts] : []),
          "Newer cloud copies replaced these local records:",
          ...overwrites.slice(0, 8).map((o) => `[${o.kind}:${o.id}] local ${o.localUpdatedAt} → cloud ${o.remoteUpdatedAt}`),
        ],
        error: null,
      };
    }
    return { tone: "good", label: `synced ${formatRelative(lastRanAt, now)}`, details: [last, ...(counts ? [counts] : [])], error: null };
  }
  return { tone: "dim", label: "sync pending", details: [last], error: null };
}

// ── First-run checklist ────────────────────────────────────────────────────

export const FIRST_RUN_DISMISSED_KEY = "overlaysys:firstRun:dismissed";

export interface ChecklistItem {
  id: "outputs" | "pco" | "stt" | "cloud";
  label: string;
  hint: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

export interface ChecklistInputs {
  /** Any channel has a saved display or an open output window. */
  outputsConfigured: boolean;
  pcoConnected: boolean;
  /** STT has a saved config with an input device. */
  sttConfigured: boolean;
  cloudSignedIn: boolean;
}

export function buildChecklist(i: ChecklistInputs): ChecklistItem[] {
  return [
    {
      id: "outputs",
      label: "Set up outputs",
      hint: "Pick a display for each channel and turn on auto-open.",
      href: "/settings/channels",
      done: i.outputsConfigured,
    },
    {
      id: "pco",
      label: "Connect Planning Center",
      hint: "Import service plans and songs.",
      href: "/settings/integrations",
      done: i.pcoConnected,
    },
    {
      id: "stt",
      label: "Choose a microphone for live lyrics",
      hint: "Speech-to-text follows the worship leader.",
      href: "/settings/stt",
      done: i.sttConfigured,
    },
    {
      id: "cloud",
      label: "Sign in to sync (optional)",
      hint: "Back up shows and songs and edit them from the web.",
      href: "/account",
      done: i.cloudSignedIn,
      optional: true,
    },
  ];
}

/** Required steps done / required steps total. */
export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  const required = items.filter((i) => !i.optional);
  return { done: required.filter((i) => i.done).length, total: required.length };
}
