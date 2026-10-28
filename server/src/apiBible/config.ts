import fs from "node:fs/promises";
import path from "node:path";
import {
  ApiBibleProvider,
  apiBibleTranslationId,
  apiBibleTranslationMeta,
  findNivBible,
  listApiBibles,
  NIV_TRANSLATION,
  ScriptureProviderError,
  type ApiBibleEntry,
  type ApiBibleSummary,
  type FetchLike,
} from "@overlaysys/scripture";
import { dataRoot } from "../storage";
import { getScriptureRegistry } from "../scripture";

// The church's API.Bible key: env OVERLAYSYS_API_BIBLE_KEY, else a 0600 file
// in the data dir. Resolving the key finds the NIV and registers it next to
// the bundled translations. The key itself never leaves this module.
//
// Translations: by default (no `bibles` in the settings file) only the NIV is
// registered, as before. Once the operator picks translations, the file's
// `bibles` list is the exact set registered — NIV included only if picked.

export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";

/** A registered API.Bible translation, as reported to the operator. */
export interface ApiBibleTranslationInfo {
  id: string;
  bibleId: string;
  abbreviation: string;
  name: string;
}

export interface ApiBibleStatus {
  configured: boolean;
  source: "env" | "file" | null;
  state: ApiBibleState;
  bibleId?: string;
  /** Registered API.Bible translations (empty when none). */
  translations?: ApiBibleTranslationInfo[];
  /** "default" = NIV only (never customised); "custom" = operator's pick. */
  selection?: "default" | "custom";
}

/** One picked Bible as persisted in the settings file. */
interface StoredBible {
  bibleId: string;
  /** Translation id used in rows ("NIV", "ESV", "KJV-API"). */
  id: string;
  abbreviation: string;
  name: string;
  language: string;
}

interface SettingsFile {
  apiKey?: string;
  bibles?: StoredBible[];
}

const RETRY_MS = 60_000;
const settingsFile = () => path.join(dataRoot(), "settings", "api-bible.json");
const envKey = () => process.env["OVERLAYSYS_API_BIBLE_KEY"]?.trim() || null;

let provider: ApiBibleProvider | null = null;
let status: ApiBibleStatus = { configured: false, source: null, state: "no_key" };
let lastInitAt = 0;
let fetchImpl: FetchLike | undefined;

async function readSettings(): Promise<SettingsFile> {
  try {
    const j = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as Record<string, unknown>;
    const out: SettingsFile = {};
    if (typeof j["apiKey"] === "string" && j["apiKey"].trim()) out.apiKey = j["apiKey"].trim();
    if (Array.isArray(j["bibles"])) {
      out.bibles = (j["bibles"] as unknown[]).filter(
        (b): b is StoredBible =>
          !!b &&
          typeof b === "object" &&
          typeof (b as StoredBible).bibleId === "string" &&
          typeof (b as StoredBible).id === "string",
      );
    }
    return out;
  } catch {
    return {};
  }
}

async function writeSettings(next: SettingsFile): Promise<void> {
  const body: SettingsFile = {};
  if (next.apiKey) body.apiKey = next.apiKey;
  if (next.bibles) body.bibles = next.bibles;
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(body), { mode: 0o600 });
  await fs.chmod(settingsFile(), 0o600);
}

async function fileKey(): Promise<string | null> {
  return (await readSettings()).apiKey ?? null;
}

async function probe(key: string): Promise<{ state: ApiBibleState; bibleId?: string }> {
  try {
    const hit = await findNivBible(key, fetchImpl);
    return hit ? { state: "ok", bibleId: hit.bibleId } : { state: "no_niv" };
  } catch (e) {
    if (e instanceof ScriptureProviderError && e.code === "rejected") return { state: "rejected" };
    // Anything else (network, odd responses) — treat as unreachable and retry later.
    return { state: "offline" };
  }
}

function uninstall(): void {
  if (provider) getScriptureRegistry().unregister(provider);
  provider = null;
}

function entriesFor(nivBibleId: string | undefined, bibles: StoredBible[] | undefined): ApiBibleEntry[] {
  if (!bibles) return nivBibleId ? [{ bibleId: nivBibleId, translation: NIV_TRANSLATION }] : [];
  return bibles.map((b) => ({
    bibleId: b.bibleId,
    translation:
      b.id === NIV_TRANSLATION.id
        ? NIV_TRANSLATION
        : apiBibleTranslationMeta(
            { bibleId: b.bibleId, abbreviation: b.abbreviation, name: b.name, language: b.language },
            b.id,
          ),
  }));
}

function install(key: string, entries: ApiBibleEntry[]): void {
  uninstall();
  if (entries.length === 0) return;
  provider = new ApiBibleProvider({ apiKey: key, bibles: entries, fetch: fetchImpl });
  try {
    getScriptureRegistry().register(provider);
  } catch (e) {
    // An id collision (a stored id that a bundled translation now uses):
    // keep scripture working with what's left rather than registering nothing.
    console.warn("[api-bible] translation id collision", e instanceof Error ? e.message : e);
    const taken = new Set(getScriptureRegistry().listTranslations().map((t) => t.id));
    const rest = entries.filter((en) => !taken.has(en.translation.id));
    provider = rest.length ? new ApiBibleProvider({ apiKey: key, bibles: rest, fetch: fetchImpl }) : null;
    if (provider) getScriptureRegistry().register(provider);
  }
}

