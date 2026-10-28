import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import { PcoItemMappingSchema, type PcoItemMapping } from "@overlaysys/core";
import { dataRoot } from "../storage";

const FILE = (): string => path.join(dataRoot(), "pco", "itemMappings.json");

let cache: PcoItemMapping[] = [];
let loaded = false;

export async function reloadItemMappings(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(FILE(), "utf8"));
    cache = Array.isArray(raw)
      ? raw.flatMap((r) => {
          const p = PcoItemMappingSchema.safeParse(r);
          return p.success ? [p.data] : [];
        })
      : [];
  } catch {
    cache = [];
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadItemMappings();
}

async function persist(): Promise<void> {
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  await writeAtomic(FILE(), JSON.stringify(cache, null, 2));
}

function replace(m: PcoItemMapping): void {
  const i = cache.findIndex((x) => x.id === m.id);
  if (i >= 0) cache[i] = m;
  else cache.push(m);
}

export async function listItemMappings(opts?: { includeDeleted?: boolean }): Promise<PcoItemMapping[]> {
  await ensureLoaded();
  return opts?.includeDeleted ? [...cache] : cache.filter((m) => !m.deletedAt);
}

export async function upsertItemMapping(
  m: Omit<PcoItemMapping, "id" | "updatedAt"> & { updatedAt?: string },
): Promise<PcoItemMapping> {
  await ensureLoaded();
  const { deletedAt: _d, ...rest } = m;
  void _d;
  const stored: PcoItemMapping = { ...rest, id: String(m.key), updatedAt: m.updatedAt ?? new Date().toISOString() } as PcoItemMapping;
  replace(stored);
  await persist();
  return stored;
}

/** Sync path: stores as-is (tombstones included). */
export async function putItemMapping(m: PcoItemMapping): Promise<void> {
  await ensureLoaded();
  replace(m);
  await persist();
}

export async function deleteItemMapping(id: string): Promise<boolean> {
  await ensureLoaded();
  const cur = cache.find((x) => x.id === id);
  if (!cur || cur.deletedAt) return false;
  const now = new Date().toISOString();
  replace({ ...cur, deletedAt: now, updatedAt: now });
  await persist();
  return true;
}
