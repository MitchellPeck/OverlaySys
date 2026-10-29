// Pure sort/filter model for the /shows library list.
import { resolveShowDate, toISODate } from "@overlaysys/core";
import type { ShowMeta } from "@/lib/store";

export function metaDate(s: Pick<ShowMeta, "name" | "scheduledFor">): string | null {
  return resolveShowDate(s);
}

const byUpdatedDesc = (a: ShowMeta, b: ShowMeta) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
const byName = (a: ShowMeta, b: ShowMeta) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function byDate(dir: 1 | -1) {
  return (a: ShowMeta, b: ShowMeta): number => {
    const da = metaDate(a);
    const db = metaDate(b);
    if (da && db && da !== db) return dir * da.localeCompare(db);
    if (da && !db) return -1; // undated always last
    if (!da && db) return 1;
    return byUpdatedDesc(a, b) || byName(a, b);
  };
}

export const showSorts = [
  { id: "date-desc", label: "Service date", compare: byDate(-1) },
  { id: "date-asc", label: "Service date (oldest)", compare: byDate(1) },
  { id: "edited-desc", label: "Recently edited", compare: (a: ShowMeta, b: ShowMeta) => byUpdatedDesc(a, b) || byName(a, b) },
  { id: "name-asc", label: "Name", compare: byName },
];

export function matchesWhen(s: ShowMeta, value: string, now: Date): boolean {
  const d = metaDate(s);
  const today = toISODate(now);
  switch (value) {
    case "upcoming": return d !== null && d >= today;
    case "past": return d !== null && d < today;
    case "none": return d === null;
    default: return true;
  }
}

// LibraryList renders the first option as "All <label>", hence "dates".
export const showFilterWhenOptions = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "none", label: "No date" },
];

/** Loading until connected AND the first list has arrived; error only when the socket is actually closed. */
export function showListStatus(i: { cloud: boolean; conn: "connecting" | "open" | "closed"; listed: boolean }): {
  loading: boolean;
  error: string | null;
} {
  if (i.cloud) return { loading: !i.listed, error: null };
  if (i.conn === "closed") return { loading: false, error: "Not connected to the server" };
  return { loading: i.conn === "connecting" || !i.listed, error: null };
}
