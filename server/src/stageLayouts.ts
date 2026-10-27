import { randomUUID } from "node:crypto";
import {
  BUILT_IN_STAGE_LAYOUTS,
  SPEAKER_LAYOUT,
  isBuiltInStageLayoutId,
  stageLayoutMeta,
  type StageLayout,
  type StageLayoutMeta,
} from "@overlaysys/core";
import * as storage from "./storage";
import { omit } from "./omit";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

export class ReadOnlyLayoutError extends Error {
  readonly code = "read_only";
  constructor(id: string) {
    super(`Stage layout "${id}" is built in and read-only; duplicate it to edit`);
    this.name = "ReadOnlyLayoutError";
  }
}

/** `builtIn` is a code-only flag; a stored layout must never claim it. */
export function withoutBuiltIn(layout: StageLayout): Omit<StageLayout, "builtIn"> {
  return omit(layout, ["builtIn"]);
}

// Stored layouts only (tombstones included). Built-ins live in code.
const REGISTRY = new Map<string, StageLayout>();
let loaded = false;
let loading: Promise<void> | null = null;

export async function reloadStageLayouts(): Promise<void> {
  const all = await storage.loadAllStageLayouts();
  REGISTRY.clear();
  // A stored file must never shadow a built-in id.
  // Nor may it claim to be built in (a hand-edited file or a sync pull).
  for (const l of all) {
    if (isBuiltInStageLayoutId(l.id)) continue;
    REGISTRY.set(l.id, withoutBuiltIn(l));
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  // Concurrent first callers share one load.
  loading ??= reloadStageLayouts().finally(() => {
    loading = null;
  });
  await loading;
}

export async function listStageLayoutMetas(): Promise<StageLayoutMeta[]> {
  await ensureLoaded();
  const stored = liveOnly(REGISTRY.values()).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...BUILT_IN_STAGE_LAYOUTS.map((l) => stageLayoutMeta(l)),
    ...stored.map((l) => stageLayoutMeta(l)),
  ];
}

export async function getStageLayout(id: string): Promise<StageLayout | null> {
  await ensureLoaded();
  const builtIn = BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === id);
  if (builtIn) return builtIn;
  const stored = REGISTRY.get(id);
  return stored && isLive(stored) ? stored : null;
}

export async function saveStageLayout(layout: StageLayout): Promise<StageLayout> {
  await ensureLoaded();
  if (isBuiltInStageLayoutId(layout.id)) throw new ReadOnlyLayoutError(layout.id);
  const stamped = stampWrite(withoutBuiltIn(layout));
  await storage.saveStageLayout(stamped);
  REGISTRY.set(stamped.id, stamped);
  return stamped;
}

export async function deleteStageLayout(id: string): Promise<boolean> {
  await ensureLoaded();
  if (isBuiltInStageLayoutId(id)) return false;
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveStageLayout(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function duplicateStageLayout(id: string): Promise<StageLayout | null> {
  const src = await getStageLayout(id);
  if (!src) return null;
  const rest = omit(src, ["builtIn", "updatedAt", "deletedAt"]);
  return saveStageLayout({
    ...rest,
    id: `stage-layout-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
  });
}

/** Stored live layout, then built-in, then Speaker. Never throws on a bad id. */
export async function resolveStageLayout(id: string | undefined): Promise<StageLayout> {
  if (!id) return SPEAKER_LAYOUT;
  return (await getStageLayout(id)) ?? SPEAKER_LAYOUT;
}
