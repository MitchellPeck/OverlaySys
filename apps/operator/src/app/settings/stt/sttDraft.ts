import type { SttPresence, SttSpawnerConfig } from "@overlaysys/core";
import { deepEqual } from "../../../lib/diffEntity";

/** Key-order-insensitive equality for the spawner config draft. */
export function sttConfigEqual(a: SttSpawnerConfig, b: SttSpawnerConfig): boolean {
  return deepEqual(a, b);
}

/** Undefined/null means presence has not arrived yet: never default to "missing". */
export function presenceView(p: SttPresence | null | undefined): "loading" | "present" | "missing" {
  if (!p) return "loading";
  return p.binary.path != null && p.selectedModel.present ? "present" : "missing";
}
