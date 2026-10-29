/** localStorage key for the designer's timeline height (px), shared by every template. */
export const TIMELINE_HEIGHT_KEY = "overlaysys:designer:timelineHeight";

const MIN_TIMELINE_H = 140;
const ROW_H = 24;
/**
 * Timeline chrome above the first row, measured in the browser (P2b.10):
 * toolbar 37 + keyframe strip 32 + ruler 20.
 */
const CHROME_H = 89;

/** 45 % of the viewport, but never below the floor. */
function maxFor(viewportH: number): number {
  return Math.max(MIN_TIMELINE_H, Math.floor(0.45 * viewportH));
}

/** Keep a timeline height inside [140, floor(0.45 × viewport)]. */
export function clampTimelineHeight(h: number, viewportH: number): number {
  return Math.round(Math.min(maxFor(viewportH), Math.max(MIN_TIMELINE_H, h)));
}

/** Out-tab missing-out warnings: 20 px a line, plus 2+2 padding and a 1 px border. */
const WARN_LINE_H = 20;
const WARN_CHROME_H = 5;

/** Rows the timeline draws: one header per animated layer plus one per track. */
export function timelineRowCount(tracks: readonly { layerId: string }[]): number {
  return tracks.length + new Set(tracks.map((t) => t.layerId)).size;
}

/**
 * Room for every row (see timelineRowCount) and any missing-out warning lines
 * (Out tab) without scrolling, clamped.
 */
export function defaultTimelineHeight(rowCount: number, viewportH: number, warningLines = 0): number {
  const warn = warningLines > 0 ? warningLines * WARN_LINE_H + WARN_CHROME_H : 0;
  return clampTimelineHeight(rowCount * ROW_H + CHROME_H + warn, viewportH);
}

/** A stored height, or null when missing or not a positive number. */
export function readStoredTimelineHeight(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
