import type { SongMeta } from "@overlaysys/core";

export interface LikelyDuplicate {
  id: string;
  title: string;
  reason: "ccli" | "title";
}

function normTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * An existing library song (under a different id) that an imported song
 * probably duplicates: same CCLI number first, else the same title ignoring
 * case and punctuation. Id matches are handled as Replace/Skip conflicts.
 */
export function findLikelySongDuplicate(
  song: Pick<SongMeta, "id" | "title" | "ccliNumber">,
  existing: readonly SongMeta[],
): LikelyDuplicate | null {
  const others = existing.filter((s) => s.id !== song.id);
  const ccli = song.ccliNumber?.trim();
  if (ccli) {
    const hit = others.find((s) => s.ccliNumber?.trim() === ccli);
    if (hit) return { id: hit.id, title: hit.title, reason: "ccli" };
  }
  const t = normTitle(song.title ?? "");
  if (t) {
    const hit = others.find((s) => normTitle(s.title ?? "") === t);
    if (hit) return { id: hit.id, title: hit.title, reason: "title" };
  }
  return null;
}

export type BulkDecision = "save" | "skip";

/** Apply one decision to every row that conflicts with an existing id. */
export function setAllConflicts<R extends { conflict: boolean; decision: BulkDecision }>(
  rows: readonly R[],
  decision: BulkDecision,
): R[] {
  return rows.map((r) => (r.conflict && r.decision !== decision ? { ...r, decision } : r));
}
