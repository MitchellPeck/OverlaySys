// Server-side sync orchestration.
//
// The canonical store is the `overlay` database inside Ovation's Supabase
// project. PostgREST does not serve that database, so we reach it through
// Ovation's HTTP sync API rather than a Supabase client — which also means the
// overlay database credentials never reach an operator machine. This server
// holds only a workspace-scoped operator key, issued from the workspace's
// OverlaySys settings in Ovation.
//
// Idempotent — repeated connect calls just update the in-memory config. Sync
// passes are debounced: a pass in flight serializes with the next, so an
// aggressive caller can\'t pile up concurrent reconciles.

import {
  OvationCloudStorageAdapter,
  sync,
  type SyncResult,
} from "@overlaysys/core";
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

/**
 * What the operator needs to reach its workspace in Ovation. `workspaceId` is
 * the tenant key the sync engine passes through as its `orgId` argument.
 */
export interface OvationConnection {
  baseUrl: string;
  operatorKey: string;
  workspaceId: string;
}

interface State {
  connection: OvationConnection | null;
  cloud: OvationCloudStorageAdapter | null;
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
  connection: null,
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
 * Connect this server to an Ovation workspace.
 *
 * The key is verified against the sync API's handshake before it is stored, so
 * a bad key or a disabled integration fails here — at setup, with a message the
 * operator can act on — instead of silently at the next scheduled pass.
 */
export async function setOvationConnection(
  connection: OvationConnection,
): Promise<{ ok: boolean; error?: string; workspaceName?: string }> {
  const cloud = new OvationCloudStorageAdapter({
    baseUrl: connection.baseUrl,
    operatorKey: connection.operatorKey,
  });

  let workspaceName: string;
  try {
    const hello = await cloud.hello(connection.workspaceId);
    workspaceName = hello.workspace_name;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.lastError = `Ovation connection failed: ${message}`;
    console.warn(`[cloudSync] ${state.lastError}`);
    return { ok: false, error: message };
  }

  state.connection = connection;
  state.cloud = cloud;
  state.lastError = null;

  // Schedule the periodic loop on first successful connect; later reconnects
  // just swap the config in place.
  if (!state.intervalId) {
    state.intervalId = setInterval(() => {
      void runSyncNow().catch((err) => {
        console.warn("[cloudSync] periodic sync failed", err);
      });
    }, SYNC_INTERVAL_MS);
  }

  // Kick a pass immediately so the operator sees their shows without waiting
  // up to SYNC_INTERVAL_MS.
  void runSyncNow().catch((err) => {
    console.warn("[cloudSync] initial sync failed", err);
  });

  return { ok: true, workspaceName };
}

/**
 * Forget the connection + cancel the periodic loop. The local FS replica is
 * left intact so the operator keeps working offline with what already synced.
 */
export async function clearOvationConnection(): Promise<void> {
  state.connection = null;
  state.cloud = null;
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
  if (!state.connection || !state.cloud) return null;
  if (state.running) return state.lastResult;
  state.running = true;
  try {
    const result = await sync(state.local, state.cloud, state.connection.workspaceId);
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
  workspaceId: string | null;
  running: boolean;
  lastRanAt: string | null;
  lastError: string | null;
  lastResult: SyncResult | null;
} {
  return {
    paired: state.connection !== null,
    workspaceId: state.connection?.workspaceId ?? null,
    running: state.running,
    lastRanAt: state.lastRanAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
  };
}
