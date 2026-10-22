import fs from "node:fs/promises";
import path from "node:path";
import { ScriptureSettingsSchema, type ScriptureSettings } from "@overlaysys/core";
import { dataRoot } from "./storage";

const file = () => path.join(dataRoot(), "settings", "scripture.json");

/** Install-wide scripture defaults. A missing or unreadable file means "no defaults". */
export async function loadScriptureSettings(): Promise<ScriptureSettings> {
  try {
    const parsed = ScriptureSettingsSchema.safeParse(JSON.parse(await fs.readFile(file(), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function saveScriptureSettings(settings: ScriptureSettings): Promise<ScriptureSettings> {
  const parsed = ScriptureSettingsSchema.parse(settings);
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(parsed, null, 2));
  return parsed;
}
