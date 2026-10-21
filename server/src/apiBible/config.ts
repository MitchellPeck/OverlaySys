import fs from "node:fs/promises";
import path from "node:path";
import {
  ApiBibleProvider,
  findNivBible,
  NIV_TRANSLATION,
  ScriptureProviderError,
  type FetchLike,
} from "@overlaysys/scripture";
import { dataRoot } from "../storage";
import { getScriptureRegistry } from "../scripture";

// The church's API.Bible key: env OVERLAYSYS_API_BIBLE_KEY, else a 0600 file
// in the data dir. Resolving the key finds the NIV and registers it next to
// the bundled translations. The key itself never leaves this module.

export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";

export interface ApiBibleStatus {
  configured: boolean;
  source: "env" | "file" | null;
  state: ApiBibleState;
  bibleId?: string;
}

const RETRY_MS = 60_000;
const settingsFile = () => path.join(dataRoot(), "settings", "api-bible.json");
const envKey = () => process.env["OVERLAYSYS_API_BIBLE_KEY"]?.trim() || null;

let provider: ApiBibleProvider | null = null;
let status: ApiBibleStatus = { configured: false, source: null, state: "no_key" };
let lastInitAt = 0;
let fetchImpl: FetchLike | undefined;

async function fileKey(): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as { apiKey?: unknown };
    return typeof j.apiKey === "string" && j.apiKey.trim() ? j.apiKey.trim() : null;
  } catch {
    return null;
  }
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

function install(key: string, bibleId: string): void {
  uninstall();
  provider = new ApiBibleProvider({ apiKey: key, bibleId, translation: NIV_TRANSLATION, fetch: fetchImpl });
  getScriptureRegistry().register(provider);
}

async function apply(key: string, source: "env" | "file"): Promise<ApiBibleStatus> {
  const p = await probe(key);
  if (p.state === "ok") install(key, p.bibleId!);
  else uninstall();
  status = { configured: true, source, state: p.state, ...(p.bibleId ? { bibleId: p.bibleId } : {}) };
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

/** Validate and save a key. Only an "ok" key is written. */
export async function setApiBibleKey(key: string): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  const p = await probe(key);
  if (p.state !== "ok") {
    return { configured: status.configured, source: status.source, state: p.state };
  }
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify({ apiKey: key }), { mode: 0o600 });
  await fs.chmod(settingsFile(), 0o600);
  install(key, p.bibleId!);
  status = { configured: true, source: "file", state: "ok", bibleId: p.bibleId! };
  return status;
}

export async function clearApiBibleKey(): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  await fs.rm(settingsFile(), { force: true });
  uninstall();
  status = { configured: false, source: null, state: "no_key" };
  return status;
}

/** @internal */
export function _setApiBibleFetchForTest(f: FetchLike | undefined): void {
  fetchImpl = f;
}
