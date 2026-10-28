import type { Section, Song } from "@overlaysys/core";

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

/**
 * Maps a PCO arrangement sequence (section labels, in order) onto a song's
 * section ids. Labels match case- and space-insensitively; repeats are kept
 * and unmatched entries skipped. Returns null when nothing matches, so the
 * caller falls back to the song's own default (never to "all sections").
 */
export function arrangementFromSequence(
  sections: Section[],
  sequence: string[] | undefined,
): string[] | null {
  if (!sequence || sequence.length === 0) return null;
  const idByLabel = new Map<string, string>();
  for (const s of sections) {
    const key = norm(s.label);
    if (!idByLabel.has(key)) idByLabel.set(key, s.id);
  }
  const out: string[] = [];
  for (const label of sequence) {
    const id = idByLabel.get(norm(label));
    if (id) out.push(id);
  }
  return out.length > 0 ? out : null;
}

/** The per-row arrangement for a linked song, or undefined to use the song's default. */
export function linkedRowArrangement(song: Song, sequence: string[] | undefined): string[] | undefined {
  const result = arrangementFromSequence(song.sections, sequence);
  if (!result) return undefined;
  const def = song.defaultArrangement;
  if (result.length === def.length && result.every((id, i) => id === def[i])) return undefined;
  return result;
}

const same = (a: string[] | undefined, b: string[] | undefined): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * Re-import merge: PCO's sequence overwrites the row arrangement only when the
 * operator hasn't changed it (it is unset, or still equals what PCO last wrote).
 */
export function mergeReimportedArrangement(
  existing: { arrangement?: string[]; sourceRef?: { pcoArrangement?: string[] } } | undefined,
  next: string[] | undefined,
): { arrangement?: string[]; pcoArrangement?: string[] } {
  const prevPco = existing?.sourceRef?.pcoArrangement;
  if (existing && existing.arrangement !== undefined && !same(existing.arrangement, prevPco)) {
    return {
      arrangement: existing.arrangement,
      ...(prevPco ? { pcoArrangement: prevPco } : {}),
    };
  }
  return next ? { arrangement: next, pcoArrangement: next } : {};
}
