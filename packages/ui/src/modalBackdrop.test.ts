import { describe, expect, it } from "vitest";
import { shouldCloseOnBackdropClick } from "./modalKeys";

describe("shouldCloseOnBackdropClick", () => {
  const backdrop = { id: "backdrop" };
  const input = { id: "input" };

  it("closes when press and click both land on the backdrop", () => {
    expect(shouldCloseOnBackdropClick(backdrop, backdrop, backdrop)).toBe(true);
  });

  it("does not close when the press started inside the dialog (drag-select out of a field)", () => {
    expect(shouldCloseOnBackdropClick(input, backdrop, backdrop)).toBe(false);
  });

  it("does not close when there was no recorded press", () => {
    expect(shouldCloseOnBackdropClick(null, backdrop, backdrop)).toBe(false);
  });

  it("does not close when the click lands off the backdrop", () => {
    expect(shouldCloseOnBackdropClick(backdrop, input, backdrop)).toBe(false);
  });
});
