import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import type { Show } from "@overlaysys/core";
import { dataRoot } from "../storage";
import { applyHeaderMigration, getShow, listShowMetas } from "../shows";
import { PcoAuthError, createPcoClient, type PcoClient } from "./pcoClient";
import { getPcoAuthorization, isPcoConnected } from "./pcoTokens";

export type PlanHeaderEntry =
  | { fetchedAt: string; headers: Record<string, string> }
  | { fetchedAt: string; unavailable: true };
export interface PlanHeaderCache {
  version: 1;
  plans: Record<string, PlanHeaderEntry>;
}

const FILE = (): string => path.join(dataRoot(), "pco", "plan-headers.json");

export async function readHeaderCache(): Promise<PlanHeaderCache> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE(), "utf8")) as Partial<PlanHeaderCache> | null;
    if (raw && raw.version === 1 && raw.plans && typeof raw.plans === "object") {
      return { version: 1, plans: raw.plans };
    }
  } catch {
    // missing or corrupt: start empty
  }
  return { version: 1, plans: {} };
}

async function writeHeaderCache(cache: PlanHeaderCache): Promise<void> {
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  await writeAtomic(FILE(), JSON.stringify(cache, null, 2));
}

/** Plans referenced by PCO-sourced graphic rows that the cache doesn't know yet. */
export function pendingPlanKeys(shows: Show[], cache: PlanHeaderCache): string[] {
  const out = new Set<string>();
  for (const show of shows) {
    for (const row of show.rows) {
      if (row.kind !== "graphic" || row.sourceRef?.provider !== "pco") continue;
      const key = `${row.sourceRef.serviceTypeId}/${row.sourceRef.planId}`;
      if (!(key in cache.plans)) out.add(key);
    }
  }
  return [...out];
}

function cachedHeaders(cache: PlanHeaderCache): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of Object.values(cache.plans)) {
    if ("headers" in entry) for (const [id, title] of Object.entries(entry.headers)) map.set(id, title);
  }
  return map;
}

async function liveShows(): Promise<Show[]> {
  const out: Show[] = [];
  for (const meta of await listShowMetas()) {
    const s = await getShow(meta.id);
    if (s) out.push(s);
  }
  return out;
}

export interface HeaderMigrationDeps {
  getClient?: () => PcoClient | null;
  now?: () => string;
  pollMs?: number;
}

const defaultClient = (): PcoClient | null => {
  const authorization = getPcoAuthorization();
  return isPcoConnected() && authorization ? createPcoClient(authorization) : null;
};

let timer: NodeJS.Timeout | undefined;

export function stopHeaderMigration(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

/**
 * Migrate PCO header rows into sections. Applies cached headers first, then
 * fetches each uncached plan's items once when a PCO client is available.
 * Plans that stay pending are retried on an unref()ed timer.
 */
export async function startHeaderMigration(deps: HeaderMigrationDeps = {}): Promise<void> {
  const getClient = deps.getClient ?? defaultClient;
  const now = deps.now ?? (() => new Date().toISOString());
  const pollMs = deps.pollMs ?? 60000;
  stopHeaderMigration();

  const cache = await readHeaderCache();
  await applyHeaderMigration(cachedHeaders(cache));

  let pending = pendingPlanKeys(await liveShows(), cache);
  if (pending.length > 0) {
    const client = getClient();
    if (client) {
      let fetched = false;
      for (const key of pending) {
        const [serviceTypeId, planId] = key.split("/") as [string, string];
        try {
          const items = await client.getPlanItems(serviceTypeId, planId);
          const headers: Record<string, string> = {};
          for (const it of items) if (it.itemType === "header") headers[it.id] = it.title;
          cache.plans[key] = { fetchedAt: now(), headers };
          fetched = true;
        } catch (err) {
          if (err instanceof PcoAuthError) break;
          cache.plans[key] = { fetchedAt: now(), unavailable: true };
          fetched = true;
        }
      }
      if (fetched) {
        await writeHeaderCache(cache);
        await applyHeaderMigration(cachedHeaders(cache));
      }
      pending = pendingPlanKeys(await liveShows(), cache);
    }
  }

  if (pending.length > 0) {
    timer = setTimeout(() => {
      timer = undefined;
      void startHeaderMigration(deps).catch(() => undefined);
    }, pollMs);
    timer.unref();
  }
}
