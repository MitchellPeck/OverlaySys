import { describe, expect, it } from "vitest";
import { sizeStyle, variantStyle } from "./buttonStyles";
import { colors } from "./tokens";

describe("variantStyle", () => {
  it("never wraps", () => expect(variantStyle("primary", false).whiteSpace).toBe("nowrap"));
  it("primary is the brand fill with white text", () =>
    expect(variantStyle("primary", false)).toMatchObject({ background: colors.brandFill, color: "#fff" }));
  it("onair uses the on-air fill", () => expect(variantStyle("onair", false).background).toBe(colors.onairFill));
  it("a disabled filled button renders as secondary in muted text at full opacity", () => {
    for (const v of ["primary", "onair", "danger", "destructive"] as const) {
      expect(variantStyle(v, true)).toMatchObject({ background: colors.surface2, color: colors.textMuted, opacity: 1 });
    }
  });
  it("danger is an outline in danger text", () =>
    expect(variantStyle("danger", false)).toMatchObject({ background: "transparent", color: colors.dangerText }));
});

describe("sizeStyle", () => {
  it("sizes are 24 and 28 px tall", () => {
    expect(sizeStyle("sm").height).toBe(24);
    expect(sizeStyle("md").height).toBe(28);
  });
});
