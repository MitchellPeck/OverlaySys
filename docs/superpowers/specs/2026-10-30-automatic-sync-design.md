# Automatic sync: design

Date: 2026-10-30 · Branch context: `feat/media-library`

## Intent

Shows run on a desktop install that stays at church. The owner edits during
the week from a laptop, using both the desktop app and the web version, and
needs to *trust* that the church computer and the cloud match, without
pressing anything. "Sync" should be the only model: no Push, no Pull, no
Publish. The owner checks status from the laptop during the week ("did my
edits reach church?") and on the church computer on Sunday ("is everything
here and ready?").

## Where things stand (verified 2026-10-30)

A live round trip against the apps-portal cloud (dev server signed in to the
grace org) showed:

| Path | Result |
|---|---|
| Desktop create, edit, delete → cloud | ✅ one pass, no bounce-back (trigger fix in `0010` is live) |
| Cloud → desktop (new show, rename) | ✅ |
| Decks | ✅ |
| Media items | ✅ only after `docs/cloud-media-sync-migration.md` was applied today; before that the table was **silently skipped** |
| Desktop delete seen on web | ❌ web list queries don't filter `deleted_at` |
| Web delete | ❌ web hard-deletes; the desktop re-pushes its copy (resurrection) |
| Picture/video files | ❌ entity sync never moves asset bytes; only per-project **Publish** does |
| Incoming normal edit | ⚠️ reported as an "overwrite", so real conflicts are indistinguishable |

From code reading:
- A sync pass has no timeouts. A hung request leaves `running: true` forever.
  The pill shows "syncing…" indefinitely and every later trigger queues
  behind it with no error. This matches a report from the church install.
  (The installed build there is also stale, so it isn't confirmed.)
- Cloud → desktop latency is up to 5 min (`SYNC_INTERVAL_MS`), with no realtime.
- The server's Supabase client has `autoRefreshToken: false` and relies on the
  operator window pushing refreshed tokens (`/api/cloud/tokens`). Unverified
  whether that hand-off keeps working over days with no one touching the app.
- The web conflict prompt exists only for shows and hotcards.

Key files: `packages/core/src/syncEngine.ts`, `server/src/cloudSync.ts`,
`packages/supabase/src/cloudStorageAdapter.ts`, `apps/operator/src/lib/cloudData.ts`,
`apps/operator/src/lib/projectPublish.ts`, `server/src/publishRoute.ts`,
`apps/operator/src/app/shell/shellStatus.ts` (`syncView`),
`apps/operator/src/app/components/SyncStatusPill.tsx`,
`apps/operator/src/lib/useSyncStatus.ts`,
`apps/operator/src/app/api/assets/signed-upload/route.ts`.

## Goals

1. **Deletes are deletes everywhere.** The web soft-deletes (stamps
   `deleted_at`, same as `deleteChannelConfigCloud` already does) for
   projects, shows, hotcards, templates and songs. Every web list/get hides
   tombstones. Nothing deleted on either side comes back.
2. **Files sync both ways, automatically.** Every asset referenced by a
   synced entity (show rows, decks, templates, hotcards, media items) reaches
   the other side without user action:
   - The church computer downloads any referenced asset it doesn't have into
     its content-addressed store (`data/assets/<sha256>.<ext>`).
   - The desktop uploads any referenced asset the cloud doesn't have
     (checked via `asset_index`), using resumable/chunked upload so a dropped
     connection resumes. Files up to ~1 GB must work (bucket limit is 1 GB;
     the current library's largest is 150 MB).
   - Asset sync failures are per-file and retried. They never block entity
     sync.
3. **Publish goes away.** Remove the per-project Publish action
   (`projectsList.ts` "Publish to cloud…", `projects/page.tsx`,
   `lib/projectPublish.ts`, `POST /api/projects/:id/publish-bundle` in
   `server/src/publishRoute.ts`) once goal 2 ships. Bundle *export/import*
   (files on disk) is a different feature and stays.
4. **Cloud changes reach the church computer in seconds.** The desktop
   subscribes to cloud changes (Supabase Realtime on the `overlaysys` tables,
   or an equivalent) and runs a pass within a few seconds of one. The
   periodic pass stays as a backstop.
5. **Passes can't hang.** Every network call in a pass has a timeout. A pass
   that exceeds a ceiling (~2 min, longer allowance for in-flight file
   transfers) is abandoned and reported with what it was waiting on. The next
   trigger starts a fresh pass.
6. **Real conflict detection.** A conflict is "both sides changed this record
   since the last time they agreed." That needs a per-record last-agreed
   stamp on the desktop. Normal incoming edits aren't reported. On a real
   conflict, last-writer-wins still decides, but the losing version is kept
   locally so it can be restored from the status details.
7. **Status monitoring** (below).

## Status monitoring

**Header pill, every surface (desktop app and web).** It shows this machine's
state: *Up to date · 2 min ago* / *Syncing* / *Offline · N changes waiting* /
*Needs attention*.

**Church computer line.** The church computer writes a heartbeat to the
cloud after every pass: when it last checked in, last successful pass, and
whether it's up to date (no pending pushes, no missing files, no errors).
The laptop (desktop and web) shows **"Church computer: up to date · checked
in 4 min ago"**. The line turns amber when it hasn't checked in for a while,
and says when it was last seen.

**"Ready for Sunday" (on the church computer).** In the details: confirms
every show, song, deck, template and media file this machine needs is on
local disk, so nothing depends on the internet during service. It names any
file still downloading or failed.

**Details panel (both).**
- Real conflicts only, with which version won and *restore the other*.
- Stuck/abandoned passes, with what they were waiting on.
- Problems that are silent today, shown loudly: a missing optional cloud
  table (today `OPTIONAL_TABLES` skips with a console.info only), a stale or
  wrong-account session, files that failed to transfer.
- A short history of recent passes (time, what moved, errors) so "it didn't
  sync Saturday" can be checked after the fact.

## Non-goals

- Editing decks or media from the web version. They stay desktop-only
  (hidden in cloud mode today). That's a separate project.
- Field-level merge. Records stay whole-document last-writer-wins. Goal 6
  only makes losses visible and recoverable.
- Multi-church / multi-org fleet monitoring. There's one church computer.
- Asset garbage collection in the bucket.

## Anti-goals (failure even if it "works")

- Anything that can show *Up to date* while something is actually missing,
  skipped or stuck. The whole point is trust. A false green is worse than
  no pill.
- Sunday playback depending on the internet. Files must be local before
  they're needed.
- A sync problem interrupting a live show: no modal popups, no blocking.
  Status is glanceable and the details are opt-in.

## Constraints

- Cloud is apps-portal's Supabase (schema `overlaysys`). Migrations are
  applied **by hand** and have lagged the repo before (see
  `docs/cloud-*-migration.md`). Any new table/column (heartbeat, etc.) needs
  a migration doc in the same style. Code must report a missing one loudly
  (goal 7), not skip it.
- The Supabase MCP in this environment can't reach that project.
- Asset uploads from a user session go through the signed-upload route on
  the web deploy (`apps/operator/src/app/api/assets/signed-upload/route.ts`).
  Direct storage RLS for authenticated users has never worked. The desktop
  server is Node and has no Next routes. Assets are content-addressed
  (`<sha256>.<ext>`). The bucket is read via public URLs
  (`resolveAssetUrlCloud`).
- The desktop's cloud session lives in the Electron host (keychain), and is
  pushed to the server (`/api/cloud/tokens`, loopback-only).
- Desktop and web must keep working offline/degraded. Local saves never wait
  on the cloud.

## Decided by the owner

- Sync only. No push/pull/publish actions.
- The owner uses both the desktop app and the web version on the laptop.
- Status audience: the owner, from the laptop during the week and at the
  church computer on Sunday.
- The church computer has reliable internet. Videos are about one minute
  max. The bucket's per-file limit is 1 GB.
- The church computer is on all week. OverlaySys isn't always open today,
  but the owner will keep it open. So the weekly "checked in N min ago" line
  and its amber threshold are meaningful.
- The church computer's project data has already been pushed to the cloud
  successfully, so the cloud is a safe source of truth for the fresh install.

## First sync on a fresh install

The cloud is the truth. Before the first pass on an install with no sync
history (no last-agreed stamps), back up the local data folder (timestamped
copy alongside it), then take the cloud's version of every record. Local-only
records are **not** uploaded on that first pass. They stay in the backup.
This avoids resurrecting anything the web hard-deleted in the past. After
the first pass, normal two-way sync applies. This also covers the laptop's
desktop app on its first sync after this ships.

## Session and background running

The cloud login must stay fresh with no one touching the app for days.
Move token refresh out of the operator window into one owner: the Electron
main process or the server, never both, because Supabase rotates refresh
tokens and two refreshers log each other out. Sync must keep running with
every window closed or minimized, as long as the app process is alive.
*Claude's call:* on the install marked as the church computer, offer
"Open at login" and keep running in the tray/menu bar when windows close.
That way "keep it open" survives reboots and accidental closes.

## Builder's calls (marked as such)

- *Claude's call:* realtime-triggered pulls with the periodic pass as
  backstop (goal 4).
- *Claude's call:* the ~2 min pass ceiling and the "hasn't checked in"
  amber threshold. Tune as needed.
- *Claude's call:* a per-install **"This is the church computer"** setting.
  Only that install writes the heartbeat and shows "Ready for Sunday".
- *Claude's call:* conflict restore is desktop-only. Losing versions stay on
  the machine where the conflict happened. The web panel shows the church
  computer's conflict count via the heartbeat, plus its own state. The web
  keeps its existing save-time "newer copy" prompt (extending it to songs and
  templates is in scope).
- *Claude's call:* the web doesn't queue offline edits. It shows "Offline"
  and refuses saves visibly. "N changes waiting" is desktop-only.
- *Claude's call:* live-folder media items (path is per machine, never
  synced) appear in "Ready for Sunday" as "folder not set on this machine"
  when unset, and aren't treated as missing files.
- *Claude's call:* existing hard-deleted-then-resurrected or
  visible-but-tombstoned leftovers (sync test shows, the "test" project)
  need no special migration. They disappear once goal 1 ships.
- Left to the builder: transport for desktop uploads (reuse signed-upload
  vs. a new route), where the last-agreed stamps and history live, the
  heartbeat's table shape, realtime vs. polling details, and how
  `fanOutSyncWrites` notices asset arrivals.

## Rollout note

The church computer runs a stale build (Windows installer from May 14,
unpacked Windows build from Aug 2 with no cloud sync code). Ship this as a
fresh install and verify on it with the same round trip (desktop
create/edit/delete, web create/rename/delete, a video added on each side).
