/**
 * Milliseconds left of a template's IN animation, counted from the take.
 * 0 when it has finished, never started (no takenAt) or has no IN timeline.
 */
export function inChipRemainingMs(takenAt: number, inDurationSec: number, now: number): number {
  if (!takenAt || !(inDurationSec > 0)) return 0;
  return Math.max(0, takenAt + inDurationSec * 1000 - now);
}
