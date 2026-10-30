import { decodeTimerValue, encodeTimerValue, parseDuration } from "@overlaysys/core";

// Timer anchors are server-clock timestamps: every `now` here is
// Date.now() + serverTimeOffsetMs, the clock the stage timers and the
// Active timers panel use.

/**
 * The stored value for a countdown typed as "10:00" / "1:30:00", anchored
 * at `now`; null when the text isn't a duration. Always encodes durationMs
 * so the Active timers panel's Reset can re-derive the original duration
 * without falling back to "current remaining" (which would lock in any ±N
 * nudges).
 */
export function countdownTimerValue(text: string, now: number): string | null {
  const ms = parseDuration(text);
  if (ms == null) return null;
  return encodeTimerValue({ anchor: now + ms, durationMs: ms });
}

/**
 * If `value` encodes a countdown anchor after `now`, render it as a
 * remaining duration string ("10:00"). Past anchors and unset values
 * render empty so the field reads as "ready to type." Handles both the
 * bare-number and JSON-object encodings.
 */
export function remainingDurationText(value: string | undefined, now: number): string {
  if (!value) return "";
  const { anchor } = decodeTimerValue(value);
  if (!Number.isFinite(anchor)) return "";
  const remainingMs = anchor - now;
  if (remainingMs <= 0) return "";
  const totalSec = Math.round(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
