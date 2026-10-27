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

/** The id of the item PCO is on; a header resolves to the next non-header item. */
function currentNonHeaderId(raw: PcoLiveRaw): string | null {
  if (raw.currentItemId === null) return null;
  const all = [...raw.items].sort((a, b) => a.sequence - b.sequence);
  const at = all.findIndex((i) => i.id === raw.currentItemId);
  if (at < 0) return raw.currentItemId;
  return all.slice(at).find((i) => i.itemType !== "header")?.id ?? null;
}

export function mapPcoLive(raw: PcoLiveRaw, now: number): StageServiceView {
  const items = raw.items
    .filter((i) => i.itemType !== "header")
    .sort((a, b) => a.sequence - b.sequence);
  const currentId = currentNonHeaderId(raw);
  const idx = currentId === null ? -1 : items.findIndex((i) => i.id === currentId);
  // A current item without a parseable start time can't anchor anything:
  // treat it as no usable current item.
  const startedAt = ms(raw.currentStartedAt);
  const cur = idx >= 0 && startedAt !== undefined ? items[idx] : undefined;
  const plannedEndAt = ms(raw.serviceEndsAt);
  const base = {
    source: "pco" as const,
    planTitle: raw.planTitle,
    itemCount: items.length,
    ...(plannedEndAt !== undefined ? { plannedEndAt } : {}),
  };

  if (!cur || startedAt === undefined) {
    // The raw Live shape (see server/src/pco/__fixtures__/README.md) has no
    // field that marks a finished session, so "ended" is inferred: nothing is
    // current and the planned service end has passed.
    const ended = plannedEndAt !== undefined && plannedEndAt < now;
    return {
      ...base,
      itemIndex: 0,
      current: null,
      next: null,
      laterLengthSec: 0,
      status: ended ? "ended" : "notStarted",
    };
  }
  const later = items.slice(idx + 1);
  // Prefer PCO's own idea of the next item when it names a real, non-header
  // item other than the current one; else the next by sequence.
  const pcoNext =
    raw.nextItemId && raw.nextItemId !== cur.id ? items.find((i) => i.id === raw.nextItemId) : undefined;
  const next = pcoNext ?? later[0];
  return {
    ...base,
    itemIndex: idx + 1,
    current: {
      id: cur.id,
      title: cur.title,
      startedAt,
      ...(cur.lengthSec !== undefined ? { lengthSec: cur.lengthSec } : {}),
    },
    next: next ? { title: next.title } : null,
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
