import { describe, expect, it } from "vitest";
import { createEditCoalescer, isContinuousInput } from "./editCoalescer";
import { stepZoom, wheelZoom, zoomShortcut, MAX_ZOOM, MIN_ZOOM } from "./canvasView";

const input = (type: string) => ({ tagName: "INPUT", type }) as unknown as EventTarget;

describe("createEditCoalescer", () => {
  function setup() {
    const log: string[] = [];
    const c = createEditCoalescer<number>(
      () => log.push("commit"),
      () => log.push("live"),
    );
    return { c, log };
  }

  it("typing in one field makes one undo step", () => {
    const { c, log } = setup();
    c.reset(); // focus
    for (let i = 0; i < 4; i++) {
      c.noteChange(input("text"));
      c.run(() => {});
    }
    expect(log).toEqual(["commit", "live", "live", "live"]);
  });

  it("moving focus starts a new step", () => {
    const { c, log } = setup();
    c.reset();
    c.noteChange(input("number"));
    c.run(() => {});
    c.reset(); // blur / focus next field
    c.noteChange(input("number"));
    c.run(() => {});
    expect(log).toEqual(["commit", "commit"]);
  });

  it("discrete controls always commit", () => {
    const { c, log } = setup();
    c.reset();
    c.noteChange({ tagName: "SELECT" } as unknown as EventTarget);
    c.run(() => {});
    c.noteChange({ tagName: "SELECT" } as unknown as EventTarget);
    c.run(() => {});
    c.noteClick();
    c.run(() => {});
    c.noteChange(input("checkbox"));
    c.run(() => {});
    expect(log).toEqual(["commit", "commit", "commit", "commit"]);
  });

  it("classifies inputs", () => {
    expect(isContinuousInput(input("text"))).toBe(true);
    expect(isContinuousInput(input("color"))).toBe(true);
    expect(isContinuousInput({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isContinuousInput(input("checkbox"))).toBe(false);
    expect(isContinuousInput(null)).toBe(false);
  });
});

describe("canvas zoom", () => {
  it("steps through the zoom levels and clamps", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.2, 1)).toBe(1.5);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("wheel zoom is continuous and clamped", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(MAX_ZOOM, -10000)).toBe(MAX_ZOOM);
  });

  it("maps ⌘ + = / − / 0", () => {
    const k = (key: string, code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = { metaKey: true }) =>
      zoomShortcut({ key, code, metaKey: false, ctrlKey: false, altKey: false, ...mods });
    expect(k("=", "Equal")).toBe("in");
    expect(k("-", "Minus", { ctrlKey: true })).toBe("out");
    expect(k("0", "Digit0")).toBe("reset");
    expect(k("=", "Equal", {})).toBeNull();
    expect(k("0", "Digit0", { metaKey: true, altKey: true })).toBeNull();
  });
});
