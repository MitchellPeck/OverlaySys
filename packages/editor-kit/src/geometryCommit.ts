export type CommitRectInput = { x: number; y: number; w: number; h: number };

/** Whole-pixel geometry: rounds each value to 0 dp and clamps w/h to at least `minSize`. */
export function commitRect(
  r: CommitRectInput,
  opts: { minSize?: number } = {},
): CommitRectInput {
  const minSize = opts.minSize ?? 1;
  return {
    x: Math.round(r.x) + 0,
    y: Math.round(r.y) + 0,
    w: Math.max(minSize, Math.round(r.w)),
    h: Math.max(minSize, Math.round(r.h)),
  };
}
