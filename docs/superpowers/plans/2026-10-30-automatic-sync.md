# Automatic Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop ↔ cloud sync fully automatic and trustworthy: deletes stick, picture/video files travel both ways, cloud changes land in seconds, passes can't hang, and a status pill (plus a church-computer check-in) tells the owner the truth. Publish is removed.

**Architecture:** The existing last-writer-wins engine (`packages/core/src/syncEngine.ts`) stays. It gains per-record "last agreed" stamps for real conflict detection, plus timeouts. A new server-side asset sync step runs after each entity pass. The Electron main process becomes the only owner of the cloud session. The server subscribes to Supabase Realtime to trigger passes. Health is computed server-side (`/api/cloud/sync`) and published to a cloud heartbeat table that the laptop reads.

**Tech Stack:** TypeScript, Fastify server, Electron 33, Next.js operator, supabase-js v2 (Postgres, Storage, Realtime), Vitest 4, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-10-30-automatic-sync-design.md`

## Global Constraints

- Cloud is apps-portal's Supabase, schema `overlaysys`. Migrations are applied **by hand**. Every new table/column/publication change ships as a numbered file in `supabase/migrations/` **and** must be reported loudly in status when missing. Never skip silently.
- No push/pull/publish actions remain in the UI when the plan completes. Bundle export/import (files) stays.
- Local saves never wait on the cloud. Sync problems never pop a modal or block a live show.
- A false "Up to date" is worse than no pill. Green requires: last pass finished without errors, no pending pushes, no missing/failed files, no missing tables, a valid session.
- Assets are content-addressed `<sha256>.<ext>` in `data/assets/` and in bucket `overlaysys-assets` under `<orgId>/<filename>`. The bucket per-file limit is 1 GB.
- Pass ceiling: **120 s** for entity sync. Individual network calls: **30 s**. A file transfer gets `30 s + 1 s per MB`.
- Church-computer check-in turns amber after **15 min** with no check-in.
- Supabase rotates refresh tokens: exactly one process may refresh a given session.
- Test command: `pnpm vitest run <path>` from the repo root.

## Review Focus

1. **A record deleted on one side while edited on the other.** A newer edit beats an older tombstone and vice versa (pure LWW). The loser is kept as a conflict copy. Covered in Task 4.
2. **The cloud returns a record whose referenced file isn't in the bucket yet** (another machine is mid-upload). Download reports "waiting for file" and retries next pass. No crash, and it doesn't count as up to date. Covered in Task 7.
3. **A machine with a wrong-org or expired session.** Status says "Needs attention · signed-in session expired/wrong org", never "Syncing…". Covered in Tasks 10 and 13.
4. **A pass stuck behind a hung request, then the network returns.** The next trigger starts a fresh pass. The abandoned pass's late results must not overwrite the newer status. Covered in Task 2.
5. **First sync on an install whose local folder has records the cloud has never seen.** They go to the backup, not to the cloud. A second pass after first sync pushes nothing. Covered in Task 5.

---

## Phase A — Correctness (shippable alone)

### Task 1: Web soft-deletes and hides tombstones

**Files:**
- Modify: `apps/operator/src/lib/cloudData.ts` (`deleteProjectCloud` ~L124, `deleteShowCloud` ~L291, `deleteHotcardCloud` ~L416, `deleteTemplateCloud` ~L506, `deleteSongCloud` ~L592; `listProjectsCloud` L62, `getProjectCloud` L72, `listShowMetasCloud` L148, `getShowCloud` L172, `listHotcardMetasCloud` L309, `getHotcardCloud` L339, `listTemplateMetasCloud` L434, `getTemplateCloud` L459, `listSongMetasCloud` L521, `getSongCloud` L546)
- Test: `apps/operator/src/lib/cloudData.softDelete.test.ts`

**Interfaces:**
- Produces: the same exported names and signatures as today. Deletes now `update({ deleted_at: now })`, and every list/get filters `.is("deleted_at", null)`, matching `deleteChannelConfigCloud` (L1087).

- [ ] **Step 1: Write failing tests** with a fake client that records calls (follow the mocking style in `apps/operator/src/lib/*.test.ts`):
  - `deleteShowCloud("s1")` calls `.update({ deleted_at: <ISO string> })` with `.eq("org_id", org).eq("id","s1")`, and never `.delete()`. Repeat for project, hotcard, template, song.
  - `listShowMetasCloud()` chain includes `.is("deleted_at", null)`. Same for the other four lists and the five `get*Cloud`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/lib/cloudData.softDelete.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep `isProtectedTemplateId` guard in `deleteTemplateCloud`.
- [ ] **Step 4:** Re-run. Expect PASS. Then run `pnpm vitest run apps/operator`. Expect no new failures.
- [ ] **Step 5:** Commit `fix(cloud): web deletes are soft deletes; web lists hide deleted records`.

### Task 2: Passes can't hang

**Files:**
- Modify: `packages/core/src/syncEngine.ts` (add `SyncOptions`), `server/src/cloudSync.ts`
- Create: `packages/core/src/withTimeout.ts`
- Test: `packages/core/src/syncEngine.timeout.test.ts`, `server/src/cloudSync.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T>` rejects with `TimeoutError` (`class TimeoutError extends Error { what: string }`). Exported from `@overlaysys/core`.
  - `sync(local, remote, orgId, opts?: SyncOptions)` where `interface SyncOptions { callTimeoutMs?: number; signal?: AbortSignal; base?: SyncBase; onFirstSync?: boolean }`. `base` and `onFirstSync` are filled in by Tasks 4 and 5. Default `callTimeoutMs` is 30_000.
  - `SyncError.message` for timeouts reads `timed out after 30s waiting on <kind> <list|save id>`.
  - `cloudSync.ts`: `PASS_CEILING_MS = 120_000`. `state.passId: number`. `getCloudSyncStatus().stuck: { since: string; waitingOn: string } | null`.

- [ ] **Step 1: Failing tests.**
  - core: a remote adapter whose `listShowsSince` never resolves. `sync(..., { callTimeoutMs: 50 })` resolves with one `errors[]` entry `{ kind: "shows", id: "(list)" }` whose message matches `/timed out after/`, and other tables still reconcile.
  - core: when `signal` aborts mid-pass, `sync` stops before the next table and resolves with what it has.
  - server (fake timers): a pass whose `sync` never resolves. After 120 s `getCloudSyncStatus().running === false`, `stuck.waitingOn` is non-empty, and a new `runSyncNow()` starts a pass with a higher `passId`. When the abandoned pass resolves late, `lastResult` is **not** replaced.
- [ ] **Step 2:** Run both test files. Expect FAIL.
- [ ] **Step 3:** Implement. Wrap every adapter call in `reconcileTable` with `withTimeout`. Track the last started call's description for `waitingOn`. `runSyncNow` races the pass against `PASS_CEILING_MS`, aborts via `AbortController`, and ignores results whose `passId` isn't current.
- [ ] **Step 4:** Re-run. Expect PASS. Run `pnpm vitest run packages/core server/src/cloudSync`.
- [ ] **Step 5:** Commit `fix(sync): every cloud call times out; a stuck pass is abandoned and reported`.

### Task 3: Missing cloud tables are problems, not silent skips

**Files:**
- Modify: `packages/core/src/syncEngine.ts` (`OPTIONAL_TABLES` handling ~L386)
- Test: `packages/core/src/syncEngine.test.ts` (extend)

**Interfaces:**
- Produces: `SyncResult.missingTables: SyncEntityKind[]`. The table is still skipped (not an error), but it's listed every pass, not logged once.

- [ ] **Step 1:** Failing test: remote `listMediaItemsSince` rejects `{ code: "PGRST205" }` → `result.missingTables` equals `["media"]`, `errors` is empty, and the other tables still reconcile. A second pass reports it again.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Drop `loggedMissing`'s once-only gating of the result (keep the once-only console line).
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `fix(sync): report missing optional cloud tables on every pass`.

## Phase B — Sync base, conflicts, first sync

### Task 4: Last-agreed stamps and real conflicts

**Files:**
- Create: `packages/core/src/syncBase.ts`, `server/src/syncState.ts`
- Modify: `packages/core/src/syncEngine.ts`, `server/src/cloudSync.ts`
- Test: `packages/core/src/syncEngine.conflicts.test.ts`, `server/src/syncState.test.ts`

**Interfaces:**
- Produces (core):
  - `interface SyncBase { get(kind: SyncEntityKind, id: string): string | undefined; set(kind: SyncEntityKind, id: string, agreedUpdatedAt: string): void }`, the instant both sides last matched.
  - `SyncResult.conflicts: SyncConflict[]` where `interface SyncConflict { kind: SyncEntityKind; id: string; winner: "local" | "remote"; loser: unknown; localUpdatedAt: string; remoteUpdatedAt: string }`.
  - `SyncResult.pending: number`, the count of local records with `updatedAt` newer than base that failed to push this pass (0 when all pushed).
  - `SyncResult.overwrites` is **removed**. Callers use `conflicts`.
- Produces (server):
  - `loadSyncBase(): Promise<SyncBase & { save(): Promise<void>; isEmpty(): boolean }>`, persisted at `<dataRoot>/sync/base.json`.
  - `saveConflictCopy(c: SyncConflict): Promise<string>` writes `<dataRoot>/sync/conflicts/<kind>/<id>__<loserUpdatedAt>.json` and returns its path.
  - `listConflictCopies(): Promise<ConflictCopyMeta[]>` (`{ path, kind, id, name?, savedAt, loserUpdatedAt }`).
  - `restoreConflictCopy(path: string): Promise<void>` re-saves the loser through the kind's registry (fresh `updatedAt`) and deletes the copy.
- Rule: after any successful push/pull/equal, `base.set(kind, id, winningUpdatedAt)`. A conflict exists only when both `L.updatedAt` and `R.updatedAt` are newer than `base.get(kind,id)` and they differ. With no base entry, the record isn't a conflict (normal LWW).

- [ ] **Step 1: Failing tests (core).**
  - Remote-only change since base → pulled, `conflicts` empty.
  - Both changed since base, remote newer → pulled, one conflict `{ winner: "remote", loser: <local record> }`.
  - Local tombstone newer than remote edit, both after base → push the tombstone, conflict with `loser` = the remote edit (Review Focus 1).
  - Remote tombstone newer than local edit → pull the tombstone, conflict with `loser` = the local edit.
  - Equal stamps → `base.set` called with that stamp.
- [ ] **Step 2: Failing tests (server).** `saveConflictCopy` then `listConflictCopies` round-trips. `restoreConflictCopy` calls `shows.saveShow` with the loser's body and removes the file. `base.json` survives a reload.
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement. In `runSyncNow`, load base once per process, pass `{ base }`, `saveConflictCopy` each conflict, then `base.save()`. Add `GET /api/cloud/conflicts` and `POST /api/cloud/conflicts/restore { path }` in `server/src/cloudRoutes.ts`. Update `syncView` / `useSyncStatus` types to drop `overwrites` (Task 15 redesigns the view; just keep it compiling).
- [ ] **Step 5:** Run `pnpm vitest run packages/core server/src/syncState server/src/cloudRoutes apps/operator/src/app/shell`. Expect PASS.
- [ ] **Step 6:** Commit `feat(sync): last-agreed stamps; only real conflicts are reported and the loser is kept`.

### Task 5: First sync is cloud-is-truth with a backup

**Files:**
- Modify: `packages/core/src/syncEngine.ts`, `server/src/cloudSync.ts`, `server/src/syncState.ts`
- Test: `packages/core/src/syncEngine.firstSync.test.ts`, `server/src/syncState.test.ts`

**Interfaces:**
- Consumes: `SyncOptions.onFirstSync`, `loadSyncBase().isEmpty()`.
- Produces: `backupDataFolder(): Promise<string>` copies `<dataRoot>` (excluding `assets/` and `sync/`) to `<dataRoot>-backup-<YYYYMMDD-HHmmss>` and returns the path. `SyncResult.firstSync?: { backupPath: string; keptLocalOnly: number }`.
- Rule when `onFirstSync`: remote-only → pull; both → take remote regardless of stamps, unless remote is missing and local exists; **local-only → do not push** and count `keptLocalOnly`. Then seed base from the result.

- [ ] **Step 1:** Failing core tests: on first sync, a local-only show is not pushed (`pushed === 0`, `firstSync.keptLocalOnly === 1`). A local-newer show still takes remote. A second `sync` with the seeded base pushes nothing (Review Focus 5).
- [ ] **Step 2:** Failing server test: `backupDataFolder()` creates the sibling folder with `shows/` and without `assets/`.
- [ ] **Step 3:** Run. Expect FAIL.
- [ ] **Step 4:** Implement. `runSyncNow` calls `backupDataFolder()` before a pass when `base.isEmpty()`, and passes `onFirstSync: true`.
- [ ] **Step 5:** Run. Expect PASS.
- [ ] **Step 6:** Commit `feat(sync): first sync backs up the data folder and takes the cloud's copy`.

## Phase C — Files

### Task 6: Every referenced file, across all synced entities

**Files:**
- Modify: `packages/core/src/bundle.ts` (`collectReferencedAssetFilenames` L307)
- Test: `packages/core/src/bundle.test.ts` (extend)

**Interfaces:**
- Produces: `collectReferencedAssetFilenames(payload: { templates; hotcards; shows; decks?; mediaItems?: MediaItem[] }): Set<string>`. Media items of `kind: "file"` add `assetUrl`. Tombstoned records (`deletedAt`) contribute nothing. Live-folder items contribute nothing.

- [ ] **Step 1:** Failing tests: a media item `{ kind: "file", assetUrl: "/assets/ab…ef.mp4" }` adds `ab…ef.mp4`. A `live-folder` item adds nothing. A show with `deletedAt` adds nothing.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(core): asset collector covers media items and skips deleted records`.

### Task 7: Download missing files to the desktop

**Files:**
- Create: `server/src/assetSync.ts`
- Modify: `server/src/cloudSync.ts` (run after the entity pass)
- Test: `server/src/assetSync.test.ts`

**Interfaces:**
- Consumes: `collectReferencedAssetFilenames`, `writeAssetAtomic(filename, bytes)`, `assetBytesMatchName(filename, bytes)`, `isSafeAssetFilename`, `ASSETS_BUCKET`.
- Produces:
  - `interface AssetSyncDeps { listLocal(): Promise<Set<string>>; cloudHas(filenames: string[]): Promise<Set<string>>; download(filename: string, timeoutMs: number): Promise<Buffer>; upload(filename: string, bytes: Buffer, timeoutMs: number): Promise<void>; readLocal(filename: string): Promise<Buffer> }`
  - `syncAssets(referenced: Set<string>, deps: AssetSyncDeps): Promise<AssetSyncResult>`
  - `interface AssetSyncResult { downloaded: string[]; uploaded: string[]; failed: { filename: string; direction: "down" | "up"; message: string }[]; waiting: string[] }`. `waiting` = referenced, not local, not in the cloud yet.
  - `cloudAssetDeps(client, orgId, apiBase, accessToken): AssetSyncDeps`. `cloudHas` reads `overlaysys.asset_index` (`sha256` = filename minus ext). `download` GETs the public URL `<supabaseUrl>/storage/v1/object/public/overlaysys-assets/<orgId>/<filename>`.
  - Timeout per file: `30_000 + 1000 * ceil(sizeMB)`. Download size unknown → use the `content-length` header once received.
- Downloaded bytes that fail `assetBytesMatchName` are discarded and reported in `failed`.

- [ ] **Step 1:** Failing tests with fake deps: referenced-not-local-but-in-cloud → `download` called and file written. Not local and not in cloud → `waiting` (Review Focus 2). Hash mismatch → `failed`, nothing written. A download throwing for one file doesn't stop the others.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement the download half. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** In `runSyncNow`, after entity sync, build `referenced` from all local live templates/hotcards/shows/decks/media and call `syncAssets`. Store the result on state as `lastAssets`. Broadcast the touched lists when anything downloaded, so thumbnails refresh.
- [ ] **Step 6:** Commit `feat(sync): desktop downloads referenced files it doesn't have`.

### Task 8: Upload local files the cloud lacks

**Files:**
- Modify: `server/src/assetSync.ts`, `apps/desktop/src/serverEnv.ts` (bridge `NEXT_PUBLIC_OVERLAYSYS_API_URL` → `OVERLAYSYS_API_URL`)
- Test: `server/src/assetSync.test.ts`, `apps/desktop/src/serverEnv.test.ts`

**Interfaces:**
- Produces: `syncAssets` also uploads referenced files that are local but not in the cloud. `upload` = `POST <apiBase>/api/assets/signed-upload` (Bearer access token, `{ sha256, ext, orgId }`) → `PUT signedUrl` with the bytes → upsert `asset_index { sha256, org_id, mime, size }`, mirroring `uploadAssetCloud` in `cloudData.ts:612`. Retry policy: a file that failed is retried next pass. Whole-file retries, no chunking (see *Deviation* below).
- `resolveServerCloudEnv` also maps `OVERLAYSYS_API_URL` from `NEXT_PUBLIC_OVERLAYSYS_API_URL`.

- [ ] **Step 1:** Failing tests: local-referenced, not in the cloud → `upload` called once. Upload throws → `failed` with `direction: "up"`. Env bridging test for the API URL.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(sync): desktop uploads referenced files the cloud lacks`.

*Deviation from spec, flagged to owner:* the spec asks for resumable uploads. Supabase signed upload URLs are single-PUT, and resumable (TUS) needs storage auth that has never worked with user tokens here. With ≤1-minute videos and reliable internet, this plan uses whole-file upload with retry on the next pass. Revisit if uploads fail in practice.

### Task 9: Remove Publish

**Files:**
- Delete: `apps/operator/src/lib/projectPublish.ts` (+ its test), `server/src/publishRoute.ts` (+ test)
- Modify: `apps/operator/src/app/projects/projectsList.ts` (remove "Publish to cloud…"), `apps/operator/src/app/projects/page.tsx` (publishing state/handler), `server/src/index.ts` (drop `registerPublishRoutes`), `docs/cloud-setup.md` (Publish section → "Files sync automatically")

- [ ] **Step 1:** Remove the code. `grep -rn "publishProjectToCloud\|publish-bundle\|registerPublishRoutes" apps server packages` → no matches.
- [ ] **Step 2:** Run `pnpm typecheck` and `pnpm vitest run apps/operator/src/app/projects server`. Expect PASS.
- [ ] **Step 3:** Commit `feat(cloud): remove Publish — files and records sync automatically`.

## Phase D — Session, speed, church computer

### Task 10: The main process is the only session owner

**Files:**
- Create: `apps/desktop/src/cloudSession.ts`
- Modify: `apps/desktop/src/main.ts` (~L335–375 token push; IPC), `apps/desktop/src/preload.ts`, `apps/operator/src/lib/useAuth.ts` (~L170–210), `packages/supabase/src/index.ts` (browser client factory option)
- Test: `apps/desktop/src/cloudSession.test.ts`, `apps/operator/src/lib/useAuth.test.ts` (extend if present)

**Interfaces:**
- Produces:
  - `createCloudSession(deps: { load(): Promise<StoredTokens | null>; persist(t: StoredTokens): Promise<void>; refresh(refreshToken: string): Promise<StoredTokens>; now(): number; onTokens(t: StoredTokens): void }): { start(): Promise<void>; stop(): void; current(): StoredTokens | null }`. It refreshes when the access token is within 5 min of `exp`, persists (safeStorage), then calls `onTokens`, which pushes to the server (`pushTokensToServer`) and IPC-broadcasts `cloud:tokens` to every window. A refresh failure with `invalid_grant`/`refresh_token_not_found` → `onTokens` is not called, and status `sessionProblem: "expired"` goes to the server via `POST /api/cloud/session-problem { reason }`.
  - Preload: `onCloudTokens(cb: (t: { accessToken; refreshToken }) => void): () => void`.
  - Operator in Electron: its Supabase client is created with `autoRefreshToken: false`, applies `setSession` on each `cloud:tokens`, and **no longer calls `cloudUpdateTokens` on TOKEN_REFRESHED**.
  - Server: `getCloudSyncStatus().sessionProblem: "expired" | "wrong-org" | null`.

- [ ] **Step 1:** Failing tests (fake clock): token expiring in 4 min → `refresh` called once and `persist` + `onTokens` called with new tokens. Two overlapping `start()` ticks → one `refresh`. Refresh rejects `invalid_grant` → no `onTokens`, problem reported.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement and wire into `main.ts` on app ready (not on window creation). **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Manual check: `pnpm desktop`, sign in, close the operator window (macOS keeps the app). Then `curl localhost:<port>/api/cloud/sync` an hour+ later (or with the refresh margin temporarily set high) shows passes continuing.
- [ ] **Step 6:** Commit `feat(desktop): main process owns the cloud session; windows never refresh it`.

### Task 11: Cloud changes trigger a pass in seconds

**Files:**
- Create: `server/src/cloudRealtime.ts`, `supabase/migrations/0011_sync_realtime_and_heartbeat.sql` (realtime half)
- Modify: `server/src/cloudSync.ts`
- Test: `server/src/cloudRealtime.test.ts`

**Interfaces:**
- Produces: `startCloudRealtime(client, orgId, onChange: () => void): { stop(): void; status(): "live" | "connecting" | "unavailable" }`. It subscribes to `postgres_changes` (`schema: "overlaysys"`, event `*`, filter `org_id=eq.<orgId>`) on: projects, shows, hotcards, songs, templates, stage_layouts, channel_configs, project_channel_overrides, decks, pco_item_mappings, media_items. `onChange` → `scheduleSync()` (already debounced 1 s).
- `getCloudSyncStatus().live: "live" | "connecting" | "unavailable"`.
- Migration: `alter publication supabase_realtime add table overlaysys.<each>;` (guarded with `do $$ … exception when duplicate_object` per table).
- Periodic `SYNC_INTERVAL_MS` stays 5 min.

- [ ] **Step 1:** Failing tests with a fake channel: a payload → `onChange` once. Channel status `CHANNEL_ERROR`/`TIMED_OUT` → `status()` is `"unavailable"`, and it retries subscribe with backoff (1 s, 5 s, 30 s, then every 60 s).
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Start/stop alongside the interval in `setCloudTokens`/`clearCloudTokens`. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(sync): realtime cloud changes kick a pass within seconds`.

### Task 12: "This is the church computer", open at login, keep running

**Files:**
- Create: `apps/desktop/src/installRole.ts`
- Modify: `apps/desktop/src/main.ts` (`window-all-closed` L1881; tray), `apps/desktop/src/preload.ts`, operator settings page (place next to the existing cloud/integrations settings), `server/src/cloudSync.ts`
- Test: `apps/desktop/src/installRole.test.ts`

**Interfaces:**
- Produces:
  - `interface InstallRole { installId: string; label: string; isChurchComputer: boolean; openAtLogin: boolean }` persisted in userData `install-role.json`. `installId` = random UUID on first run.
  - IPC `install-role:get` / `install-role:set(partial)`. `set` applies `app.setLoginItemSettings({ openAtLogin })`.
  - When `isChurchComputer`: `window-all-closed` does **not** quit on Windows. The app keeps a tray icon (menu: Open OverlaySys, Sync status line, Quit).
  - The role is pushed to the server with the tokens (`POST /api/cloud/tokens` body gains `install: { installId, label, isChurchComputer }`).

- [ ] **Step 1:** Failing tests: first `load()` creates a UUID and defaults `isChurchComputer: false`, `openAtLogin: false`. `set({ isChurchComputer: true })` persists. `shouldQuitOnAllClosed({ platform: "win32", isChurchComputer: true })` → `false`.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement (settings UI: toggle "This is the church computer" + "Open OverlaySys at login", label field). **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(desktop): church-computer role, open at login, keep running in the tray`.

## Phase E — Monitoring

### Task 13: One health model on the server

**Files:**
- Create: `server/src/syncHealth.ts`
- Modify: `server/src/cloudSync.ts`, `server/src/cloudRoutes.ts`
- Test: `server/src/syncHealth.test.ts`

**Interfaces:**
- Consumes: `SyncResult` (`errors`, `conflicts`, `pending`, `missingTables`, `firstSync`), `AssetSyncResult`, `stuck`, `sessionProblem`, `live`, `paired`, `lastRanAt`.
- Produces:
  - `type SyncState = "up-to-date" | "syncing" | "offline" | "needs-attention" | "not-signed-in"`.
  - `interface SyncHealth { state: SyncState; summary: string; lastOkAt: string | null; lastRanAt: string | null; pending: number; problems: SyncProblem[]; conflicts: ConflictCopyMeta[]; files: { waiting: string[]; failed: AssetSyncResult["failed"] }; live: "live" | "connecting" | "unavailable"; history: PassRecord[]; ready: ReadyForSunday | null }`
  - `interface SyncProblem { code: "missing-table" | "session-expired" | "wrong-org" | "stuck" | "errors" | "files-failed" | "live-unavailable"; message: string }`
  - `interface PassRecord { at: string; durationMs: number; pulled: number; pushed: number; errors: number; downloaded: number; uploaded: number; outcome: "ok" | "errors" | "abandoned" | "offline" }`. Ring buffer of 50, persisted to `<dataRoot>/sync/history.json`.
  - `interface ReadyForSunday { ready: boolean; missingFiles: string[]; foldersNotSet: string[] }`, only when the install is the church computer. `foldersNotSet` = live-folder media items with no local path.
  - `computeHealth(input): SyncHealth`, a pure function.
  - `GET /api/cloud/sync` returns `{ ...existing, health: SyncHealth }`.
- Offline = every error in the last pass is a network/timeout error (`fetch failed`, `TimeoutError`, `ENOTFOUND`, `ECONNREFUSED`).
- `up-to-date` only when: paired, not running, `lastRanAt` set, no errors, `pending === 0`, no `waiting`/`failed` files, no `missingTables`, no `sessionProblem`, not stuck. `live-unavailable` is a problem but doesn't by itself block up-to-date.

- [ ] **Step 1:** Failing table tests for `computeHealth`: clean pass → `up-to-date`. `missingTables: ["media"]` → `needs-attention` with a `missing-table` problem naming the migration file. Only timeout errors → `offline` with `pending` carried. A waiting file → **not** `up-to-date` (summary "1 file still downloading"). `sessionProblem: "expired"` → `needs-attention` (Review Focus 3). Stuck → `needs-attention` with `waitingOn` in the message.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement and record history in `runSyncNow`. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(sync): server computes one health model with history and Ready for Sunday`.

### Task 14: Church-computer heartbeat

**Files:**
- Modify: `supabase/migrations/0011_sync_realtime_and_heartbeat.sql` (heartbeat half), `packages/supabase/src/database.types.ts`, `server/src/cloudSync.ts`, `apps/operator/src/lib/cloudData.ts`
- Create: `server/src/heartbeat.ts`
- Test: `server/src/heartbeat.test.ts`

**Interfaces:**
- Table:
  ```sql
  create table if not exists overlaysys.sync_heartbeats (
    org_id uuid not null, install_id text not null, label text not null,
    is_church_computer boolean not null default false,
    checked_in_at timestamptz not null, last_ok_at timestamptz,
    state text not null, summary text not null,
    pending int not null default 0, conflicts int not null default 0,
    files_waiting int not null default 0, problems jsonb not null default '[]',
    primary key (org_id, install_id));
  ```
  RLS select/insert/update for `overlaysys.is_org_member(org_id)`. Add the table to `supabase_realtime`.
- Produces:
  - `writeHeartbeat(client, orgId, install, health: SyncHealth): Promise<void>` upserts after every pass (all installs write; the church flag says which one the laptop shows). A missing table → `SyncProblem` `missing-table` (heartbeat).
  - Operator: `getChurchComputerHeartbeatCloud(): Promise<Heartbeat | null>` returns the newest row with `is_church_computer = true`.
  - `type Heartbeat = { label; checkedInAt; lastOkAt; state: SyncState; summary; pending; conflicts; filesWaiting; problems: SyncProblem[] }`.

- [ ] **Step 1:** Failing tests: `writeHeartbeat` upserts the mapped columns on `(org_id, install_id)`. PGRST205 → returns a `missing-table` problem instead of throwing.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Call it at the end of each `runSyncNow` (and on abandoned passes). **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(sync): every install checks in; the laptop can read the church computer's state`.

### Task 15: The pill and details panel (desktop and web)

**Files:**
- Modify: `apps/operator/src/app/shell/shellStatus.ts` (`syncView` L124), `apps/operator/src/app/components/SyncStatusPill.tsx`, `apps/operator/src/lib/useSyncStatus.ts`
- Create: `apps/operator/src/app/components/SyncDetails.tsx`, `apps/operator/src/lib/useChurchHeartbeat.ts`
- Test: `apps/operator/src/app/shell/shellStatus.test.ts` (extend/rewrite sync cases), `apps/operator/src/lib/useChurchHeartbeat.test.ts`

**Interfaces:**
- Consumes: `SyncHealth` (desktop, from `/api/cloud/sync`), `getChurchComputerHeartbeatCloud` (desktop non-church installs + web), `GET/POST /api/cloud/conflicts`.
- Produces:
  - `syncView(health: SyncHealth | null, church: Heartbeat | null, now: number, opts: { isChurchComputer: boolean; isWeb: boolean }): SyncView | null`.
  - Pill labels, exact: `Up to date · <rel>` / `Syncing…` / `Offline · <n> change(s) waiting` / `Needs attention`. Web: `Online` / `Offline` (own state) — web has no local replica.
  - Church line (laptop and web, never on the church install), exact: `Church computer: up to date · checked in <rel>`. Amber after 15 min with no check-in: `Church computer: last seen <rel>`. If its state isn't up-to-date: `Church computer: <summary> · checked in <rel>`. No heartbeat row: `Church computer: never checked in`.
  - `useChurchHeartbeat(): Heartbeat | null` polls every 60 s, plus a realtime subscription on `sync_heartbeats`.
  - `SyncDetails` sections (desktop): Problems, Ready for Sunday (church install only), Conflicts (each with **Restore this version**), Files (waiting/failed), Recent passes (last 10 from `history`), plus "Sync now" and "Copy details". Web shows the church line's details (problems, conflicts count, files waiting) read-only.
- `useSyncStatus` drops the Electron-only gate for the church line (web uses heartbeat only).

- [ ] **Step 1:** Failing `syncView` tests covering each pill label, the church line's four variants (fresh, 16 min stale → amber, not-up-to-date summary, never), and that a church install shows no church line.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement the view and components (follow the existing pill/menu components and tokens in `SyncStatusPill.tsx`). **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Manual check with `pnpm dev`: stop network → the pill reads `Offline · 1 change waiting` after an edit. Restore → `Up to date`. Conflict restore puts the old name back on a test show.
- [ ] **Step 6:** Commit `feat(operator): sync pill, church computer line and details panel`.

### Task 16: Web offline refusal and conflict prompts for songs/templates

**Files:**
- Create: `apps/operator/src/lib/useOnline.ts`
- Modify: the web save paths in `apps/operator/src/lib/cloudData.ts` (`save*Cloud`), `apps/operator/src/app/songs/edit/*` and `apps/operator/src/app/design/edit/page.tsx` (conflict prompt, copying the pattern in `apps/operator/src/app/shows/edit/page.tsx` using `getSongUpdatedAtCloud` / `getTemplateUpdatedAtCloud`)
- Test: `apps/operator/src/lib/cloudData.offline.test.ts`, the editors' existing test files (extend)

**Interfaces:**
- Produces: `class OfflineError extends Error {}`. Every `save*Cloud`/`delete*Cloud` throws `OfflineError("You're offline — changes can't be saved until you reconnect.")` when `navigator.onLine === false`, and the editors toast that message (no modal). `useOnline(): boolean` from `online`/`offline` events.
- Song and template editors in cloud mode record `updated_at` at load, and before save prompt "This song changed in the cloud since you opened it. Save over it?" (templates: "This template…"). The wording matches the existing show prompt.

- [ ] **Step 1:** Failing tests: `navigator.onLine = false` → `saveShowCloud` rejects with `OfflineError` and makes no client call. The song editor prompts when `getSongUpdatedAtCloud` returns a newer stamp.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(cloud): web refuses saves offline; songs and templates warn before overwriting newer cloud copies`.

### Task 17: Ship-check round trip

**Files:**
- Create: `scripts/sync-roundtrip.mjs` (dev-only, the WS + `/api/cloud/sync` driver used in verification on 2026-10-30)
- Modify: `docs/cloud-setup.md` (how to apply `0011`, the role setting, how to read status)

- [ ] **Step 1:** Apply `0011` to apps-portal (owner, by hand). `GET /api/cloud/sync` → `health.problems` has no `missing-table`.
- [ ] **Step 2:** Run `node scripts/sync-roundtrip.mjs all` against `pnpm dev`. Expected: desktop create/edit/delete reaches the cloud. A web create/rename arrives within ~5 s (realtime). A web delete does **not** come back. A video added on the desktop appears on the web and vice versa. Health ends `up-to-date`.
- [ ] **Step 3:** `pnpm typecheck && pnpm test`. Expect all green.
- [ ] **Step 4:** Commit `chore(sync): round-trip script and setup docs for automatic sync`.
