import { describe, expect, it } from "vitest";
import { thumbKey } from "./thumbKey";

describe("thumbKey", () => {
  it("is order independent and sensitive to data and updatedAt", () => {
    expect(thumbKey("t", { a: "1", b: "2" })).toBe(thumbKey("t", { b: "2", a: "1" }));
    expect(thumbKey("t", { a: "1" })).not.toBe(thumbKey("t", { a: "2" }));
    expect(thumbKey("t", { a: "1" }, "2026-10-01")).not.toBe(thumbKey("t", { a: "1" }, "2026-10-02"));
    expect(thumbKey("t", {})).toMatch(/^[0-9a-f]{8}$/);
  });
});
