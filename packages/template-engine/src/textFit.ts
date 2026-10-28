import type { Layer } from "@overlaysys/core";

type TextLayer = Extract<Layer, { type: "text" }>;

export const DEFAULT_MIN_FONT_SIZE = 12;

/**
 * Largest integer font size in [minSize, maxSize] for which `fits` holds,
 * assuming fits is monotone (true below some threshold). Copied from
 * @overlaysys/stage-widgets/fitText.ts (that package is React-based; the
 * engine stays framework-free) so the two fit the same way.
 */
export function fitFontSize(maxSize: number, minSize: number, fits: (size: number) => boolean): number {
  let lo = Math.ceil(minSize);
  let hi = Math.floor(maxSize);
  if (hi <= lo) return Math.max(1, hi);
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

/** Whole lines of `fontSize`×`lineHeight` that fit in `boxH` (at least 1). */
export function ellipsisLines(boxH: number, fontSize: number, lineHeight: number): number {
  const line = fontSize * (lineHeight > 0 ? lineHeight : 1);
  if (!(line > 0) || !(boxH > 0)) return 1;
  return Math.max(1, Math.floor(boxH / line + 1e-6));
}

/** Static (layout-free) part of a text layer's fit: the ellipsis line clamp, or none. */
export function applyTextFitStyles(span: HTMLElement, layer: TextLayer): void {
  const st = span.style as CSSStyleDeclaration & { webkitLineClamp?: string; webkitBoxOrient?: string };
  if (layer.fit === "ellipsis" && layer.transform.h !== undefined) {
    st.display = "-webkit-box";
    st.webkitBoxOrient = "vertical";
    st.webkitLineClamp = String(ellipsisLines(layer.transform.h, layer.style.fontSize, layer.style.lineHeight));
    st.overflow = "hidden";
  } else {
    st.display = "";
    st.webkitBoxOrient = "";
    st.webkitLineClamp = "";
    st.overflow = "";
  }
}

/**
 * Shrink-to-fit: measure and set the largest font size that fits the layer's
 * box. Needs layout, so it runs after the template is in the document (and
 * again when data or fonts change). Hidden layers are left alone.
 */
export function applyShrinkFit(container: HTMLElement, layer: TextLayer): void {
  const span = container.firstElementChild as HTMLElement | null;
  if (!span) return;
  const max = layer.style.fontSize;
  if (layer.fit !== "shrink") return;
  const w = layer.transform.w;
  const h = layer.transform.h;
  if (w === undefined || h === undefined || container.offsetParent === null) {
    span.style.fontSize = `${max}px`;
    return;
  }
  const fits = (size: number) => {
    span.style.fontSize = `${size}px`;
    return span.offsetHeight <= h + 0.5 && span.scrollWidth <= w + 0.5;
  };
  const size = fitFontSize(max, Math.min(max, layer.minFontSize ?? DEFAULT_MIN_FONT_SIZE), fits);
  span.style.fontSize = `${size}px`;
}
