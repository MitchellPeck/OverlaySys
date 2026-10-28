// Pure policy helpers for keeping the embedded server and the app's windows
// alive mid-service. Free of any `electron` import so they stay unit-testable;
// main.ts wires them to the real child process and BrowserWindows.

/**
 * Delay before respawn attempt `attempt` (1-based): 1s, 2s, 4s, 8s, 16s, then
 * capped at `maxMs`. The first restart is quick because a crashed server
 * means every output is frozen.
 */
export function respawnDelayMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** (n - 1));
}

/**
 * Sliding-window rate limiter: `tryAcquire(now)` returns true while fewer than
 * `max` events landed in the last `windowMs`. Used so a window whose renderer
 * crashes on every load doesn't reload in a tight loop, and so the respawn
 * attempt counter resets once the server has been stable for a while.
 */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(now: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }

  /** Events counted in the current window (after pruning). */
  count(now: number): number {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    return this.stamps.length;
  }

  reset(): void {
    this.stamps = [];
  }
}

/**
 * Chromium `did-fail-load` codes that are NOT real failures: -3 ERR_ABORTED
 * fires whenever a navigation is superseded (in-app route changes, a reload
 * racing a load). Reloading on those would loop.
 */
export function isRecoverableLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  if (!isMainFrame) return false;
  return errorCode !== -3 && errorCode !== 0;
}

/**
 * `render-process-gone` reasons worth a reload. "clean-exit" happens when the
 * window is closing anyway.
 */
export function shouldReloadAfterGone(reason: string): boolean {
  return reason !== "clean-exit";
}

/**
 * Event sent to the operator window over `overlaysys:desktop-event` so it can
 * tell the operator what the host just did on their behalf. Keep in sync with
 * preload.ts and apps/operator/src/lib/desktop.ts.
 */
export type DesktopEvent =
  | { kind: "server-restarting"; attempt: number; delayMs: number; reason: string }
  | { kind: "server-restarted"; port: number }
  | { kind: "server-failed"; reason: string }
  | { kind: "window-reloaded"; target: string; reason: string }
  | { kind: "window-reload-gave-up"; target: string; reason: string }
  | { kind: "output-hidden"; channelId: string; reason: string };
