import fs from "node:fs";
import path from "node:path";
import {
  WindowPrefsFileSchema,
  type WindowPrefsFile,
} from "@overlaysys/core";

const DEFAULTS: WindowPrefsFile = {
  version: 1,
  displays: [],
  channels: {},
};

export function loadPrefs(file: string): WindowPrefsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return structuredClone(DEFAULTS);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
  const result = WindowPrefsFileSchema.safeParse(parsed);
  return result.success ? result.data : structuredClone(DEFAULTS);
}

export function savePrefs(file: string, prefs: WindowPrefsFile): void {
  const validated = WindowPrefsFileSchema.parse(prefs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(validated, null, 2), "utf8");
}
