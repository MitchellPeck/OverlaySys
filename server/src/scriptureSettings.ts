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

// Default translation. Kept in its own file rather than ScriptureSettings
// because that schema lives in @overlaysys/core and strips unknown keys.
const translationFile = () => path.join(dataRoot(), "settings", "scripture-translation.json");

/** The install-wide default translation id, or null when none was chosen. */
export async function loadDefaultTranslation(): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(translationFile(), "utf8")) as { defaultTranslation?: unknown };
    return typeof j.defaultTranslation === "string" && j.defaultTranslation ? j.defaultTranslation : null;
  } catch {
    return null;
  }
}

export async function saveDefaultTranslation(id: string | null): Promise<string | null> {
  await fs.mkdir(path.dirname(translationFile()), { recursive: true });
  await fs.writeFile(translationFile(), JSON.stringify(id ? { defaultTranslation: id } : {}, null, 2));
  return id;
}

/**
 * Move the default translation to the front. Pickers that start on the first
 * translation (scripture row modal, PCO import) then start on the default.
 */
export function withDefaultFirst<T extends { id: string }>(list: readonly T[], defaultId: string | null): T[] {
  const i = defaultId ? list.findIndex((t) => t.id === defaultId) : -1;
  if (i <= 0) return list.slice();
  return [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)];
}
