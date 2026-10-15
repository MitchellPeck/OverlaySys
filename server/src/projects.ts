import type { Project } from "@overlaysys/core";
import * as storage from "./storage";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

const REGISTRY = new Map<string, Project>();
let loaded = false;

export async function reloadProjects(): Promise<void> {
  await storage.ensureSeeded();
  const projects = await storage.loadAllProjects();
  REGISTRY.clear();
  for (const p of projects) {
    REGISTRY.set(p.id, p);
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadProjects();
}

export async function listProjects(): Promise<Project[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values());
}

export async function getProject(id: string): Promise<Project | null> {
  await ensureLoaded();
  const p = REGISTRY.get(id);
  return p && isLive(p) ? p : null;
}

export async function saveProject(project: Project): Promise<Project> {
  await ensureLoaded();
  // See templates.saveTemplate — local writes stamp updatedAt for sync.
  const stamped = stampWrite(project);
  await storage.saveProject(stamped);
  REGISTRY.set(stamped.id, stamped);
  return stamped;
}

export async function deleteProject(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveProject(dead);
  REGISTRY.set(id, dead);
  return true;
}
