import { describe, expect, it } from "vitest";
import { popoverPosition } from "./popoverPosition";

const vp = { width: 1440, height: 900 };

describe("popoverPosition", () => {
  it("hangs below the anchor with right edges aligned", () => {
    expect(popoverPosition({ top: 40, bottom: 58, right: 1000 }, 400, vp)).toEqual({ left: 720, top: 64 });
  });

  it("clamps to the left margin when the anchor is near the left edge", () => {
    // The reported bug: a gear in a narrow panel near the left would put the popover off-screen.
    expect(popoverPosition({ top: 40, bottom: 58, right: 120 }, 400, vp).left).toBe(8);
  });

  it("clamps to the right margin", () => {
    expect(popoverPosition({ top: 40, bottom: 58, right: 1440 }, 400, vp).left).toBe(1440 - 280 - 8);
  });

  it("flips above when there's no room below", () => {
    expect(popoverPosition({ top: 800, bottom: 818, right: 1000 }, 400, vp).top).toBe(800 - 6 - 400);
  });

  it("pins inside the viewport when it fits neither above nor below", () => {
    expect(popoverPosition({ top: 300, bottom: 318, right: 1000 }, 700, vp).top).toBe(900 - 700 - 8);
  });
});
