/**
 * Largest integer font size in [minSize, maxSize] for which `fits` holds,
 * assuming fits is monotone (true below some threshold). Used with real DOM
 * measurement by useFitText.
 */
export function searchFontSize(maxSize: number, minSize: number, fits: (size: number) => boolean): number {
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

export interface FitResult {
  px: number;
  /** True when the text wraps onto more than one line. */
  wrap: boolean;
  /** Height multiplier in [1, 2] needed at the chosen size (a message bar grows upward). */
  grow: number;
}

const AVG_CHAR_EM = 0.55;
const LINE_HEIGHT = 1.15;

function linesAt(chars: number, px: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (px * AVG_CHAR_EM)));
  return Math.max(1, Math.ceil(chars / perLine));
}

/**
 * Pure estimate for one text block: the largest size in [minPx, maxPx] that fits
 * the box, never below `minPx` (default 48). At the floor the text wraps and
 * `grow` says how much taller the box must be (capped at 2).
 */
export function fitFontSize(
  text: string,
  box: { w: number; h: number },
  maxPx: number,
  { minPx = 48 }: { minPx?: number } = {},
): FitResult {
  const chars = Math.max(1, text.length);
  const fits = (s: number) => linesAt(chars, s, box.w) * s * LINE_HEIGHT <= box.h;
  const floor = Math.min(minPx, maxPx);
  const px = searchFontSize(maxPx, floor, fits);
  const lines = linesAt(chars, px, box.w);
  if (fits(px)) return { px, wrap: lines > 1, grow: 1 };
  const need = (lines * px * LINE_HEIGHT) / box.h;
  return { px, wrap: true, grow: Math.min(2, Math.max(1, need)) };
}
