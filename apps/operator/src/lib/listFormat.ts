const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(d: Date, now: Date): string {
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "2026-11-01" -> "Sun 1 Nov" (current year) or "Sun 1 Nov 2025". */
export function formatServiceDate(ymd: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "";
  return dayLabel(d, now);
}

/** Seconds -> "42:30" or "1:02:05". */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function calendarDaysBetween(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da - db) / 86_400_000);
}

/**
 * Relative time for list rows. Under an hour: "just now" / "N min ago".
 * Otherwise by local calendar day: same day "N h ago", previous day "yesterday",
 * 2-6 days "N days ago", older falls back to the service-date format.
 */
export function formatRelative(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const days = calendarDaysBetween(now, d);
  if (days <= 0) return `${Math.floor(min / 60)} h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return dayLabel(d, now);
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}
