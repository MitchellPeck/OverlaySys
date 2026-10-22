"use client";

import type { StageSettings } from "@overlaysys/core";
import { defaultServerUrl } from "./wsClient";

/** Derive the HTTP base from the WS URL the operator is already using. */
function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export async function getStageSettings(): Promise<StageSettings> {
  const r = await fetch(`${httpBase()}/api/stage/settings`);
  if (!r.ok) throw new Error(`stage settings: ${r.status}`);
  return (await r.json()) as StageSettings;
}

export async function putStageSettings(s: StageSettings): Promise<StageSettings> {
  const r = await fetch(`${httpBase()}/api/stage/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!r.ok) throw new Error(`stage settings: ${r.status}`);
  return (await r.json()) as StageSettings;
}
