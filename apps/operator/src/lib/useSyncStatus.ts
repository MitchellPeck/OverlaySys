"use client";

import { useEffect, useState } from "react";
import { defaultServerUrl } from "./wsClient";
import { isElectron } from "./desktop";
import { useAuthStore } from "./useAuth";

/**
 * Snapshot returned by the server's `GET /api/cloud/sync` endpoint. Wider
 * than the renderer needs — the pill only reads `lastRanAt`, `lastError`,
 * `paired`, and `running`. Full result is preserved so a future
 * detail-popover can render the per-table counters.
 */
export interface SyncStatusSnapshot {
  paired: boolean;
  running: boolean;
  lastRanAt: string | null;
  lastError: string | null;
  lastResult: {
    pulled: number;
    pushed: number;
    errors: { kind: string; id: string; message: string }[];
    /**
     * Records on the local replica that had a non-empty `updatedAt` and
     * were overwritten by a newer remote version on the last pass. Empty
     * for net-new pulls (records that didn't exist locally).
     */
    overwrites: {
      kind: string;
      id: string;
      localUpdatedAt: string;
      remoteUpdatedAt: string;
    }[];
  } | null;
}

const STATUS_POLL_MS = 10_000;

/**
 * Poll the embedded server's sync status. Only runs when the operator is
 * inside Electron (the cloud build has no local server to ask) and the
 * user is signed in (an unauthenticated user has no sync loop to
 * monitor). Returns null until the first response lands.
 *
 * Intentionally light — no retry/backoff, no abort propagation. A
 * fetch error just leaves the previous snapshot in place; the next tick
 * will retry. The pill renders muted when the snapshot is null or
 * `paired: false`.
 */
export function useSyncStatus(): SyncStatusSnapshot | null {
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const authStatus = useAuthStore((s) => s.status);
  const enabled = isElectron() && authStatus === "signed_in";

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const url = `${httpBase()}/api/cloud/sync`;
    async function tick(): Promise<void> {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const next = (await res.json()) as SyncStatusSnapshot;
        if (!cancelled) setStatus(next);
      } catch {
        // ignore transient fetch errors
      }
    }
    void tick();
    const id = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return status;
}

function httpBase(): string {
  try {
    const u = new URL(defaultServerUrl());
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}
