import type { Project } from "@overlaysys/core";
import * as storage from "./storage";

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
  return Array.from(REGISTRY.values());
}

export async function getProject(id: string): Promise<Project | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  await storage.saveProject(project);
  REGISTRY.set(project.id, project);
}

export async function deleteProject(id: string): Promise<boolean> {
  const ok = await storage.deleteProject(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
