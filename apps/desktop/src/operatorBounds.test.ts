import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clampBoundsToWorkAreas, loadOperatorBounds, saveOperatorBounds } from "./operatorBounds";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "overlaysys-bounds-"));
  file = path.join(dir, "operator-window.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("load/save operator bounds", () => {
  it("returns null when missing or invalid", () => {
    expect(loadOperatorBounds(file)).toBeNull();
    writeFileSync(file, "{nope");
    expect(loadOperatorBounds(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ x: 0, y: 0, width: -5, height: 10 }));
    expect(loadOperatorBounds(file)).toBeNull();
  });
  it("round-trips", () => {
    saveOperatorBounds(file, { x: 10, y: 20, width: 1400, height: 900, maximized: true });
    expect(loadOperatorBounds(file)).toEqual({ x: 10, y: 20, width: 1400, height: 900, maximized: true });
  });
});

describe("clampBoundsToWorkAreas", () => {
  const primary = { x: 0, y: 25, width: 1440, height: 875 };
  const right = { x: 1440, y: 0, width: 1920, height: 1080 };

  it("keeps bounds that already fit", () => {
    const b = { x: 100, y: 100, width: 1200, height: 700 };
    expect(clampBoundsToWorkAreas(b, [primary, right], primary)).toEqual(b);
  });

  it("pulls a window hanging off the edge back inside the display it mostly covers", () => {
    expect(
      clampBoundsToWorkAreas({ x: 3000, y: 900, width: 800, height: 600 }, [primary, right], primary),
    ).toEqual({ x: 2560, y: 480, width: 800, height: 600 });
  });

  it("shrinks to the work area", () => {
    expect(
      clampBoundsToWorkAreas({ x: 0, y: 0, width: 3000, height: 2000 }, [primary], primary),
    ).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  it("centres on the fallback when the saved monitor is gone", () => {
    expect(
      clampBoundsToWorkAreas({ x: 5000, y: 0, width: 1200, height: 700 }, [primary], primary),
    ).toEqual({ x: 120, y: 113, width: 1200, height: 700 });
  });
});
