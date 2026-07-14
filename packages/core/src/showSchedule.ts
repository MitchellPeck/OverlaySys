const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/;

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject days that overflow the given month (handles Feb + 30/31-day months).
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as a local `YYYY-MM-DD` calendar date. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIsoDate(s: string): string | null {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYmd(year, month, day)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseNameDate(name: string): string | null {
  const m = NAME_DATE_RE.exec(name);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const rawYear = m[3]!;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Resolves a show's date as `YYYY-MM-DD`, preferring a valid `scheduledFor`
 * and otherwise parsing a `M/D/YY` or `M/D/YYYY` date out of the name.
 * Returns `null` when neither source yields a valid date.
 */
export function resolveShowDate(input: {
  name: string;
  scheduledFor?: string;
}): string | null {
  if (input.scheduledFor) {
    const iso = parseIsoDate(input.scheduledFor);
    if (iso) return iso;
  }
  return parseNameDate(input.name);
}

/**
 * Returns the id of the show with the soonest resolved date on or after
 * `todayISO` (a `YYYY-MM-DD` string). Ties break by input order. Shows with no
 * resolvable date, or a date before today, are ignored. Returns `null` when
 * nothing qualifies.
 */
export function pickNextShow(
  shows: { id: string; name: string; scheduledFor?: string }[],
  todayISO: string,
): string | null {
  let bestId: string | null = null;
  let bestDate: string | null = null;
  for (const show of shows) {
    const date = resolveShowDate(show);
    if (date === null || date < todayISO) continue;
    // Strict `<` so the first show at a given date wins the tie.
    if (bestDate === null || date < bestDate) {
      bestDate = date;
      bestId = show.id;
    }
  }
  return bestId;
}
