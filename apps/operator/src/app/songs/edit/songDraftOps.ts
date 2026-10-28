import type { Section, Song } from "@overlaysys/core";

// Pure helpers behind the song editor page and SongDraftEditor.

/**
 * Id for a new slide appended to `section`: `${section.id}s<N>` with the
 * first N (starting at slides.length + 1) that no slide in the song uses.
 * Counting alone reuses a live id after a delete (s1,s2,s3 → delete s2 →
 * add → "s3" again), which collides as a React key and moves focus.
 */
export function nextSlideId(song: Pick<Song, "sections">, section: Section): string {
  const taken = new Set<string>();
  for (const sec of song.sections) for (const sl of sec.slides) taken.add(sl.id);
  for (const sl of section.slides) taken.add(sl.id);
  let n = section.slides.length + 1;
  while (taken.has(`${section.id}s${n}`)) n += 1;
  return `${section.id}s${n}`;
}

/** Move `arr[from]` one step up (-1) or down (+1). Out-of-range is a no-op copy. */
export function moveByOne<T>(arr: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  const next = arr.slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// ── Save / echo bookkeeping for the song editor page ─────────────────────────

/** Song content, ignoring the server-stamped write metadata. */
export function songContentKey(song: Song): string {
  const { updatedAt: _u, deletedAt: _d, ...rest } = song;
  void _u;
  void _d;
  return JSON.stringify(rest);
}

export function sameSongContent(a: Song | null | undefined, b: Song | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a === b || songContentKey(a) === songContentKey(b);
}

/**
 * What the editor does with a copy of its song that arrived from the server
 * (a load reply, its own save echo, or another client's save):
 *  - "adopt": take it as both draft and baseline (nothing local to lose);
 *  - "rebase": content matches what we have — move the baseline only;
 *  - "conflict": the user has unsaved edits and someone else changed the
 *    song — ask before overwriting.
 */
export type IncomingDecision = "adopt" | "rebase" | "conflict";

export function decideIncomingSong(
  state: { draft: Song | null; baseline: Song | null },
  incoming: Song,
): IncomingDecision {
  const { draft, baseline } = state;
  if (!draft || !baseline) return "adopt";
  // Our own save echo (or an identical save elsewhere): nothing changed.
  if (sameSongContent(incoming, baseline) || sameSongContent(incoming, draft)) return "rebase";
  const dirty = !sameSongContent(draft, baseline);
  return dirty ? "conflict" : "adopt";
}

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; reason: string };

/** How long to wait for the server's save ack before reporting failure. */
export const SAVE_ACK_TIMEOUT_MS = 8000;
