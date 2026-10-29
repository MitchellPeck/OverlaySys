import { CURRENT_ITEM_TIMER_ID, type StageTimerInstance } from "@overlaysys/core";

export const DRAWER_OPEN_KEY = "overlaysys:live:drawerOpen";
export const DOUBLE_CLICK_TAKES_KEY = "overlaysys:live:doubleClickTakes";
export const drawerSectionKey = (id: string): string => `overlaysys:live:drawer:${id}`;
export const DRAWER_OPEN_WIDTH = 280;
export const DRAWER_COLLAPSED_WIDTH = 40;

type ReadableStorage = Pick<Storage, "getItem">;

/** A persisted boolean: only the exact strings "true"/"false" count, anything else is the default. */
export function readBool(storage: ReadableStorage | null, key: string, fallback: boolean): boolean {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw === "true" ? true : raw === "false" ? false : fallback;
  } catch {
    return fallback;
  }
}

/** Running timers first, then paused, then not started; ties keep their original order. */
export function orderStageTimers(timers: readonly StageTimerInstance[]): StageTimerInstance[] {
  const rank = (t: StageTimerInstance): number => (t.anchor == null ? 2 : t.pausedAt != null ? 1 : 0);
  return timers
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
}

/** True when the timer is the pinned "current item" one. */
export const isItemTimer = (t: Pick<StageTimerInstance, "id">): boolean => t.id === CURRENT_ITEM_TIMER_ID;

/** Warn-row copy for each active stage layout preview, using channel display names. */
export function stagePreviewWarnings(
  previews: readonly { channel: string; layoutId: string }[],
  channels: readonly { id: string; name: string }[],
): { channel: string; text: string }[] {
  return previews.map((p) => ({
    channel: p.channel,
    text: `Stage layout preview is showing on ${channels.find((c) => c.id === p.channel)?.name ?? p.channel}`,
  }));
}

/** Names of the stage displays a stage message reaches. */
export function stageTargetNames(channels: readonly { id: string; name: string; kind?: string }[]): string[] {
  return channels.filter((c) => c.kind === "stage").map((c) => c.name);
}

/** The first non-empty image-field value of a hotcard's data, or null. */
export function hotcardImageValue(
  fields: readonly { key: string; type: string }[] | undefined,
  data: Readonly<Record<string, string>> | undefined,
): string | null {
  for (const f of fields ?? []) {
    if (f.type !== "image") continue;
    const v = data?.[f.key];
    if (v) return v;
  }
  return null;
}

/** True when any show row came from Planning Center. */
export function showHasPcoItems(rows: readonly unknown[] | undefined): boolean {
  return !!rows?.some((r) => !!(r as { sourceRef?: unknown }).sourceRef);
}
