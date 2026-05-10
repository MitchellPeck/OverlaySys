import type { ChannelConfig } from "@overlaysys/core";
import * as storage from "./storage";

const REGISTRY = new Map<string, ChannelConfig>();
let loaded = false;

export async function reloadChannelConfigs(): Promise<void> {
  await storage.ensureSeeded();
  const configs = await storage.loadAllChannelConfigs();
  REGISTRY.clear();
  for (const c of configs) REGISTRY.set(c.id, c);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadChannelConfigs();
}

export async function listChannelConfigs(): Promise<ChannelConfig[]> {
  await ensureLoaded();
  return Array.from(REGISTRY.values());
}

export async function getChannelConfig(id: string): Promise<ChannelConfig | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveChannelConfig(config: ChannelConfig): Promise<void> {
  await storage.saveChannelConfig(config);
  REGISTRY.set(config.id, config);
}

export async function deleteChannelConfig(id: string): Promise<boolean> {
  const ok = await storage.deleteChannelConfig(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
