import type { SongMeta } from "@overlaysys/core";
import type { ImportDecision } from "./planImport";

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

/**
 * Apply one bulk decision to every row that conflicts with an existing id or
 * looks like a duplicate. "Replace all" imports likely duplicates (they have
 * nothing to replace); templates can't be copied, so they skip that bulk.
 */
export function setAllFlagged<
  R extends { kind?: string; conflict?: unknown; likelyDuplicate?: unknown; decision: ImportDecision },
>(rows: readonly R[], decision: ImportDecision): R[] {
  return rows.map((r) => {
    if (!r.conflict && !r.likelyDuplicate) return r;
    let next = decision;
    if (decision === "replace" && !r.conflict) next = "import";
    if (decision === "copy" && r.kind === "template") next = "skip";
    return r.decision === next ? r : { ...r, decision: next };
  });
}
