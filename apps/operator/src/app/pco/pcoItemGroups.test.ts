import { describe, expect, it } from "vitest";
import type { PcoPlanItem } from "@overlaysys/core";
import { groupItemsUnderHeaders } from "./pcoItemGroups";

const item = (id: string, itemType: PcoPlanItem["itemType"] = "item"): PcoPlanItem => ({
  id,
  title: id,
  itemType,
});

describe("groupItemsUnderHeaders", () => {
  it("puts leading items in a null-header group and keeps empty trailing headers", () => {
    const i1 = item("i1");
    const H1 = item("H1", "header");
    const i2 = item("i2");
    const i3 = item("i3");
    const H2 = item("H2", "header");
    expect(groupItemsUnderHeaders([i1, H1, i2, i3, H2])).toEqual([
      { header: null, items: [i1] },
      { header: H1, items: [i2, i3] },
      { header: H2, items: [] },
    ]);
  });

  it("returns no groups for an empty plan", () => {
    expect(groupItemsUnderHeaders([])).toEqual([]);
  });

  it("starts with a header group when the plan opens with a header", () => {
    const H = item("H", "header");
    const a = item("a");
    expect(groupItemsUnderHeaders([H, a])).toEqual([{ header: H, items: [a] }]);
  });
});
