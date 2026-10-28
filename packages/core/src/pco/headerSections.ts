import type { ShowSection } from "../show";
import type { PcoPlanItem } from "./pcoTypes";

const PCO_SECTION_PREFIX = "pco-";

/** Show-section id for a Planning Center header item. */
export function pcoSectionId(itemId: string): string {
  return PCO_SECTION_PREFIX + itemId;
}

export function isPcoSectionId(id: string): boolean {
  return id.startsWith(PCO_SECTION_PREFIX);
}

/**
 * Turn a plan's header items into show sections. Each header opens a section;
 * every later non-header item maps to the open section. Items before the first
 * header are unmapped.
 */
export function planHeaderSections(
  items: Pick<PcoPlanItem, "id" | "itemType" | "title" | "sequence">[],
): { sections: ShowSection[]; sectionByItem: Map<string, string> } {
  const ordered = items
    .map((it, i) => ({ it, key: it.sequence ?? i, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.it);
  const sections: ShowSection[] = [];
  const sectionByItem = new Map<string, string>();
  let open: string | undefined;
  for (const it of ordered) {
    if (it.itemType === "header") {
      const section = { id: pcoSectionId(it.id), name: it.title.trim() || "Section" };
      sections.push(section);
      open = section.id;
    } else if (open !== undefined) {
      sectionByItem.set(it.id, open);
    }
  }
  return { sections, sectionByItem };
}

/**
 * Merge a plan's sections into a show's. Existing sections keep their order
 * (PCO ones take the plan's current name). Plan sections not yet present and
 * accepted by `keep` are inserted after the nearest preceding plan section
 * already in the list, else before the nearest following one, else appended.
 */
export function mergePlanSections(
  existing: ShowSection[] | undefined,
  plan: ShowSection[],
  keep: (id: string) => boolean,
): ShowSection[] | undefined {
  const planById = new Map(plan.map((s) => [s.id, s]));
  const out: ShowSection[] = (existing ?? []).map((s) => {
    const p = isPcoSectionId(s.id) ? planById.get(s.id) : undefined;
    return p && p.name !== s.name ? { ...s, name: p.name } : s;
  });
  const present = new Set(out.map((s) => s.id));
  plan.forEach((s, i) => {
    if (present.has(s.id) || !keep(s.id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) {
      const k = out.findIndex((x) => x.id === plan[j]!.id);
      if (k >= 0) at = k + 1;
    }
    if (at < 0) {
      for (let j = i + 1; j < plan.length && at < 0; j++) {
        const k = out.findIndex((x) => x.id === plan[j]!.id);
        if (k >= 0) at = k;
      }
    }
    if (at < 0) out.push(s);
    else out.splice(at, 0, s);
    present.add(s.id);
  });
  return out.length > 0 ? out : undefined;
}
