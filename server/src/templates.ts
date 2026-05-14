import { randomUUID } from "node:crypto";
import type { Template, TemplateMeta } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInTemplate } from "./bundleApply";

// In-memory cache rebuilt on first load and on every save.
const REGISTRY = new Map<string, Template>();
let loaded = false;

export async function reloadTemplates(): Promise<void> {
  await storage.ensureSeeded();
  const templates = await storage.loadAllTemplates();
  REGISTRY.clear();
  for (const raw of templates) {
    // Migrate any absolute asset URLs left over from older uploads (when
    // the server returned absolute URLs derived from `Host:`, which baked
    // in whatever ephemeral port that boot happened to get). Rewrites are
    // idempotent — already-normalized templates are returned unchanged
    // and skip the disk write.
    const normalized = normalizeAssetUrlsInTemplate(raw);
    REGISTRY.set(normalized.id, normalized);
    if (normalized !== raw) {
      await storage.saveTemplate(normalized);
    }
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadTemplates();
}

export async function listTemplateMetas(): Promise<TemplateMeta[]> {
  await ensureLoaded();
  return Array.from(REGISTRY.values()).map((t) => ({
    id: t.id,
    name: t.name,
    size: t.size,
  }));
}

export async function getTemplate(id: string): Promise<Template | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveTemplate(template: Template): Promise<void> {
  const normalized = normalizeAssetUrlsInTemplate(template);
  await storage.saveTemplate(normalized);
  REGISTRY.set(normalized.id, normalized);
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const ok = await storage.deleteTemplate(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}

export async function duplicateTemplate(
  sourceId: string,
): Promise<Template | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src) return null;
  const copy: Template = {
    ...src,
    id: `template-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
  };
  await storage.saveTemplate(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
