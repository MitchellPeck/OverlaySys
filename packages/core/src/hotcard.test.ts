import { describe, expect, it } from "vitest";
import { HotcardSchema } from "./hotcard";

describe("HotcardSchema", () => {
  it("parses a minimal hotcard with explicit projectId", () => {
    const h = HotcardSchema.parse({
      id: "hot-1",
      name: "Welcome",
      templateId: "lower-third",
      data: { title: "Welcome" },
      projectId: "sunday-services",
    });
    expect(h.projectId).toBe("sunday-services");
  });

  it("backfills missing projectId to the default project", () => {
    const h = HotcardSchema.parse({
      id: "hot-legacy",
      name: "Old Card",
      templateId: "lower-third",
      data: {},
    });
    expect(h.projectId).toBe("default");
  });
});
