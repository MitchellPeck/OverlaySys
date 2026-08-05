"use client";

import { defaultServerUrl } from "./wsClient";

/**
 * Operator-side client for the embedded server's Ovation bridge routes.
 *
 * Derives the HTTP base from the WS URL (like pcoClient), so it talks to the
 * same local server that holds the operator key and runs the sync loop. The key
 * itself is only ever sent *to* that server — it is never echoed back.
 */
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

export interface OvationConnectionStatus {
  connected: boolean;
  baseUrl: string | null;
  workspaceId: string | null;
}

export interface OvationSyncStatus {
  paired: boolean;
  workspaceId: string | null;
  running: boolean;
  lastRanAt: string | null;
  lastError: string | null;
  lastResult: {
    pulled: number;
    pushed: number;
    errors: { kind: string; id: string; message: string }[];
  } | null;
}

/** The stored connection, minus the key. */
export async function getOvationConnection(): Promise<OvationConnectionStatus> {
  const res = await fetch(`${httpBase()}/api/ovation/connect`);
  if (!res.ok) throw new Error("Couldn't read the Ovation connection");
  return (await res.json()) as OvationConnectionStatus;
}

/**
 * Connect to an Ovation workspace. The server verifies the key against
 * Ovation's handshake before storing it, so a rejected key surfaces here.
 */
export async function connectOvation(input: {
  baseUrl: string;
  operatorKey: string;
  workspaceId: string;
}): Promise<{ ok: boolean; workspaceName?: string; error?: string }> {
  const res = await fetch(`${httpBase()}/api/ovation/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    workspaceName?: string;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: body.error ?? `Connection failed (${res.status})` };
  }
  return { ok: true, ...(body.workspaceName ? { workspaceName: body.workspaceName } : {}) };
}

export async function disconnectOvation(): Promise<void> {
  const res = await fetch(`${httpBase()}/api/ovation/connect`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't disconnect");
}

export async function getSyncStatus(): Promise<OvationSyncStatus> {
  const res = await fetch(`${httpBase()}/api/cloud/sync`);
  if (!res.ok) throw new Error("Couldn't read sync status");
  return (await res.json()) as OvationSyncStatus;
}

/** Force a sync pass rather than waiting for the 5-minute loop. */
export async function runSyncNow(): Promise<OvationSyncStatus["lastResult"]> {
  const res = await fetch(`${httpBase()}/api/cloud/sync`, { method: "POST" });
  if (!res.ok) throw new Error("Sync failed");
  const body = (await res.json()) as
    | OvationSyncStatus["lastResult"]
    | { skipped: true };
  return body && "skipped" in body ? null : body;
}
