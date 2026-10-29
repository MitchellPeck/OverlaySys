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

/**
 * The pinned "current item" timer first, then running, paused and not-started
 * timers; ties keep their original order.
 */
export function orderStageTimers(timers: readonly StageTimerInstance[]): StageTimerInstance[] {
  const rank = (t: StageTimerInstance): number =>
    t.id === CURRENT_ITEM_TIMER_ID ? -1 : t.anchor == null ? 2 : t.pausedAt != null ? 1 : 0;
  return timers
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
}

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

/** Hotcard ids in `projectId` whose full body isn't cached yet. */
export function uncachedHotcardIds(
  hotcards: readonly { id: string; projectId: string }[],
  projectId: string,
  cache: Readonly<Record<string, unknown>>,
): string[] {
  return hotcards.filter((h) => h.projectId === projectId && !cache[h.id]).map((h) => h.id);
}

/** Template ids used by cached hotcards (of `projectId`) that aren't in the template cache. */
export function uncachedTemplateIds(
  hotcards: readonly { id: string; projectId: string }[],
  projectId: string,
  hotcardCache: Readonly<Record<string, { templateId: string } | undefined>>,
  templateCache: Readonly<Record<string, unknown>>,
): string[] {
  const out = new Set<string>();
  for (const h of hotcards) {
    if (h.projectId !== projectId) continue;
    const tid = hotcardCache[h.id]?.templateId;
    if (tid && !templateCache[tid]) out.add(tid);
  }
  return [...out];
}
