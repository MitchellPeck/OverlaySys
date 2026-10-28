import { describe, expect, it } from "vitest";
import { pageBodyStyle } from "./pageBody";

describe("pageBodyStyle", () => {
  it("sets max widths per variant", () => {
    expect(pageBodyStyle("form").maxWidth).toBe(760);
    expect(pageBodyStyle("wide").maxWidth).toBe(1100);
    expect(pageBodyStyle("list").maxWidth).toBeUndefined();
  });
  it("is left-aligned, padded 24, gap 16", () => {
    for (const v of ["form", "wide", "list"] as const) {
      const s = pageBodyStyle(v);
      expect(s.marginLeft).not.toBe("auto");
      expect(s.margin).not.toBe("auto");
      expect(s.padding).toBe(24);
      expect(s.gap).toBe(16);
    }
  });
});
