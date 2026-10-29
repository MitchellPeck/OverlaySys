import { describe, expect, it } from "vitest";
import { DRAFT_PREVIEW_THROTTLE_MS, draftIdFor, draftPreviewDecision } from "./draftPreview";

describe("draftPreviewDecision", () => {
  it("starts on an empty preview", () => {
    expect(draftPreviewDecision({ previewTemplateId: null, previewName: null, sourceId: "lt" })).toBe("start");
  });

  it("starts when preview already shows this source's draft", () => {
    expect(draftPreviewDecision({ previewTemplateId: "__draft__lt", previewName: "Lower third", sourceId: "lt" })).toBe("start");
  });

  it("asks before replacing anything else", () => {
    expect(draftPreviewDecision({ previewTemplateId: "lower-third", previewName: "Lower third", sourceId: "lt" })).toBe(
      "confirm-replace",
    );
    expect(draftPreviewDecision({ previewTemplateId: "__draft__other", previewName: "Other", sourceId: "lt" })).toBe(
      "confirm-replace",
    );
  });

  it("throttles re-posts to 300 ms and prefixes draft ids", () => {
    expect(DRAFT_PREVIEW_THROTTLE_MS).toBe(300);
    expect(draftIdFor("lt")).toBe("__draft__lt");
  });
});
