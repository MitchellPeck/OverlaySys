// Offline-first sync engine.
//
// Reconciles two StorageAdapter replicas — typically the desktop's local
// filesystem and the cloud's Supabase — by last-writer-wins per record,
// keyed on `updatedAt`. Soft-deleted records (those with `deletedAt`
// set) participate in the cascade: a tombstone on one side with a newer
// `updatedAt` than the other replica's live record propagates the
// deletion across.
//
// The engine is intentionally simple — no per-field merge, no real-time
// push. It pulls + pushes the full record set on each pass. For an
// operator app with hundreds of records, full-scan reconciliation is
// fast enough and avoids the watermark-cursor + journal complexity that
// would otherwise be required for incremental sync. The
// `listSince`/`SyncCursor` machinery on `StorageAdapter` is reserved for
// a future incremental upgrade once dataset sizes warrant it.

import type {
  ChannelConfig,
  Hotcard,
  Project,
  ProjectChannelOverride,
  Show,
  Song,
  StorageAdapter,
  Template,
} from "./index";

/**
 * Outcome of one `sync()` pass.
 */
export interface SyncResult {
  /** Records written to the local replica from remote. */
  pulled: number;
  /** Records written to the remote replica from local. */
  pushed: number;
  /**
   * Records on the local replica that had a non-empty `updatedAt` and
   * were overwritten by a newer remote version on this pass. Distinct
   * from `pulled` which also counts net-new records the local replica
   * had never seen. UIs surface this as the "your local copy was
   * replaced" signal — net-new pulls are not user-visible conflicts.
   */
  overwrites: SyncOverwrite[];
  /** Per-record failures; the rest of the pass still runs. */
  errors: SyncError[];
  /** Per-table count of records reconciled (skipped + applied). */
  perTable: Record<SyncEntityKind, { pulled: number; pushed: number }>;
}

/**
 * One local record that was replaced with a newer remote version. The
 * caller can match this against open editors and decide whether to
 * surface "your show was updated from cloud" notifications.
 */
export interface SyncOverwrite {
  kind: SyncEntityKind;
  id: string;
  /** Old local updatedAt (before the overwrite). */
  localUpdatedAt: string;
  /** New remote updatedAt (what just landed). */
  remoteUpdatedAt: string;
}

export interface SyncError {
  kind: SyncEntityKind;
  id: string;
  direction: "pull" | "push";
  message: string;
}

export type SyncEntityKind =
  | "projects"
  | "shows"
  | "hotcards"
  | "songs"
  | "templates"
  | "channelConfigs"
  | "projectChannelOverrides";

/** Stable identity for an override row — composed of (projectId, channelId). */
function overrideKey(o: { projectId: string; channelId: string }): string {
  return `${o.projectId}:${o.channelId}`;
}

/**
 * Reconcile two StorageAdapter replicas. Symmetric: callers are free to
 * pass cloud as `local` and disk as `remote` if that frames the flow
 * better; the engine has no opinion about which side is "primary."
 *
 * Caveats:
 *   - Records missing an `updatedAt` are treated as oldest possible
 *     (effectively the unix epoch). New writes always stamp it.
 *   - Show is a single document — an `updatedAt` bump covers every
 *     nested row + ShowSong override inside. Field-level merge is out of
 *     scope; logged when LWW overwrites a richer document.
 *   - Per-record errors don't abort the pass; the result aggregates them
 *     so callers can decide whether to retry, surface, or alert.
 */
