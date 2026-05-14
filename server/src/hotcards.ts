import { randomUUID } from "node:crypto";
import type { Hotcard, HotcardMeta } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInHotcard } from "./bundleApply";

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
  return Array.from(REGISTRY.values()).map((h) => ({
    id: h.id,
    name: h.name,
    projectId: h.projectId,
    templateId: h.templateId,
  }));
}

export async function getHotcard(id: string): Promise<Hotcard | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveHotcard(hotcard: Hotcard): Promise<void> {
  const normalized = normalizeAssetUrlsInHotcard(hotcard);
  await storage.saveHotcard(normalized);
  REGISTRY.set(normalized.id, normalized);
}

export async function deleteHotcard(id: string): Promise<boolean> {
  const ok = await storage.deleteHotcard(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}

export async function duplicateHotcard(
  sourceId: string,
): Promise<Hotcard | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src) return null;
  const copy: Hotcard = {
    ...src,
    id: `hotcard-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
  };
  await storage.saveHotcard(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
