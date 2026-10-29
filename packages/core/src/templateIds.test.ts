import { describe, expect, it } from "vitest";
import {
  DRAFT_TEMPLATE_PREFIX,
  FALLBACK_TEMPLATE_ID,
  PROTECTED_TEMPLATE_IDS,
  isDraftTemplateId,
  isProtectedTemplateId,
} from "./templateIds";

describe("templateIds", () => {
  it("the fallback lyric template is the protected one", () => {
    expect(FALLBACK_TEMPLATE_ID).toBe("lyric-default");
    expect(PROTECTED_TEMPLATE_IDS).toEqual(["lyric-default"]);
    expect(isProtectedTemplateId("lyric-default")).toBe(true);
    expect(isProtectedTemplateId("lt")).toBe(false);
  });
  it("draft ids", () => {
    expect(DRAFT_TEMPLATE_PREFIX).toBe("__draft__");
    expect(isDraftTemplateId("__draft__lt")).toBe(true);
    expect(isDraftTemplateId("lt")).toBe(false);
  });
});
