/** CSS cubic-bezier easing: Newton–Raphson (8 iterations), bisection fallback. */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const EPS = 1e-6;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  const solveS = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < EPS) return s;
      const d = slopeX(s);
      if (Math.abs(d) < EPS) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (lo < hi) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < EPS) return s;
      if (err > 0) hi = s;
      else lo = s;
      s = (hi - lo) / 2 + lo;
      if (hi - lo < EPS) break;
    }
    return s;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveS(t));
  };
}
