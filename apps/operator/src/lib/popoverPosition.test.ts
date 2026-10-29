import { describe, expect, it } from "vitest";
import { popoverAvoiding, popoverPosition } from "./popoverPosition";

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

  it("placement left hangs beside the anchor, top-aligned", () => {
    expect(popoverPosition({ top: 100, bottom: 118, left: 1000, right: 1020 }, 300, vp, 320, "left")).toEqual({
      left: 1000 - 6 - 320,
      top: 100,
    });
  });

  it("popoverAvoiding leaves a non-overlapping popover alone and nudges an overlapping one below", () => {
    const avoid = { left: 320, right: 990, top: 40, bottom: 270 };
    const size = { width: 340, height: 400 };
    expect(popoverAvoiding({ left: 1000, top: 76 }, size, avoid, 900)).toEqual({ left: 1000, top: 76 });
    expect(popoverAvoiding({ left: 640, top: 76 }, size, avoid, 900)).toEqual({ left: 640, top: 270 + 6 + 2 });
    expect(popoverAvoiding({ left: 640, top: 76 }, size, null, 900)).toEqual({ left: 640, top: 76 });
    // No room below the monitors: as low as the viewport allows.
    expect(popoverAvoiding({ left: 640, top: 76 }, size, avoid, 600)).toEqual({ left: 640, top: 600 - 400 - 8 });
  });

  it("placement left clamps into the viewport", () => {
    expect(popoverPosition({ top: 800, bottom: 818, left: 200, right: 220 }, 300, vp, 320, "left")).toEqual({
      left: 8,
      top: 900 - 300 - 8,
    });
  });
});
