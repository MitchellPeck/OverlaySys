import { describe, expect, it } from "vitest";
import { ARM_CONFIRM_MS, armConfirmPress } from "./armConfirm";

describe("armConfirmPress", () => {
  it("arms on the first press and fires on a second press inside the window", () => {
    const first = armConfirmPress(null, 1000);
    expect(first).toEqual({ fire: false, armedUntil: 1000 + ARM_CONFIRM_MS });
    expect(armConfirmPress(first.armedUntil, 2000)).toEqual({ fire: true, armedUntil: null });
  });

  it("re-arms instead of firing once the window has passed", () => {
    const first = armConfirmPress(null, 1000);
    expect(armConfirmPress(first.armedUntil, 1000 + ARM_CONFIRM_MS + 1)).toEqual({
      fire: false,
      armedUntil: 1000 + ARM_CONFIRM_MS + 1 + ARM_CONFIRM_MS,
    });
  });

  it("gives the operator three seconds", () => {
    expect(ARM_CONFIRM_MS).toBe(3000);
  });
});
