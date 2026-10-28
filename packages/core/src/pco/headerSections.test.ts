import { describe, expect, it } from "vitest";
import { isPcoSectionId, mergePlanSections, pcoSectionId, planHeaderSections } from "./headerSections";

const items = [
  { id: "1", itemType: "item" as const, title: "Prelude", sequence: 1 },
  { id: "2", itemType: "header" as const, title: " Worship ", sequence: 2 },
  { id: "3", itemType: "song" as const, title: "Placeholder Song", sequence: 3 },
  { id: "4", itemType: "header" as const, title: "", sequence: 4 },
  { id: "5", itemType: "item" as const, title: "Offertory", sequence: 5 },
];

describe("headerSections", () => {
  it("ids", () => {
    expect(pcoSectionId("9")).toBe("pco-9");
    expect(isPcoSectionId("pco-9")).toBe(true);
    expect(isPcoSectionId("sec-1")).toBe(false);
  });

  it("planHeaderSections opens a section per header", () => {
    const r = planHeaderSections(items);
    expect(r.sections).toEqual([{ id: "pco-2", name: "Worship" }, { id: "pco-4", name: "Section" }]);
    expect([...r.sectionByItem]).toEqual([["3", "pco-2"], ["5", "pco-4"]]);
  });

  it("sorts by sequence", () => {
    const r = planHeaderSections([...items].reverse());
    expect([...r.sectionByItem]).toEqual([["3", "pco-2"], ["5", "pco-4"]]);
  });

  it("mergePlanSections keeps order, renames, inserts", () => {
    const r = planHeaderSections(items);
    expect(mergePlanSections([{ id: "mine", name: "Mine" }, { id: "pco-4", name: "Old" }], r.sections, () => true))
      .toEqual([{ id: "mine", name: "Mine" }, { id: "pco-2", name: "Worship" }, { id: "pco-4", name: "Section" }]);
  });

  it("mergePlanSections honours keep and empty result", () => {
    const r = planHeaderSections(items);
    expect(mergePlanSections(undefined, r.sections, (id) => id === "pco-4")).toEqual([{ id: "pco-4", name: "Section" }]);
    expect(mergePlanSections(undefined, r.sections, () => false)).toBeUndefined();
    expect(mergePlanSections([], [], () => true)).toBeUndefined();
  });
});
