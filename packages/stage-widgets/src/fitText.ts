/**
 * Largest integer font size in [minSize, maxSize] for which `fits` holds,
 * assuming fits is monotone (true below some threshold). Shared with the
 * phase-5 designer so preview and output match.
 */
export function fitFontSize(maxSize: number, minSize: number, fits: (size: number) => boolean): number {
  let lo = Math.ceil(minSize);
  let hi = Math.floor(maxSize);
  if (fits(hi)) return hi;
  let best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
