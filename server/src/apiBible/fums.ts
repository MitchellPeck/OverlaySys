import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../storage";

// API.Bible Fair Use Management System. Every display of API.Bible text must
// be reported; the HTTP endpoint is their documented non-browser path.
// Device id is anonymous and persisted; session id is per server process.

const FUMS_URL = "https://fums.api.bible/f3";
const sessionId = randomUUID();
let deviceIdCache: string | null = null;
let fetchOverride: ((url: string) => Promise<unknown>) | null = null;

const inflight = new Set<Promise<void>>();

const deviceFile = () => path.join(dataRoot(), "settings", "api-bible-device.json");

async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  try {
    const saved = JSON.parse(await fs.readFile(deviceFile(), "utf8")) as { deviceId?: unknown };
    if (typeof saved.deviceId === "string" && saved.deviceId) return (deviceIdCache = saved.deviceId);
  } catch {
    // first run — create below
  }
  const id = randomUUID();
  await fs.mkdir(path.dirname(deviceFile()), { recursive: true });
  await fs.writeFile(deviceFile(), JSON.stringify({ deviceId: id }));
  return (deviceIdCache = id);
}

export function fumsUrl(tokens: string[], dId: string, sId: string): string {
  const q = new URLSearchParams();
  for (const t of tokens) q.append("t", t);
  q.set("dId", dId);
  q.set("sId", sId);
  return `${FUMS_URL}?${q.toString()}`;
}

/** Report one view per token. Never rejects — usage reporting must not break a take. */
export function reportViews(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return Promise.resolve();
  const p = doReport(tokens).finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}

async function doReport(tokens: string[]): Promise<void> {
  try {
    const url = fumsUrl(tokens, await deviceId(), sessionId);
    await (fetchOverride ?? ((u: string) => fetch(u)))(url);
  } catch (e) {
    console.debug("[api-bible] FUMS report failed", e instanceof Error ? e.message : e);
  }
}

/** @internal Resolves once every fire-and-forget report started so far has settled. */
export async function _flushFumsForTest(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight]);
}

/** @internal */
export function _setFumsFetchForTest(f: ((url: string) => Promise<unknown>) | null): void {
  fetchOverride = f;
}

/** @internal */
export function _resetFumsForTest(): void {
  deviceIdCache = null;
}
