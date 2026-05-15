import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrefs, savePrefs } from "./windowPrefs";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "overlaysys-prefs-"));
  file = path.join(dir, "channel-window-prefs.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadPrefs / savePrefs", () => {
  it("returns defaults when the file does not exist", () => {
    expect(loadPrefs(file)).toEqual({ version: 1, displays: [], channels: {} });
  });

  it("round-trips a saved file", () => {
    savePrefs(file, {
      version: 1,
      displays: [],
      channels: {
        program: {
          autoOpen: true,
          displayId: 7,
          fullscreen: true,
          frameless: false,
          alwaysOnTop: false,
          transparent: false,
        },
      },
    });
    expect(loadPrefs(file).channels.program?.displayId).toBe(7);
  });

  it("returns defaults on malformed JSON", () => {
    require("node:fs").writeFileSync(file, "{not-json", "utf8");
    expect(loadPrefs(file)).toEqual({ version: 1, displays: [], channels: {} });
  });
});

import { resolveDisplay, type DisplayLike } from "./windowPrefs";

function display(over: Partial<DisplayLike>): DisplayLike {
  return {
    id: 1,
    label: "Built-in",
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    internal: true,
    ...over,
  };
}

describe("resolveDisplay", () => {
  const builtIn = display({ id: 1, label: "Built-in", internal: true });
  const dell = display({
    id: 2,
    label: "DELL U2718Q",
    bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
    internal: false,
  });
  const displays = [builtIn, dell];

  it("matches by exact id", () => {
    const result = resolveDisplay(
      { displayId: 2 },
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("id");
  });

  it("matches by label when id rotates", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays,
        cached: [
          {
            id: 999,
            label: "DELL U2718Q",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("label");
  });

  it("matches by bounds + internal flag when label differs", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays,
        cached: [
          {
            id: 999,
            label: "Some Other Name",
            bounds: { x: 0, y: 0, width: 3840, height: 2160 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("bounds");
  });

  it("falls back to primary when nothing matches", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(builtIn);
    expect(result.matchedBy).toBe("fallback");
  });

  it("falls back when prefs have no displayId", () => {
    const result = resolveDisplay(
      {},
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(builtIn);
    expect(result.matchedBy).toBe("fallback");
  });

  it("breaks ties by display order", () => {
    const twin = display({
      id: 3,
      label: "Twin",
      bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
      internal: false,
    });
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays: [twin, dell],
        cached: [
          {
            id: 999,
            label: "Mismatch",
            bounds: { x: 0, y: 0, width: 3840, height: 2160 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(twin);
    expect(result.matchedBy).toBe("bounds");
  });
});
