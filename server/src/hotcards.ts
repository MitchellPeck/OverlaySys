import { randomUUID } from "node:crypto";
import { initialHotkeyAssignments, type Hotcard, type HotcardMeta } from "@overlaysys/core";
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
  await migrateHotkeys();
  loaded = true;
}

/**
 * One-time move from position-based F-keys to explicit `hotkey`s (Default
 * D6a): projects whose cards all predate hotkeys get F1–F12 in the order
 * the hotcard list shows them (registry order), saved so every later boot
 * reads the same keys whatever order readdir returns.
 *
 * The write keeps `updatedAt` as it was: stamping it would make every
 * migrated (possibly stale) local copy beat newer cloud edits under
 * last-writer-wins. Projects with any decided card (a key or `null`) are
 * never touched again, see `initialHotkeyAssignments`.
 */
async function migrateHotkeys(): Promise<void> {
  const assignments = initialHotkeyAssignments(liveOnly(REGISTRY.values()));
  for (const [id, hotkey] of assignments) {
    const current = REGISTRY.get(id);
    if (!current) continue;
    const next: Hotcard = { ...current, hotkey };
    await storage.saveHotcard(next);
    REGISTRY.set(id, next);
  }
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
    hotkey: h.hotkey,
    ...(h.channelHint ? { channelHint: h.channelHint } : {}),
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
  // A card saved without a hotkey is "no key" (null), not "predates
  // hotkeys", so the boot migration never assigns it one later.
  const normalized = stampWrite(normalizeAssetUrlsInHotcard({ ...hotcard, hotkey: hotcard.hotkey ?? null }));
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
    // Two cards on one key would be a conflict; the copy starts unassigned.
    hotkey: null,
  });
  await storage.saveHotcard(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
