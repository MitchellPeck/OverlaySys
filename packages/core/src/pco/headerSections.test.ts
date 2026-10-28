import { describe, expect, it } from "vitest";
import type { Show } from "../show";
import { isPcoSectionId, mergePlanSections, migrateHeaderRows, pcoSectionId, planHeaderSections } from "./headerSections";

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

const pcoRow = (id: string, itemId: string, extra: object = {}) => ({
  kind: "graphic", id, templateId: "t", data: { title: `T${id}` },
  sourceRef: { provider: "pco", serviceTypeId: "st", planId: "p", itemId }, ...extra,
});
const migShow = (): Show => ({
  id: "s", name: "S",
  rows: [
    pcoRow("a", "10"),
    pcoRow("b", "11"),
    { kind: "song", id: "c", songId: "x", sourceRef: { provider: "pco", serviceTypeId: "st", planId: "p", itemId: "12" } },
    { kind: "graphic", id: "d", templateId: "t", data: {} },
  ],
} as unknown as Show);
const H = new Map([["11", "Worship"]]);

describe("migrateHeaderRows", () => {
  it("turns known header rows into sections and files later rows under them", () => {
    const r = migrateHeaderRows(migShow(), H);
    expect(r.changed).toBe(true);
    expect(r.show.sections).toEqual([{ id: "pco-11", name: "Worship" }]);
    expect(r.show.rows.map((x) => [x.id, x.sectionId])).toEqual([["a", undefined], ["c", "pco-11"], ["d", "pco-11"]]);
  });
  it("leaves PCO graphic rows whose item is not a known header", () => {
    const show = migShow();
    expect(migrateHeaderRows(show, new Map([["999", "X"]]))).toEqual({ show, changed: false });
  });
  it("is idempotent", () => {
    const once = migrateHeaderRows(migShow(), H).show;
    expect(migrateHeaderRows(once, H)).toEqual({ show: once, changed: false });
  });
  it("does not move a row that already has a sectionId", () => {
    const show = migShow();
    (show.rows[2] as { sectionId?: string }).sectionId = "mine";
    show.sections = [{ id: "mine", name: "Mine" }];
    const r = migrateHeaderRows(show, H).show;
    expect(r.rows.find((x) => x.id === "c")?.sectionId).toBe("mine");
    expect(r.rows.find((x) => x.id === "d")?.sectionId).toBe("pco-11");
  });
  it("falls back to the row data, then 'Section', for a blank title", () => {
    expect(migrateHeaderRows(migShow(), new Map([["11", " "]])).show.sections).toEqual([{ id: "pco-11", name: "Tb" }]);
  });
});
