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

export const hotcardSorts = [
  { id: "key-asc", label: "F-key", compare: byKey },
  { id: "name-asc", label: "Name", compare: byName },
];