function describe(entries: readonly ApiBibleEntry[]): ApiBibleTranslationInfo[] {
  const registered = new Set(provider?.translations.map((t) => t.id) ?? []);
  return entries
    .filter((e) => registered.has(e.translation.id))
    .map((e) => ({
      id: e.translation.id,
      bibleId: e.bibleId,
      abbreviation: e.translation.abbreviation,
      name: e.translation.name,
    }));
}

async function apply(key: string, source: "env" | "file"): Promise<ApiBibleStatus> {
  const p = await probe(key);
  const { bibles } = await readSettings();
  let state = p.state;
  let entries: ApiBibleEntry[] = [];
  if (p.state === "ok" || p.state === "no_niv") {
    entries = entriesFor(p.bibleId, bibles);
    install(key, entries);
    // A key without NIV is fine once the operator picked other translations.
    if (bibles && bibles.length > 0) state = "ok";
  } else uninstall();
  status = {
    configured: true,
    source,
    state,
    ...(p.bibleId ? { bibleId: p.bibleId } : {}),
    translations: describe(entries),
    selection: bibles ? "custom" : "default",
  };
  return status;
}

export async function initApiBible(): Promise<ApiBibleStatus> {
  lastInitAt = Date.now();
  const env = envKey();
  if (env) return apply(env, "env");
  const file = await fileKey();
  if (file) return apply(file, "file");
  uninstall();
  status = { configured: false, source: null, state: "no_key" };
  return status;
}

/** Retry a failed (offline) init, at most once per minute. */
export async function ensureApiBible(now: number = Date.now()): Promise<void> {
  if (status.state === "offline" && now - lastInitAt >= RETRY_MS) await initApiBible();
}

export function getApiBibleStatus(): ApiBibleStatus {
  return { ...status };
}

export function getApiBibleProvider(): ApiBibleProvider | null {
  return provider;
}

/**
 * Validate and save a key. A key that works is written even when it has no
 * NIV (state "no_niv"), so the operator can pick other translations for it;
 * rejected/offline keys are never written.
 */
export async function setApiBibleKey(key: string): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  const p = await probe(key);
  if (p.state !== "ok" && p.state !== "no_niv") {
    return { configured: status.configured, source: status.source, state: p.state };
  }
  const prev = await readSettings();
  await writeSettings({ ...prev, apiKey: key });
  return apply(key, "file");
}

export async function clearApiBibleKey(): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  await fs.rm(settingsFile(), { force: true });
  uninstall();
  status = { configured: false, source: null, state: "no_key" };
  return status;
}

async function currentKey(): Promise<{ key: string; source: "env" | "file" } | null> {
  const env = envKey();
  if (env) return { key: env, source: "env" };
  const file = await fileKey();
  return file ? { key: file, source: "file" } : null;
}

/** Bibles the configured key can read. Null when no key is configured. */
export async function listLicensedBibles(): Promise<ApiBibleSummary[] | null> {
  const k = await currentKey();
  if (!k) return null;
  return listApiBibles(k.key, fetchImpl);
}

/**
 * Pick which licensed Bibles to register. Ids are minted once here (NIV keeps
 * "NIV"; others their abbreviation unless a bundled translation has it) and
 * persisted, so rows saved with them keep resolving.
 * Returns null when no key is configured.
 */
export async function setApiBibleTranslations(
  bibleIds: readonly string[],
): Promise<{ status: ApiBibleStatus; unknown: string[] } | null> {
  const k = await currentKey();
  if (!k) return null;
  const available = await listApiBibles(k.key, fetchImpl);
  const byId = new Map(available.map((b) => [b.bibleId, b]));
  const prev = await readSettings();
  const prevIds = new Map((prev.bibles ?? []).map((b) => [b.bibleId, b.id]));
  // Ids taken by other providers (bundled), not by our own current provider.
  const ours = new Set(provider?.translations.map((t) => t.id) ?? []);
  const taken = new Set(
    getScriptureRegistry()
      .listTranslations()
      .map((t) => t.id)
      .filter((id) => !ours.has(id)),
  );
  const nivBibleId = (await probe(k.key)).bibleId;
  const bibles: StoredBible[] = [];
  const unknown: string[] = [];
  for (const bibleId of new Set(bibleIds)) {
    const b = byId.get(bibleId);
    if (!b) {
      unknown.push(bibleId);
      continue;
    }
    const isNiv = bibleId === nivBibleId || b.abbreviation.toUpperCase() === "NIV";
    const prevId = prevIds.get(bibleId);
    const id =
      isNiv && !taken.has("NIV")
        ? "NIV"
        : prevId && !taken.has(prevId)
          ? prevId
          : apiBibleTranslationId(b.abbreviation, taken);
    taken.add(id);
    bibles.push({ bibleId, id, abbreviation: b.abbreviation, name: b.name, language: b.language });
  }
  await writeSettings({ ...prev, bibles });
  return { status: await apply(k.key, k.source), unknown };
}

/** @internal */
export function _setApiBibleFetchForTest(f: FetchLike | undefined): void {
  fetchImpl = f;
}
