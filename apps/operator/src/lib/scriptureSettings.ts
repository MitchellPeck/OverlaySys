"use client";

import { useSyncExternalStore } from "react";
import type { ScriptureSettings } from "@overlaysys/core";
import { getScriptureSettings } from "./scriptureClient";

// Install-wide scripture defaults, fetched once and shared by every take strip.
let cache: ScriptureSettings | null = null;
let loading = false;
const listeners = new Set<() => void>();

export function setScriptureSettingsCache(s: ScriptureSettings): void {
  cache = s;
  for (const l of listeners) l();
}

function load(): void {
  if (cache || loading) return;
  loading = true;
  getScriptureSettings()
    .then(setScriptureSettingsCache)
    .catch(() => setScriptureSettingsCache({}))
    .finally(() => {
      loading = false;
    });
}

export function useScriptureSettings(): ScriptureSettings | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      load();
      return () => listeners.delete(l);
    },
    () => cache,
    () => null,
  );
}
