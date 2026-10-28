import { describe, expect, it } from "vitest";
import { layerDisplay, revealClipPath, revealRefBox } from "./dom";

const T = { x: 100, y: 200, w: 400, h: 10, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };
const rest = { dx: 0, dy: 0, w: 400, h: 10, scaleX: 1, scaleY: 1 };

describe("revealRefBox", () => {
  it("is the declared box at rest", () => {
    expect(revealRefBox(T, rest)).toEqual({ x: 100, y: 200, w: 400, h: 10 });
  });

  it("follows an animated translate", () => {
    expect(revealRefBox(T, { ...rest, dx: 50, dy: -20 })).toEqual({ x: 150, y: 180, w: 400, h: 10 });
  });

  it("follows an animated size", () => {
    expect(revealRefBox(T, { ...rest, w: 100 })).toEqual({ x: 100, y: 200, w: 100, h: 10 });
  });

  it("scales about the anchor", () => {
    const centred = { ...T, anchorX: 0.5, anchorY: 0.5 };
    expect(revealRefBox(centred, { ...rest, scaleX: 0.5 })).toEqual({ x: 200, y: 200, w: 200, h: 10 });
  });

  it("flips a negative scale across the anchor", () => {
    expect(revealRefBox(T, { ...rest, scaleX: -1 })).toEqual({ x: -300, y: 200, w: 400, h: 10 });
  });
});

describe("revealClipPath", () => {
  it("puts a half-plane edge on the moved reference", () => {
    const box = revealRefBox(T, { ...rest, dy: 40 });
    expect(revealClipPath(box, "below", 1920, 1080)).toBe("polygon(0 0, 100% 0, 100% 250px, 0 250px)");
  });
});

describe("layerDisplay", () => {
  // applyVisibility runs after applyLayerAppearance; restoring a visible text
  // layer to "" (block) dropped the flex column its alignment relies on.
  it("keeps a visible text layer as the flex column its alignment needs", () => {
    expect(layerDisplay({ type: "text", visible: true } as never)).toBe("flex");
  });
  it("leaves other visible layers on their default display", () => {
    expect(layerDisplay({ type: "shape", visible: true } as never)).toBe("");
    expect(layerDisplay({ type: "group", visible: true } as never)).toBe("");
  });
  it("hides an invisible layer of any type", () => {
    expect(layerDisplay({ type: "text", visible: false } as never)).toBe("none");
    expect(layerDisplay({ type: "image", visible: false } as never)).toBe("none");
  });
});
