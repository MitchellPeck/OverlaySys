/** Round half away from zero to `dp` decimal places. */
export function roundTo(v: number, dp: number): number {
  const f = 10 ** dp;
  const r = (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
  return r === 0 ? 0 : r;
}

/** Fixed-point text without trailing zeros. */
export function formatNumber(v: number, dp: number): string {
  const r = roundTo(v, dp);
  const s = r.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Decimal places for display and commit. precision wins; int → 0; else from step; default 2. */
export function decimalsFor(step?: number, int?: boolean, precision?: number): number {
  if (precision !== undefined) return precision;
  if (int) return 0;
  if (step !== undefined && step > 0) {
    const s = String(step);
    const dot = s.indexOf(".");
    return dot === -1 ? 0 : s.length - dot - 1;
  }
  return 2;
}

type Opts = { min?: number; max?: number; int?: boolean; step?: number; precision?: number };

function clamp(v: number, o: Opts): number {
  let r = v;
  if (o.min !== undefined && r < o.min) r = o.min;
  if (o.max !== undefined && r > o.max) r = o.max;
  return r;
}

/** Parse user text; null when unparseable. Accepts "," as decimal point. */
export function parseDraft(text: string, o: Opts): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return roundTo(clamp(n, o), decimalsFor(o.step, o.int, o.precision));
}

/** Step by ±step (Shift = ×10), clamped and rounded. */
export function stepValue(v: number, dir: 1 | -1, o: Opts & { big?: boolean }): number {
  const step = (o.step ?? (o.int ? 1 : 1)) * (o.big ? 10 : 1);
  return roundTo(clamp(v + dir * step, o), decimalsFor(o.step, o.int, o.precision));
}
