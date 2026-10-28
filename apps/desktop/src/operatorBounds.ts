// Remember where the operator put the console window, like windowPrefs does
// for channel windows. Pure (no `electron` import) so it is unit-testable.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OperatorBounds extends Rect {
  maximized: boolean;
}

const Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  maximized: z.boolean().default(false),
});

export function loadOperatorBounds(file: string): OperatorBounds | null {
  try {
    const parsed = Schema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveOperatorBounds(file: string, bounds: OperatorBounds): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Schema.parse(bounds), null, 2), "utf8");
  } catch {
    /* best-effort — losing the position is harmless */
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Fit saved bounds onto the displays attached now. Picks the work area the
 * saved window overlaps most; if it overlaps none (that monitor is gone),
 * centres it on `fallback` (the primary work area). The result is never
 * larger than its work area and always lies fully inside it, so a window
 * saved on an unplugged monitor can't open off-screen.
 */
export function clampBoundsToWorkAreas(
  saved: Rect,
  workAreas: Rect[],
  fallback: Rect,
  min: { width: number; height: number } = { width: 0, height: 0 },
): Rect {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const wa of workAreas) {
    const a = overlapArea(saved, wa);
    if (a > bestArea) {
      best = wa;
      bestArea = a;
    }
  }
  const area = best ?? fallback;
  const width = Math.min(Math.max(saved.width, Math.min(min.width, area.width)), area.width);
  const height = Math.min(Math.max(saved.height, Math.min(min.height, area.height)), area.height);
  if (!best) {
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    };
  }
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}
