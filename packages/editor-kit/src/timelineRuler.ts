/** Half a keyframe diamond: the track area is inset this much on each side so end keyframes aren't clipped. */
export const TRACK_PAD = 5;

/** Labels closer than this get a doubled step. */
const MIN_LABEL_GAP_PX = 48;

function stepsFor(durationSec: number): { minor: number; label: number } {
  if (durationSec < 2) return { minor: 0.1, label: 0.25 };
  if (durationSec < 10) return { minor: 0.5, label: 1 };
  return { minor: 1, label: 5 };
}

/** Multiples of `step` from 0 to `end` (inclusive), free of float drift. */
function multiples(step: number, end: number): number[] {
  const out: number[] = [];
  const n = Math.floor(end / step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Number((i * step).toFixed(6)));
  return out;
}

/** "0.25s", "1s", "1.5s": no trailing zeros. */
function labelText(t: number): string {
  return `${Number(t.toFixed(3))}s`;
}

/**
 * Ruler ticks for a timeline drawn `widthPx` wide. Minor ticks and labels are
 * times in seconds; the step depends on the duration, and the label step is
 * doubled once when labels would sit closer than 48 px.
 */
export function rulerTicks(
  durationSec: number,
  widthPx: number,
): { minor: number[]; labels: { t: number; text: string }[] } {
  if (!(durationSec > 0) || !(widthPx > 0)) return { minor: [], labels: [] };
  const steps = stepsFor(durationSec);
  const pxPerSec = widthPx / durationSec;
  const labelStep = steps.label * pxPerSec < MIN_LABEL_GAP_PX ? steps.label * 2 : steps.label;
  return {
    minor: multiples(steps.minor, durationSec),
    labels: multiples(labelStep, durationSec).map((t) => ({ t, text: labelText(t) })),
  };
}

/** x (px from the lane's left edge) of time `t` in a lane `widthPx` wide, inside the padding. */
export function timeToX(t: number, durationSec: number, widthPx: number): number {
  const inner = Math.max(0, widthPx - 2 * TRACK_PAD);
  if (!(durationSec > 0)) return TRACK_PAD;
  return TRACK_PAD + (t / durationSec) * inner;
}

/** Time under x (px from the lane's left edge), clamped to [0, duration]. */
export function xToTime(x: number, durationSec: number, widthPx: number): number {
  const inner = widthPx - 2 * TRACK_PAD;
  if (!(inner > 0) || !(durationSec > 0)) return 0;
  const t = ((x - TRACK_PAD) / inner) * durationSec;
  return Math.max(0, Math.min(durationSec, t));
}
