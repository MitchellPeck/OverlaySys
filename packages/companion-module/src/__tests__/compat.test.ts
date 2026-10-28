import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { actionDefinitions } from "../actions";
import { feedbackDefinitionsForSDK } from "../feedbacks";
import before from "./fixtures/action-ids-before-2b.json";

const ids = (d: Record<string, any>) =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v.options as any[]).map((o) => o.id)]));

describe("compat", () => {
  it("keeps every action id from before 2b", () => {
    const now = ids(actionDefinitions(initialState(), () => {}));
    for (const [id, opts] of Object.entries(before.actions)) {
      expect(now[id], `action ${id}`).toBeDefined();
      for (const o of opts) expect(now[id], `${id}.${o}`).toContain(o);
    }
    const nowF = ids(feedbackDefinitionsForSDK(initialState(), () => false));
    for (const [id, opts] of Object.entries(before.feedbacks)) {
      expect(nowF[id], `feedback ${id}`).toBeDefined();
      for (const o of opts) expect(nowF[id], `${id}.${o}`).toContain(o);
    }
  });
});
