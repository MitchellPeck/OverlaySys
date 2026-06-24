// Server-side sync orchestration. The Electron host pushes cloud tokens
// down to the server on startup + on refresh; this module holds them in
// memory, materializes a Supabase client + CloudStorageAdapter, and runs
// the engine against the local FsStorageAdapter on a periodic cadence.
//
// Idempotent — multiple setTokens calls just update the in-memory copy.
// Sync passes are debounced: a pass in flight serializes with the next,
// so an aggressive caller can't pile up concurrent reconciles.

import { sync, type SyncResult } from "@overlaysys/core";
import {
  CloudStorageAdapter,
  createNodeAnonClient,
  type OverlaySysSupabaseClient,
} from "@overlaysys/supabase";
import { FsStorageAdapter } from "./fsStorageAdapter";
import { broadcast } from "./broadcast";
import {
  listTemplateMetas,
  reloadTemplates,
} from "./templates";
import { listShowMetas, reloadShows } from "./shows";
import { listChannelConfigs, reloadChannelConfigs } from "./channelConfigs";
import { listSongMetas, reloadSongs } from "./songs";
import { listProjects, reloadProjects } from "./projects";
import { listHotcardMetas, reloadHotcards } from "./hotcards";

export interface CloudTokens {
  accessToken: string;
  refreshToken: string;
  orgId: string;
}

interface State {
  tokens: CloudTokens | null;
  client: OverlaySysSupabaseClient | null;
  cloud: CloudStorageAdapter | null;
  local: FsStorageAdapter;
  // Last pass result for /health-style introspection.
  lastResult: SyncResult | null;
  lastRanAt: string | null;
  lastError: string | null;
  // Running flag — serializes overlapping triggers.
  running: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
}

const state: State = {
  tokens: null,
  client: null,
  cloud: null,
  local: new FsStorageAdapter(),
  lastResult: null,
  lastRanAt: null,
  lastError: null,
  running: false,
  intervalId: null,
};

/** Cadence at which the server retries sync once tokens are present. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Apply tokens pushed from the Electron host. Spins up a Supabase client
 * the first time, then forwards subsequent token pairs into its session
 * (Supabase JS handles the swap in-place). Returns true when the new
 * tokens were successfully applied to the client.
 */
export async function setCloudTokens(tokens: CloudTokens): Promise<boolean> {
  const url = process.env["OVERLAYSYS_SUPABASE_URL"];
  const anonKey = process.env["OVERLAYSYS_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    state.lastError =
      "OVERLAYSYS_SUPABASE_URL / OVERLAYSYS_SUPABASE_ANON_KEY not set on the server";
    console.warn(`[cloudSync] ${state.lastError}`);
    return false;
  }

  state.tokens = tokens;
  if (!state.client) {
    state.client = createNodeAnonClient({ url, anonKey });
    state.cloud = new CloudStorageAdapter(state.client);
  }
  const { error } = await state.client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) {
    state.lastError = `setSession failed: ${error.message}`;
    console.warn(`[cloudSync] ${state.lastError}`);
    return false;
  }

  // Schedule the periodic loop on first successful set; subsequent
  // refreshes just update the session in place.
  if (!state.intervalId) {
    state.intervalId = setInterval(() => {
      void runSyncNow().catch((err) => {
        console.warn("[cloudSync] periodic sync failed", err);
      });
    }, SYNC_INTERVAL_MS);
  }

  // Kick a sync immediately so the user sees changes propagate without
  // waiting up to SYNC_INTERVAL_MS for the first scheduled pass.
  void runSyncNow().catch((err) => {
    console.warn("[cloudSync] initial sync failed", err);
  });

  return true;
}

/**
 * Clear cached tokens + cancel the periodic loop. Called when the user
 * signs out so a fresh sign-in starts from a clean slate.
 */
export async function clearCloudTokens(): Promise<void> {
  state.tokens = null;
  if (state.client) {
    await state.client.auth.signOut().catch(() => undefined);
  }
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

/**
 * Run one sync pass. Caller-driven entry point — invoked by the periodic
 * timer above and by an explicit endpoint if the host wants to force a
 * pass (e.g., after a known cloud-side mutation).
 *
 * Serializes via the `running` flag so a slow sync can't be interleaved
 * with a triggered re-run. The flag is the cheapest mutex available in
 * the server's single-event-loop model.
 */
export async function runSyncNow(): Promise<SyncResult | null> {
  if (!state.tokens || !state.cloud) return null;
  if (state.running) return state.lastResult;
  state.running = true;
  try {
    const result = await sync(state.local, state.cloud, state.tokens.orgId);
    state.lastResult = result;
    state.lastRanAt = new Date().toISOString();
    state.lastError = null;
    if (result.errors.length > 0) {
      console.warn(
        `[cloudSync] completed with ${result.errors.length} errors`,
        result.errors,
      );
    } else {
      console.log(
        `[cloudSync] ok — pulled=${result.pulled} pushed=${result.pushed}`,
      );
    }
    // Refresh in-memory registries + broadcast updated lists so connected
    // operator UIs reflect pulled changes without a manual reload. Each
    // table is invalidated only when the sync pass actually moved
    // records for it — saves a flurry of no-op broadcasts when sync is
    // idle.
    await fanOutSyncWrites(result);
    return result;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[cloudSync] sync threw — ${state.lastError}`);
    return null;
  } finally {
    state.running = false;
  }
}

/**
 * Refresh in-memory registries + broadcast their lists for every table
 * that the sync pass touched. Mirrors the broadcast pattern in
 * server/src/ws.ts (`broadcast({ type: "show_list", ... })` etc.) so
 * cached operator clients pick up pulled rows without a reload.
 *
 * Each entity is reloaded only when its per-table counter is non-zero —
 * keeps idle ticks cheap.
 */
async function fanOutSyncWrites(result: SyncResult): Promise<void> {
  const touched = (kind: keyof SyncResult["perTable"]): boolean => {
    const t = result.perTable[kind];
    return t.pulled > 0 || t.pushed > 0;
  };
  try {
    if (touched("templates")) {
      await reloadTemplates();
      broadcast({ type: "template_list", templates: await listTemplateMetas() });
    }
    if (touched("shows")) {
      await reloadShows();
      broadcast({ type: "show_list", shows: await listShowMetas() });
    }
    if (touched("hotcards")) {
      await reloadHotcards();
      broadcast({ type: "hotcard_list", hotcards: await listHotcardMetas() });
    }
    if (touched("songs")) {
      await reloadSongs();
      broadcast({ type: "song_list", songs: await listSongMetas() });
    }
    if (touched("projects")) {
      await reloadProjects();
      broadcast({ type: "project_list", projects: await listProjects() });
    }
    if (touched("channelConfigs")) {
      await reloadChannelConfigs();
      broadcast({
        type: "channel_list",
        configs: await listChannelConfigs(),
      });
    }
    // Project channel overrides aren't yet in the WS protocol's broadcast
    // surface — the operator fetches them on demand via cloudData. When
    // we wire the renderer-side override editor to receive live pushes,
    // add the broadcast here too.
  } catch (err) {
    console.warn("[cloudSync] fan-out broadcast failed", err);
  }
}

/**
 * Snapshot of the current sync state — used by the /api/cloud/sync GET
 * endpoint so the operator UI can surface "last synced at" + error info.
 */
export function getCloudSyncStatus(): {
  paired: boolean;
  running: boolean;
  lastRanAt: string | null;
  lastError: string | null;
  lastResult: SyncResult | null;
} {
  return {
    paired: state.tokens !== null,
    running: state.running,
    lastRanAt: state.lastRanAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
  };
}
