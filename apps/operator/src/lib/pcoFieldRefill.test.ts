import { describe, it, expect } from "vitest";
import type { Field, PcoPlanItem } from "@overlaysys/core";
import { refillItemFields } from "./pcoFieldRefill";

const item: PcoPlanItem = {
  id: "i1",
  title: "Announcements",
  itemType: "item",
  description: "Two slides",
};

const oldFields: Field[] = [{ key: "headline", label: "Headline", type: "text" }];
const newFields: Field[] = [
  { key: "headline", label: "Headline", type: "text" },
  { key: "description", label: "Description", type: "text" },
];

describe("refillItemFields", () => {
  it("fills the new template's fields from the plan item", () => {
    expect(
      refillItemFields({ item, templateFields: newFields, data: {}, edited: new Set() }),
    ).toEqual({ headline: "Announcements", description: "Two slides" });
  });

  it("keeps a user-edited value when the new template has that field", () => {
    const out = refillItemFields({
      item,
      templateFields: newFields,
      data: { headline: "Hand typed" },
      edited: new Set(["headline"]),
    });
    expect(out).toEqual({ headline: "Hand typed", description: "Two slides" });
  });

  it("drops a user-edited value when the new template has no such field", () => {
    const out = refillItemFields({
      item,
      templateFields: [{ key: "line1", label: "Line 1", type: "text" }],
      data: { headline: "Hand typed" },
      edited: new Set(["headline"]),
    });
    expect(out).toEqual({ line1: "Announcements" });
  });

  it("does not carry over auto-filled values from the previous template", () => {
    const seeded = refillItemFields({ item, templateFields: oldFields, data: {}, edited: new Set() });
    const out = refillItemFields({
      item,
      templateFields: [{ key: "description", label: "Description", type: "text" }],
      data: seeded,
      edited: new Set(),
    });
    expect(out).toEqual({ description: "Two slides" });
  });
});
