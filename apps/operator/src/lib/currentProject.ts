"use client";

import { DEFAULT_PROJECT_ID } from "@overlaysys/core";

const STORAGE_KEY = "overlaysys:current-project";

/**
 * Returns the operator's current Project ID. Reads from sessionStorage so
 * each browser tab can scope independently; falls back to the default
 * project when nothing has been selected yet (fresh tab, or running on the
 * server during Next.js prerender).
 */
export function getCurrentProjectId(): string {
  if (typeof window === "undefined") return DEFAULT_PROJECT_ID;
  return window.sessionStorage.getItem(STORAGE_KEY) ?? DEFAULT_PROJECT_ID;
}

export function setCurrentProjectId(id: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, id);
}
