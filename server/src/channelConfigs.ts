import type { ChannelConfig } from "@overlaysys/core";
import * as storage from "./storage";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

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
  return liveOnly(REGISTRY.values());
}

export async function getChannelConfig(id: string): Promise<ChannelConfig | null> {
  await ensureLoaded();
  const c = REGISTRY.get(id);
  return c && isLive(c) ? c : null;
}

export async function saveChannelConfig(config: ChannelConfig): Promise<ChannelConfig> {
  await ensureLoaded();
  // See templates.saveTemplate — local writes stamp updatedAt for sync.
  const stamped = stampWrite(config);
  await storage.saveChannelConfig(stamped);
  REGISTRY.set(stamped.id, stamped);
  return stamped;
}

export async function deleteChannelConfig(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveChannelConfig(dead);
  REGISTRY.set(id, dead);
  return true;
}
