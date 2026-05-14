import type { Field, TimeFormat, TimeMode } from "./template";

/**
 * Time-field helpers shared by the template engine (renderer-side ticking),
 * the operator UI (input parsing + preview), and any future Companion action
 * targeting timers.
 *
 * Encoding: a time field's data value is either a **bare epoch-ms anchor**
 * (just the number as a string — the original "running" format) or a
 * **JSON-encoded object** `{a, p?, d?}` that carries additional state:
 *
 *   - `a` (required): epoch-ms anchor. For countdowns that's the target end;
 *     for count-ups, the start.
 *   - `p` (optional): epoch ms the timer was paused at. While present, the
 *     display freezes at the value computed from `a` and `p`.
 *   - `d` (optional): the original duration in ms, recorded at take time
 *     for countdowns so Reset can re-derive a fresh anchor without asking
 *     the operator to retype the duration.
 *
 * Clocks ignore the value entirely — they always read `Date.now()`.
 */

/**
 * Parsed shape of a time-field data value. `anchor` is required; the other
 * fields are present only when the corresponding state is meaningful.
 *
 * `NaN` anchor signals "unparseable / missing" so callers can fall through
 * to a zero display rather than crash on `NaN - now`.
 */
export type TimerValue = {
  anchor: number;
  pausedAt?: number;
  durationMs?: number;
};

/**
 * Render a TimerValue to its on-wire form. We keep the simple-anchor case
 * as a plain number string so saved templates and existing snapshots stay
 * human-readable; only escalate to JSON when there's extra state to carry.
 */
export function encodeTimerValue(v: TimerValue): string {
  if (v.pausedAt == null && v.durationMs == null) {
    return String(v.anchor);
  }
  const o: Record<string, number> = { a: v.anchor };
  if (v.pausedAt != null) o.p = v.pausedAt;
  if (v.durationMs != null) o.d = v.durationMs;
  return JSON.stringify(o);
}

/**
 * Parse an on-wire time-field value. Accepts both the bare-number legacy
 * form and the JSON-object form. Returns `{anchor: NaN}` on unparseable
 * input so `computeTimeDisplay` can render zero rather than crash.
 */
export function decodeTimerValue(s: string | undefined): TimerValue {
  if (s == null || s === "") return { anchor: NaN };
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { a?: unknown; p?: unknown; d?: unknown };
      const anchor = Number(o.a);
      const out: TimerValue = { anchor };
      if (o.p != null) {
        const p = Number(o.p);
        if (Number.isFinite(p)) out.pausedAt = p;
      }
      if (o.d != null) {
        const d = Number(o.d);
        if (Number.isFinite(d)) out.durationMs = d;
      }
      return out;
    } catch {
      return { anchor: NaN };
    }
  }
  return { anchor: Number(s) };
}

const PAD2 = (n: number): string => (n < 10 ? "0" + n : String(n));

/**
 * Render a non-negative millisecond duration as a `format` string.
 * Negative inputs clamp to zero (countdowns past zero shouldn't flash
 * negatives). For HH/H formats, hours overflow naturally (a 75-minute
 * countdown reads "01:15:00").
 */
export function formatTime(totalMs: number, format: TimeFormat): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  switch (format) {
    case "MM:SS":
      // For ≥ 1h durations, MM rolls into a 3+ digit minute count.
      return `${PAD2(hours * 60 + minutes)}:${PAD2(seconds)}`;
    case "M:SS":
      return `${hours * 60 + minutes}:${PAD2(seconds)}`;
    case "HH:MM:SS":
      return `${PAD2(hours)}:${PAD2(minutes)}:${PAD2(seconds)}`;
    case "H:MM:SS":
      return `${hours}:${PAD2(minutes)}:${PAD2(seconds)}`;
    case "HH:MM":
      return `${PAD2(hours)}:${PAD2(minutes)}`;
    case "H:MM":
      return `${hours}:${PAD2(minutes)}`;
  }
}

/**
 * Parse a duration like "10:00", "1:30:00", or "90" into milliseconds.
 *
 * Rules:
 *   - One token  → seconds (e.g. "90" = 90s)
 *   - Two tokens → MM:SS (e.g. "10:00" = 10m)
 *   - Three tokens → HH:MM:SS
 * Trailing/leading whitespace is ignored. Non-numeric tokens return null.
 */
export function parseDuration(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let totalSec = 0;
  if (nums.length === 1) totalSec = nums[0]!;
  else if (nums.length === 2) totalSec = nums[0]! * 60 + nums[1]!;
  else totalSec = nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  return Math.round(totalSec * 1000);
}

/**
 * Format the current wall-clock time. Used by `mode === "clock"` fields and
 * by the Timer panel preview. `now` is injectable for tests.
 */
function formatClock(now: number, format: TimeFormat): string {
  const d = new Date(now);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  switch (format) {
    case "MM:SS":
      return `${PAD2(minutes)}:${PAD2(seconds)}`;
    case "M:SS":
      return `${minutes}:${PAD2(seconds)}`;
    case "HH:MM:SS":
      return `${PAD2(hours)}:${PAD2(minutes)}:${PAD2(seconds)}`;
    case "H:MM:SS":
      return `${hours}:${PAD2(minutes)}:${PAD2(seconds)}`;
    case "HH:MM":
      return `${PAD2(hours)}:${PAD2(minutes)}`;
    case "H:MM":
      return `${hours}:${PAD2(minutes)}`;
  }
}

const DEFAULT_FORMAT: TimeFormat = "MM:SS";
const DEFAULT_MODE: TimeMode = "countdown";

/**
 * Compute the display string for a time field at instant `now`.
 *
 * `value` is the take-time data string. For countdown / countup it's parsed
 * as an epoch-ms anchor; if missing or unparseable, the display falls back to
 * the format's zero (e.g. "00:00") rather than NaN.
 */
export function computeTimeDisplay(field: Field, value: string | undefined, now: number): string {
  const format = field.timeFormat ?? DEFAULT_FORMAT;
  const mode = field.timeMode ?? DEFAULT_MODE;
  if (mode === "clock") {
    return formatClock(now, format);
  }
  const { anchor, pausedAt } = decodeTimerValue(value);
  if (!Number.isFinite(anchor)) {
    return formatTime(0, format);
  }
  // When paused, freeze the display at the moment the timer was paused.
  // `pausedAt` substitutes for `now` in the same formula — so both
  // countdown and countup naturally hold at their last-running value
  // until the operator resumes.
  const effectiveNow = pausedAt ?? now;
  if (mode === "countdown") {
    return formatTime(anchor - effectiveNow, format);
  }
  // countup
  return formatTime(Math.max(0, effectiveNow - anchor), format);
}

/**
 * True if this field is a time field. Centralized so consumers don't have to
 * remember to also check that timeMode exists — a future schema change could
 * narrow that.
 */
export function isTimeField(field: Field): boolean {
  return field.type === "time";
}
