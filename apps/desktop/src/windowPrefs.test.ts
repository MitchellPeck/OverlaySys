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
