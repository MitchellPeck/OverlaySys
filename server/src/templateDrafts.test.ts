import { describe, expect, it } from "vitest";
import type { Template } from "@overlaysys/core";
import {
  DRAFT_PREFIX,
  draftTemplateId,
  dropDraftTemplate,
  getDraftTemplate,
  isDraftTemplateId,
  setDraftTemplate,
} from "./templateDrafts";

const tpl = (id: string): Template => ({
  id,
  name: id,
  size: { w: 100, h: 100 },
  fields: [],
  layers: [],
  timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  fonts: [],
});

describe("templateDrafts", () => {
  it("stores a draft under the prefixed id", () => {
    expect(DRAFT_PREFIX).toBe("__draft__");
    expect(draftTemplateId("lt")).toBe("__draft__lt");
    const d = setDraftTemplate(tpl("lt"));
    expect(d.id).toBe("__draft__lt");
    expect(getDraftTemplate("__draft__lt")).toEqual(d);
    expect(isDraftTemplateId("lt")).toBe(false);
    expect(isDraftTemplateId("__draft__lt")).toBe(true);
  });

  it("re-setting the same source replaces it", () => {
    setDraftTemplate({ ...tpl("same"), name: "one" });
    setDraftTemplate({ ...tpl("same"), name: "two" });
    expect(getDraftTemplate("__draft__same")?.name).toBe("two");
  });

  it("keeps at most 10 drafts, evicting the oldest", () => {
    for (let i = 0; i < 11; i++) setDraftTemplate(tpl(`e${i}`));
    expect(getDraftTemplate("__draft__e0")).toBeNull();
    expect(getDraftTemplate("__draft__e1")).not.toBeNull();
    expect(getDraftTemplate("__draft__e10")).not.toBeNull();
  });

  it("drops a draft by its source id", () => {
    setDraftTemplate(tpl("gone"));
    dropDraftTemplate("gone");
    expect(getDraftTemplate("__draft__gone")).toBeNull();
  });
});