export async function sync(
  local: StorageAdapter,
  remote: StorageAdapter,
  orgId: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    pulled: 0,
    pushed: 0,
    overwrites: [],
    errors: [],
    perTable: {
      projects: { pulled: 0, pushed: 0 },
      shows: { pulled: 0, pushed: 0 },
      hotcards: { pulled: 0, pushed: 0 },
      songs: { pulled: 0, pushed: 0 },
      templates: { pulled: 0, pushed: 0 },
      channelConfigs: { pulled: 0, pushed: 0 },
      projectChannelOverrides: { pulled: 0, pushed: 0 },
    },
  };

  // Each block is the same shape — listSince(""), index by id, merge by
  // LWW — but typed against a specific entity. Inlined per kind so type
  // inference stays sharp and the bodies stay readable.

  await reconcileTable<Project>({
    kind: "projects",
    listLocal: () => local.listProjectsSince(orgId, ""),
    listRemote: () => remote.listProjectsSince(orgId, ""),
    keyOf: (p) => p.id,
    pushToRemote: (p) => remote.saveProject(orgId, p),
    pushToLocal: (p) => local.saveProject(orgId, p),
    result,
  });

  await reconcileTable<Show>({
    kind: "shows",
    listLocal: () => local.listShowsSince(orgId, ""),
    listRemote: () => remote.listShowsSince(orgId, ""),
    keyOf: (s) => s.id,
    pushToRemote: (s) => remote.saveShow(orgId, s),
    pushToLocal: (s) => local.saveShow(orgId, s),
    result,
  });

  await reconcileTable<Hotcard>({
    kind: "hotcards",
    listLocal: () => local.listHotcardsSince(orgId, ""),
    listRemote: () => remote.listHotcardsSince(orgId, ""),
    keyOf: (h) => h.id,
    pushToRemote: (h) => remote.saveHotcard(orgId, h),
    pushToLocal: (h) => local.saveHotcard(orgId, h),
    result,
  });

  await reconcileTable<Song>({
    kind: "songs",
    listLocal: () => local.listSongsSince(orgId, ""),
    listRemote: () => remote.listSongsSince(orgId, ""),
    keyOf: (s) => s.id,
    pushToRemote: (s) => remote.saveSong(orgId, s),
    pushToLocal: (s) => local.saveSong(orgId, s),
    result,
  });

  await reconcileTable<Template>({
    kind: "templates",
    listLocal: () => local.listTemplatesSince(orgId, ""),
    listRemote: () => remote.listTemplatesSince(orgId, ""),
    keyOf: (t) => t.id,
    pushToRemote: (t) => remote.saveTemplate(orgId, t),
    pushToLocal: (t) => local.saveTemplate(orgId, t),
    result,
  });

  await reconcileTable<ChannelConfig>({
    kind: "channelConfigs",
    listLocal: () => local.listChannelConfigsSince(orgId, ""),
    listRemote: () => remote.listChannelConfigsSince(orgId, ""),
    keyOf: (c) => c.id,
    pushToRemote: (c) => remote.saveChannelConfig(orgId, c),
    pushToLocal: (c) => local.saveChannelConfig(orgId, c),
    result,
  });

  await reconcileTable<ProjectChannelOverride>({
    kind: "projectChannelOverrides",
    listLocal: () => local.listProjectChannelOverridesSince(orgId, ""),
    listRemote: () => remote.listProjectChannelOverridesSince(orgId, ""),
    keyOf: overrideKey,
    pushToRemote: (o) => remote.saveProjectChannelOverride(orgId, o),
    pushToLocal: (o) => local.saveProjectChannelOverride(orgId, o),
    result,
  });

  return result;
}

interface ReconcileArgs<T extends { updatedAt?: string; deletedAt?: string }> {
  kind: SyncEntityKind;
  listLocal: () => Promise<T[]>;
  listRemote: () => Promise<T[]>;
  keyOf: (item: T) => string;
  pushToRemote: (item: T) => Promise<void>;
  pushToLocal: (item: T) => Promise<void>;
  result: SyncResult;
}

async function reconcileTable<
  T extends { updatedAt?: string; deletedAt?: string },
>(args: ReconcileArgs<T>): Promise<void> {
  const {
    kind,
    listLocal,
    listRemote,
    keyOf,
    pushToRemote,
    pushToLocal,
    result,
  } = args;

  let localRows: T[];
  let remoteRows: T[];
  try {
    [localRows, remoteRows] = await Promise.all([listLocal(), listRemote()]);
  } catch (err) {
    // List failures abort this table only — the engine keeps reconciling
    // others so a single misconfigured backend doesn't sink the whole
    // pass.
    result.errors.push({
      kind,
      id: "(list)",
      direction: "pull",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const localById = new Map<string, T>(localRows.map((r) => [keyOf(r), r]));
  const remoteById = new Map<string, T>(remoteRows.map((r) => [keyOf(r), r]));
  const allIds = new Set<string>([...localById.keys(), ...remoteById.keys()]);

  for (const id of allIds) {
    const L = localById.get(id);
    const R = remoteById.get(id);
    try {
      if (!L && R) {
        // Remote-only — apply to local. Includes propagation of remote
        // tombstones: a record with deletedAt set is still written so
        // the local replica records the deletion.
        await pushToLocal(R);
        result.pulled += 1;
        result.perTable[kind].pulled += 1;
      } else if (L && !R) {
        // Local-only — push to remote. Same tombstone propagation in
        // the other direction.
        await pushToRemote(L);
        result.pushed += 1;
        result.perTable[kind].pushed += 1;
      } else if (L && R) {
        const lts = L.updatedAt ?? "";
        const rts = R.updatedAt ?? "";
        if (lts > rts) {
          await pushToRemote(L);
          result.pushed += 1;
          result.perTable[kind].pushed += 1;
        } else if (rts > lts) {
          await pushToLocal(R);
          result.pulled += 1;
          result.perTable[kind].pulled += 1;
          // Only count as an overwrite when the local replica had a
          // real timestamp — i.e. somebody had written to it before.
          // A pull onto an empty/legacy-no-updatedAt slot is a normal
          // first-time fetch, not a user-visible conflict.
          if (lts) {
            result.overwrites.push({
              kind,
              id,
              localUpdatedAt: lts,
              remoteUpdatedAt: rts,
            });
          }
        }
        // Equal — both sides agree, no-op. This also covers a record
        // legitimately not synced because neither side has touched it
        // since the last pass.
      }
    } catch (err) {
      result.errors.push({
        kind,
        id,
        direction: L && !R ? "push" : "pull",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
