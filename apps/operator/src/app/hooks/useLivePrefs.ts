"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DOUBLE_CLICK_TAKES_KEY, DRAWER_OPEN_KEY, readBool } from "@/lib/liveDrawerModel";

/**
 * Live-page preferences, persisted to localStorage. A tiny module-level store
 * so the page (column width) and the drawer (toggle) see the same value.
 */
type Snapshot = { drawerOpen: boolean; doubleClickTakes: boolean };

const DEFAULTS: Snapshot = { drawerOpen: true, doubleClickTakes: false };
let snapshot: Snapshot = DEFAULTS;
let hydrated = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const s = storage();
  snapshot = {
    drawerOpen: readBool(s, DRAWER_OPEN_KEY, DEFAULTS.drawerOpen),
    doubleClickTakes: readBool(s, DOUBLE_CLICK_TAKES_KEY, DEFAULTS.doubleClickTakes),
  };
}

function update(patch: Partial<Snapshot>, key: string, value: boolean): void {
  snapshot = { ...snapshot, ...patch };
  try {
    storage()?.setItem(key, String(value));
  } catch {
    // Private mode / quota: the in-memory value still applies this session.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): Snapshot {
  hydrate();
  return snapshot;
}

export function useLivePrefs(): {
  drawerOpen: boolean;
  setDrawerOpen(b: boolean): void;
  doubleClickTakes: boolean;
  setDoubleClickTakes(b: boolean): void;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
  const setDrawerOpen = useCallback((b: boolean) => update({ drawerOpen: b }, DRAWER_OPEN_KEY, b), []);
  const setDoubleClickTakes = useCallback(
    (b: boolean) => update({ doubleClickTakes: b }, DOUBLE_CLICK_TAKES_KEY, b),
    [],
  );
  return { ...snap, setDrawerOpen, setDoubleClickTakes };
}
