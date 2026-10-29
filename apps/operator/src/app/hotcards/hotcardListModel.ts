// Pure sort model for the /hotcards library list.
import type { HotcardMeta } from "@overlaysys/core";

/** "F12" -> 12; anything else (unassigned) -> null. */
export function hotkeyNumber(h: Pick<HotcardMeta, "hotkey">): number | null {
  const m = /^F(\d{1,2})$/.exec(h.hotkey ?? "");
  return m ? Number(m[1]) : null;
}

const byName = (a: HotcardMeta, b: HotcardMeta) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** F1..F12 numerically, unassigned last, ties broken by name. */
function byKey(a: HotcardMeta, b: HotcardMeta): number {
  const ka = hotkeyNumber(a);
  const kb = hotkeyNumber(b);
  if (ka !== null && kb !== null && ka !== kb) return ka - kb;
  if (ka !== null && kb === null) return -1;
  if (ka === null && kb !== null) return 1;
  return byName(a, b);
}

/** Output column text: the channel's name, "Program" when unset, "Unknown output" for a dangling id. */
export function outputLabel(hint: string | undefined, channels: readonly { id: string; name: string }[]): string {
  if (!hint || hint === "program" || hint === "preview") return "Program";
  return channels.find((c) => c.id === hint)?.name ?? "Unknown output";
}

/** Keep the card's F-key on a move unless the target project already uses it. */
export function moveHotkey(
  card: Pick<HotcardMeta, "id" | "hotkey">,
  targetProjectId: string,
  all: readonly Pick<HotcardMeta, "id" | "projectId" | "hotkey">[],
): { hotkey: HotcardMeta["hotkey"]; droppedFrom: NonNullable<HotcardMeta["hotkey"]> | null } {
  const key = card.hotkey ?? null;
  if (!key) return { hotkey: null, droppedFrom: null };
  const clash = all.some((o) => o.id !== card.id && o.projectId === targetProjectId && o.hotkey === key);
  return clash ? { hotkey: null, droppedFrom: key } : { hotkey: key, droppedFrom: null };
}

export const hotcardSorts = [
  { id: "key-asc", label: "F-key", compare: byKey },
  { id: "name-asc", label: "Name", compare: byName },
];
