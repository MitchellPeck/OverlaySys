import type { Template, TemplateMeta } from "@overlaysys/core";
import * as storage from "./storage";

// In-memory cache rebuilt on first load and on every save.
const REGISTRY = new Map<string, Template>();
let loaded = false;

export async function reloadTemplates(): Promise<void> {
  await storage.ensureSeeded();
  const templates = await storage.loadAllTemplates();
  REGISTRY.clear();
  for (const t of templates) REGISTRY.set(t.id, t);
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
  await storage.saveTemplate(template);
  REGISTRY.set(template.id, template);
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const ok = await storage.deleteTemplate(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
