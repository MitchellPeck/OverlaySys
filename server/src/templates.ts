import { randomUUID } from "node:crypto";
import type { Template, TemplateMeta } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInTemplate } from "./bundleApply";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

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
  return liveOnly(REGISTRY.values()).map((t) => ({
    id: t.id,
    name: t.name,
    size: t.size,
    // Surface defaultChannel on the meta so callers (operator's rundown
    // editor, take panel) can prefill channelHint without needing the
    // template body in cache.
    ...(t.defaultChannel ? { defaultChannel: t.defaultChannel } : {}),
  }));
}

/** Full template objects — used by the publish bundler's dependency walk. */
export async function listTemplates(): Promise<Template[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values());
}

export async function getTemplate(id: string): Promise<Template | null> {
  await ensureLoaded();
  const t = REGISTRY.get(id);
  return t && isLive(t) ? t : null;
}

export async function saveTemplate(template: Template): Promise<Template> {
  await ensureLoaded();
  // Local write: stamp updatedAt so the sync engine sees a new version
  // (and clear any tombstone — re-saving a deleted id resurrects it).
  const normalized = stampWrite(normalizeAssetUrlsInTemplate(template));
  await storage.saveTemplate(normalized);
  REGISTRY.set(normalized.id, normalized);
  return normalized;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  // Soft delete: the file stays as a tombstone so the deletion propagates
  // through sync instead of the cloud copy resurrecting it next pass.
  const dead = tombstone(current);
  await storage.saveTemplate(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function duplicateTemplate(
  sourceId: string,
): Promise<Template | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src || !isLive(src)) return null;
  const copy: Template = stampWrite({
    ...src,
    id: `template-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
  });
  await storage.saveTemplate(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
