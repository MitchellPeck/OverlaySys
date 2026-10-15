"use client";

import { useEffect } from "react";
import { useAuthStore } from "./useAuth";
import {
  listProjectChannelOverridesCloud,
  refreshChannelConfigsCloud,
  refreshHotcardMetasCloud,
  refreshProjectsCloud,
  refreshShowMetasCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
} from "./cloudData";
import { useStore } from "./store";
import { isElectron } from "./desktop";
import { defaultServerUrl } from "./wsClient";

/**
 * Global on-signed-in bootstrap. Whenever the operator gains a cloud
 * session — whether cloud-build mode or Electron paired to apps-portal
 * — pull every entity type's metadata from Supabase into the Zustand
 * store so every page sees cloud data immediately, not just whichever
 * `/templates`, `/shows`, `/songs`, etc. index page the user happens to
 * be on. Also pulls the current project's channel overrides, which are
 * project-scoped so the hook re-runs when the project switches.
 *
 * Two parallel paths for each entity type:
 *
 *   1. (Cloud build only) Refresh the Zustand store directly via the
 *      loose `refreshX` helpers in cloudData.ts so the current React
 *      render has cloud data immediately — there is no local server to
 *      wait on.
 *   2. (Desktop) Kick the embedded server's sync engine (POST
 *      /api/cloud/sync) so its local fs replica is written through with
 *      cloud data for every entity type at once; the server then
 *      broadcasts the synced `*_list`s over WS. The server is the single
 *      source for the store on desktop — see the note inside the effect.
 *
 * All paths are best-effort; transient errors just log. The hook
 * re-runs when auth flips to `signed_in` or when the current project
 * changes (overrides are the only project-scoped entity).
 *
 * Renamed from `useCloudChannels` — the previous name implied
 * channels-only coverage, but the hook's value extends to every list
 * page in the operator.
 */
export function useCloudBootstrap(): void {
  const status = useAuthStore((s) => s.status);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setProjectOverrides = useStore((s) => s.setProjectChannelOverrides);

  useEffect(() => {
    if (status !== "signed_in") return;
    let cancelled = false;
    // Fan out the metadata refreshes in parallel — they all populate
    // independent store slices, so there's no ordering constraint.
    //
    // Desktop is the exception: there the same slices are owned by the
    // local server's WS `*_list` broadcasts, and the server is what takes,
    // renderer windows and `get_template`/`get_channel` actually read
    // from. Writing the cloud's lists over them here meant the UI could
    // offer a template or channel the local server didn't hold yet (the
    // cloud fetch lands after the WS list and wins). So on desktop we only
    // kick the server's sync pass below; its fan-out broadcasts the
    // synced lists within seconds and every reader agrees.
    if (!isElectron()) {
      void Promise.allSettled([
        refreshProjectsCloud(),
        refreshShowMetasCloud(),
        refreshHotcardMetasCloud(),
        refreshTemplateMetasCloud(),
        refreshSongMetasCloud(),
        refreshChannelConfigsCloud(),
      ]).then((results) => {
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          for (const r of failed) {
            if (r.status === "rejected") {
              console.warn("[useCloudBootstrap] entity refresh failed", r.reason);
            }
          }
        }
      });
    }
    listProjectChannelOverridesCloud(currentProjectId)
      .then((overrides) => {
        if (!cancelled) setProjectOverrides(overrides);
      })
      .catch((err) =>
        console.warn("[useCloudBootstrap] project overrides refresh failed", err),
      );
    // Kick the desktop server's sync engine so the local fs replica is
    // written through with cloud data for every entity. This eliminates
    // the stale flash on subsequent page refreshes — WS list_* then
    // returns already-synced fs instead of returning fixture defaults
    // while the renderer's cloud fetch races to update the store.
    if (isElectron()) {
      void triggerServerSync().catch((err) =>
        console.warn("[useCloudBootstrap] server sync kick failed", err),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [status, currentProjectId, setProjectOverrides]);
}

/**
 * Best-effort POST to the embedded server's sync trigger. The server's
 * runSyncNow is serialized via an in-flight flag, so a flood of triggers
 * (from rapid navigation or multiple renderer windows) collapses into
 * one pass. Returns when the server confirms it received the request —
 * we intentionally don't wait for the full sync to complete, since the
 * renderer has already populated the store from its own cloud fetch
 * and doesn't need to block on fs being up-to-date.
 */
async function triggerServerSync(): Promise<void> {
  const base = httpBase();
  if (!base) return;
  await fetch(`${base}/api/cloud/sync`, { method: "POST" });
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
