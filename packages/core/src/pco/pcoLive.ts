import { z } from "zod";
import type { PcoLiveRaw } from "./pcoTypes";

export const StageServiceViewSchema = z.object({
  source: z.literal("pco"),
  planTitle: z.string(),
  itemIndex: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  current: z
    .object({ id: z.string(), title: z.string(), startedAt: z.number(), lengthSec: z.number().optional() })
    .nullable(),
  next: z.object({ title: z.string() }).nullable(),
  /** Summed length of the non-header items after the current one. */
  laterLengthSec: z.number().nonnegative(),
  plannedEndAt: z.number().optional(),
  status: z.enum(["live", "notStarted", "ended", "error"]),
  error: z.string().optional(),
});
export type StageServiceView = z.infer<typeof StageServiceViewSchema>;

function ms(iso: string | null): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

export function mapPcoLive(raw: PcoLiveRaw): StageServiceView {
  const items = raw.items
    .filter((i) => i.itemType !== "header")
    .sort((a, b) => a.sequence - b.sequence);
  const idx = raw.currentItemId === null ? -1 : items.findIndex((i) => i.id === raw.currentItemId);
  const cur = idx >= 0 ? items[idx] : undefined;
  const plannedEndAt = ms(raw.serviceEndsAt);
  const base = {
    source: "pco" as const,
    planTitle: raw.planTitle,
    itemCount: items.length,
    ...(plannedEndAt !== undefined ? { plannedEndAt } : {}),
  };

  if (!cur) {
    // Status "ended" is never produced: the raw Live shape (see
    // server/src/pco/__fixtures__/README.md) documents no field that
    // distinguishes a finished session from one not yet started.
    return { ...base, itemIndex: 0, current: null, next: null, laterLengthSec: 0, status: "notStarted" };
  }
  const later = items.slice(idx + 1);
  return {
    ...base,
    itemIndex: idx + 1,
    current: {
      id: cur.id,
      title: cur.title,
      startedAt: ms(raw.currentStartedAt) ?? 0,
      ...(cur.lengthSec !== undefined ? { lengthSec: cur.lengthSec } : {}),
    },
    next: later[0] ? { title: later[0].title } : null,
    laterLengthSec: later.reduce((s, i) => s + (i.lengthSec ?? 0), 0),
    status: "live",
  };
}

/** Projected overrun in seconds (positive = over), or null when unknowable. */
export function serviceDeltaSec(view: StageServiceView, now: number): number | null {
  if (view.plannedEndAt === undefined || view.current === null) return null;
  const { startedAt, lengthSec } = view.current;
  const remaining = lengthSec !== undefined ? Math.max(0, (startedAt + lengthSec * 1000 - now) / 1000) : 0;
  const projectedEnd = now + remaining * 1000 + view.laterLengthSec * 1000;
  return Math.round((projectedEnd - view.plannedEndAt) / 1000);
}
