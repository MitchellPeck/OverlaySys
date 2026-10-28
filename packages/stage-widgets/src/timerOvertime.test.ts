import { describe, expect, it } from "vitest";
import { overtimeView } from "./timerOvertime";

describe("overtimeView", () => {
  it("fill sets a background and white digits", () => {
    const v = overtimeView("fill", true, 0);
    expect(v.background).toBe("overColor");
    expect(v.color).toBe("#ffffff");
    expect(v.pulse).toBe(false);
  });
  it("undefined or text leaves stored layouts unchanged", () => {
    expect(overtimeView(undefined, true, 0).background).toBeUndefined();
    expect(overtimeView("text", true, 0).background).toBeUndefined();
  });
  it("does nothing when not over", () => {
    expect(overtimeView("fill", false, 0)).toEqual({ pulse: false });
  });
  it("flash pulses", () => {
    expect(overtimeView("flash", true, 0).pulse).toBe(true);
    expect(overtimeView("flash", true, 0).background).toBeDefined();
  });
});
