export type ChainEntry = { id: string; isGroup: boolean };

/**
 * Result of resolving a click: either select a specific layer, exit the
 * currently-entered group, or fall through to background-clear.
 */
export type SelectionResult =
  | { kind: "select"; id: string }
  | { kind: "exit" }
  | { kind: "background" };

/**
 * Pick the layer that should be selected by a click, given the chain of
 * ancestors (innermost → outermost) and the currently-entered group (if any).
 *
 * Rules:
 *   - Empty chain → background.
 *   - If `enteredGroupId` is in the chain, restrict to entries strictly
 *     inside it (slice up to but not including the entered group).
 *       - If that slice is empty, the click landed on the entered group's
 *         own chrome → exit.
 *       - Otherwise pick the outermost group in the slice; fall back to
 *         the leaf if there are no groups.
 *   - Else pick the outermost group in the chain; fall back to the leaf.
 */
export function pickGroupSelection(
  chain: ChainEntry[],
  enteredGroupId: string | null,
): SelectionResult {
  if (chain.length === 0) return { kind: "background" };

  const enteredIdx = enteredGroupId
    ? chain.findIndex((c) => c.id === enteredGroupId)
    : -1;

  const slice = enteredIdx >= 0 ? chain.slice(0, enteredIdx) : chain;

  if (enteredIdx >= 0 && slice.length === 0) {
    return { kind: "exit" };
  }

  // Walk slice outermost → innermost looking for a group.
  for (let i = slice.length - 1; i >= 0; i--) {
    const entry = slice[i];
    if (entry && entry.isGroup) return { kind: "select", id: entry.id };
  }

  // No group in slice — pick the leaf (innermost entry).
  const leaf = slice[0];
  if (!leaf) return { kind: "background" };
  return { kind: "select", id: leaf.id };
}

/**
 * Tracks the previous click for double-click detection. `groupId === null`
 * means the previous click did not land on a group, so a follow-up click
 * cannot count as a "double-click on a group".
 */
export type LastClick = { time: number; groupId: string | null };

/**
 * Was this pointerdown a double-click on the previously-clicked group?
 *
 * True iff:
 *   - `last.groupId` is non-null,
 *   - the new click happened within `thresholdMs` of `last.time`,
 *   - the chain still contains `last.groupId` (i.e. we're clicking inside
 *     the same group that was just selected).
 */
export function isDoubleClick(
  last: LastClick,
  now: number,
  chain: ChainEntry[],
  thresholdMs: number,
): boolean {
  if (!last.groupId) return false;
  if (now - last.time >= thresholdMs) return false;
  return chain.some((c) => c.id === last.groupId);
}
