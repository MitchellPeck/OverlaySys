import { formatTime, parseDuration } from "@overlaysys/core";

/** Row length as shown in the editor: "M:SS", "H:MM:SS" from an hour up, "" when unset. */
export function formatRowLength(sec: number | undefined): string {
  if (sec === undefined) return "";
  return formatTime(sec * 1000, sec >= 3600 ? "H:MM:SS" : "M:SS");
}

type Parsed = { ok: true; sec: number | undefined } | { ok: false };

function secs(n: number): Parsed {
  const sec = Math.round(n);
  return { ok: true, sec: sec === 0 ? undefined : sec };
}

/**
 * [D13] Bare number = minutes ("5" -> 300, "4.5" -> 270); "M:SS" / "H:MM:SS";
 * "90s", "2m", "2m30s". "0" or empty clears the length.
 */
export function parseRowLength(text: string): Parsed {
  const t = text.trim().toLowerCase();
  if (!t) return { ok: true, sec: undefined };
  if (/^\d+(\.\d+)?$/.test(t)) return secs(Number(t) * 60);
  const unit = /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(t);
  if (unit && (unit[1] !== undefined || unit[2] !== undefined)) {
    return secs(Number(unit[1] ?? 0) * 60 + Number(unit[2] ?? 0));
  }
  if (/^\d+(:\d+(\.\d+)?){1,2}$/.test(t)) {
    const parts = t.split(":");
    if (parts.slice(1).some((p) => Number(p) >= 60)) return { ok: false };
    const ms = parseDuration(t);
    return ms === null ? { ok: false } : secs(ms / 1000);
  }
  return { ok: false };
}

/** Live echo next to the length field ("= 5:00"); null when empty or invalid. */
export function lengthEcho(text: string): string | null {
  const r = parseRowLength(text);
  if (!r.ok || r.sec === undefined) return null;
  return `= ${formatRowLength(r.sec)}`;
}

type RowLike = { lengthSec?: number };

/** Start offset (seconds) of each row; null from the first row after one without a length. */
export function cumulativeStarts(rows: RowLike[]): (number | null)[] {
  const out: (number | null)[] = [];
  let acc: number | null = 0;
  for (const r of rows) {
    out.push(acc);
    acc = acc !== null && typeof r.lengthSec === "number" ? acc + r.lengthSec : null;
  }
  return out;
}

/** Sum of lengths; null when no row has one. */
export function showTotal(rows: RowLike[]): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    if (typeof r.lengthSec === "number") {
      total += r.lengthSec;
      any = true;
    }
  }
  return any ? total : null;
}
