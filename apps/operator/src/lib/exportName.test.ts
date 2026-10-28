import { describe, expect, it } from "vitest";
import { exportFileName } from "./exportName";

describe("exportFileName", () => {
  it("names songs with and without CCLI", () => {
    expect(exportFileName("song", { id: "s", title: "Placeholder Song", ccliNumber: "123" })).toBe("Placeholder Song (CCLI 123).json");
    expect(exportFileName("song", { id: "s", title: "Placeholder Song" })).toBe("Placeholder Song.json");
  });
  it("slugs templates", () => {
    expect(exportFileName("template", { id: "t", name: "Lower Third / Alt" })).toBe("lower-third-alt.overlaysys-template.json");
  });
  it("falls back to the id for blank names", () => {
    expect(exportFileName("show", { id: "show-1", name: "  " })).toBe("show-1.overlaysys-show.json");
  });
  it("strips illegal characters", () => {
    expect(exportFileName("hotcard", { id: "h", name: 'A/B\\C:D*E?F"G<H>I|J' })).toBe("ABCDEFGHIJ.overlaysys-hotcard.json");
  });
});
