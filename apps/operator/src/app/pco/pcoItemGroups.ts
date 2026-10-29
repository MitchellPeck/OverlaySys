import type { PcoPlanItem } from "@overlaysys/core";

export interface PcoItemGroup {
  header: PcoPlanItem | null;
  items: PcoPlanItem[];
}

/**
 * Group plan items under the header that precedes them. Items before the
 * first header land in a `header: null` group. Plan order is preserved.
 */
export function groupItemsUnderHeaders(items: PcoPlanItem[]): PcoItemGroup[] {
  const groups: PcoItemGroup[] = [];
  let current: PcoItemGroup | null = null;
  for (const item of items) {
    if (item.itemType === "header") {
      current = { header: item, items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { header: null, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
