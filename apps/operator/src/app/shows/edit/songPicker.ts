import type { SongMeta } from "@overlaysys/core";

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

function score(s: SongMeta, q: string): number | null {
  const title = s.title.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
  if ((s.author ?? "").toLowerCase().includes(q) || String(s.ccliNumber ?? "").toLowerCase().includes(q)) return 2;
  if (isSubsequence(q, title)) return 3;
  return null;
}

export function rankSongs(songs: SongMeta[], query: string, recentIds: string[]): SongMeta[] {
  const q = query.trim().toLowerCase();
  const recent = (s: SongMeta) => {
    const i = recentIds.indexOf(s.id);
    return i < 0 ? Infinity : i;
  };
  const byRecentTitle = (a: SongMeta, b: SongMeta) => {
    const ra = recent(a);
    const rb = recent(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.title.localeCompare(b.title);
  };
  if (!q) return [...songs].sort(byRecentTitle);
  return songs
    .map((s) => ({ s, k: score(s, q) }))
    .filter((x): x is { s: SongMeta; k: number } => x.k !== null)
    .sort((a, b) => a.k - b.k || byRecentTitle(a.s, b.s))
    .map((x) => x.s);
}
