import { randomUUID } from "node:crypto";
import type { Hotcard, HotcardMeta } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInHotcard } from "./bundleApply";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

const REGISTRY = new Map<string, Hotcard>();
let loaded = false;

export async function reloadHotcards(): Promise<void> {
  await storage.ensureSeeded();
  const hotcards = await storage.loadAllHotcards();
  REGISTRY.clear();
  for (const raw of hotcards) {
    // See templates.reloadTemplates for the rationale — strip stale
    // absolute hosts from on-disk asset URLs at boot.
    const normalized = normalizeAssetUrlsInHotcard(raw);
    REGISTRY.set(normalized.id, normalized);
    if (normalized !== raw) {
      await storage.saveHotcard(normalized);
    }
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadHotcards();
}

export async function listHotcardMetas(): Promise<HotcardMeta[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values()).map((h) => ({
    id: h.id,
    name: h.name,
    projectId: h.projectId,
    templateId: h.templateId,
  }));
}

export async function getHotcard(id: string): Promise<Hotcard | null> {
  await ensureLoaded();
  const h = REGISTRY.get(id);
  return h && isLive(h) ? h : null;
}

export async function saveHotcard(hotcard: Hotcard): Promise<Hotcard> {
  await ensureLoaded();
  // See templates.saveTemplate — local writes stamp updatedAt for sync.
  const normalized = stampWrite(normalizeAssetUrlsInHotcard(hotcard));
  await storage.saveHotcard(normalized);
  REGISTRY.set(normalized.id, normalized);
  return normalized;
}

export async function deleteHotcard(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveHotcard(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function duplicateHotcard(
  sourceId: string,
): Promise<Hotcard | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src || !isLive(src)) return null;
  const copy: Hotcard = stampWrite({
    ...src,
    id: `hotcard-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
  });
  await storage.saveHotcard(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
