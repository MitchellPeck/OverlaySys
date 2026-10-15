// Record lifecycle helpers shared by the WS-facing registries.
//
// The on-disk `data/` tree is one replica in a two-replica sync
// (packages/core/src/syncEngine.ts reconciles it against the cloud by
// last-writer-wins on `updatedAt`, propagating deletes as `deletedAt`
// tombstones). The sync engine writes through FsStorageAdapter; operator
// edits arrive over the WS and write through the registries. Both paths
// land in the same files, so the registries must keep the same contract:
//
//   - every local write stamps `updatedAt` (a missing/stale stamp makes
//     LWW treat the edit as ancient — it never pushes, and the cloud copy
//     overwrites it on the next pass);
//   - a local delete writes a tombstone rather than unlinking (an unlinked
//     file just looks like "remote-only" to the engine and resurrects);
//   - readers hide tombstones (a tombstone pulled from the cloud must not
//     show up as a live record in the operator).

export interface Lifecycle {
  updatedAt?: string;
  deletedAt?: string;
}

/** True unless the record carries a tombstone. */
export function isLive<T extends Lifecycle>(record: T): boolean {
  return !record.deletedAt;
}

/** Filter a registry snapshot down to live records. */
export function liveOnly<T extends Lifecycle>(records: Iterable<T>): T[] {
  return Array.from(records).filter(isLive);
}

/**
 * Stamp a fresh `updatedAt` and clear any tombstone. Used for every
 * local write: the operator just produced a new version, so it must
 * beat whatever the cloud holds, and re-saving a deleted id is how a
 * record comes back.
 */
export function stampWrite<T extends Lifecycle>(record: T): T {
  const { deletedAt: _dropped, ...rest } = record;
  void _dropped;
  return { ...rest, updatedAt: new Date().toISOString() } as T;
}

/** Turn a record into its tombstone. `updatedAt` moves with `deletedAt`. */
export function tombstone<T extends Lifecycle>(record: T): T {
  const now = new Date().toISOString();
  return { ...record, updatedAt: now, deletedAt: now };
}
