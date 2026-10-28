import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { actionDefinitions } from "../actions";
import { feedbackDefinitionsForSDK } from "../feedbacks";

describe("dropdown choices (2b)", () => {
  it("every dropdown defaulting to '' has an '' choice, and row labels carry no UUID", () => {
    const rows = [
      { id: "11111111-2222-4333-8444-555555555555", kind: "template", templateId: "t", data: {} },
      { id: "22222222-2222-4333-8444-555555555555", kind: "scripture", reference: "John 3:16" },
    ];
    const st = {
      ...initialState(),
      loadedShowId: "s1",
      showCache: new Map([["s1", { id: "s1", rows } as never]]),
    };
    const all = [
      ...Object.values(actionDefinitions(st, () => {})),
      ...Object.values(feedbackDefinitionsForSDK(st, () => false)),
    ];
    let rowDropdowns = 0;
    for (const d of all) {
      for (const o of (d!.options ?? []) as any[]) {
        if (o.type !== "dropdown") continue;
        if (o.default === "") expect(o.choices.some((c: any) => c.id === ""), o.id).toBe(true);
        if (o.id === "rowId" || o.id === "songRowId") {
          rowDropdowns++;
          for (const c of o.choices) expect(c.label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
        }
      }
    }
    expect(rowDropdowns).toBeGreaterThan(0);
  });
});
