# Media Library, Media Rows, Live Folders and Looping Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photos join videos as rundown Media rows. A synced media library and per-machine live folders feed rows, slides and design layers. Decks can auto-advance and loop. A media-only deck, such as the announcements loop, plays in the media slot and keeps running under graphics.

**Architecture:**
- **Data:**
  - New synced entity `MediaItem` (a file item, or a live-folder record).
  - Deck gains timing, loop, media slides and a live-folder link.
  - Image rows are a new row kind `media`; video rows stay `kind: "video"`.
  - The server's media slot learns images, loop and mute.
- **Playback:** a new server `mediaDeckSession` drives media-only decks through `channels.mediaTake` on a server-side timer. Template decks get the same timer inside `slidesSession`.
- **Live folders:** paths are per-machine settings. The server watches each folder, with a settle time, and serves its files read-only.

**Tech Stack:** TypeScript, zod (`@overlaysys/core`), Fastify + ws (`server`), Next.js operator (`apps/operator`), React renderer (`apps/renderer`), Electron (`apps/desktop`), Supabase sync (`packages/supabase`), Companion module, vitest (node environment, no jsdom).

**Spec:** `docs/superpowers/specs/2026-10-30-media-library-design.md`. Read it before any task; its "Decisions made in review" and "Overlays on a running loop" sections are binding.

## Global Constraints

- **Video rows on disk:** video rows stay `kind: "video"`. Only photo rows use `kind: "media"` with `mediaType: "image"`. Readers accept both. The UI calls both "Media".
- **Defaults:** `VideoRowSchema.endAction` keeps its schema default `"clear"`, so existing rows are unchanged. New rows created in the UI default to `endAction: "hold"`.
- **Audio:** full-screen videos play audio unless the row or slide sets `muted: true`. Video layers inside templates stay silent (existing `muted` default `true`).
- **Old-client compatibility:** media slides always carry `data: {}` so older clients still parse decks.
- **Ids:** new record ids must satisfy the server id rule (`[A-Za-z0-9_-]`, at most 64 characters; `server/src/recordId.ts`).
- **Live folders:**
  - **Path storage:** the path is per machine, in `dataRoot()/settings/media-folders.json`. It is never synced, never written into a `MediaItem`, and never sent to the renderer.
  - **Visibility:** a live-folder file is visible only after its size and mtime have been unchanged for `LIVE_FOLDER_SETTLE_MS = 3000`.
  - **Files:** only top-level files are included, with image extensions `png jpg jpeg gif webp avif bmp` and video extensions `mp4 webm mov m4v`.
  - **URLs:** files are served at `/media-folders/<folderId>/<encoded file name>`. The resolved path must stay inside the configured folder, with symlinks resolved via `realpath`.
- **Auto-advance:**
  - It runs only on a channel other than `"preview"`. A take on `"preview"` shows the slide statically. Promoting preview to program starts the timer from the current slide.
  - A manual next/previous/go-to restarts the hold timer from the new slide.
- **Media-only decks** (every slide has `media`, or the deck has `liveFolderId`):
  - They play in the **media slot**.
  - Graphics takes do **not** stop them.
  - They stop on `mediaClear`, a `mediaTake` that isn't their own, another media-only deck take, `clear_all_channels`, or `slidesSession`-style `end`.
- **Decks with any template slide** play in the graphics slot exactly as today. Their timer stops whenever `slidesSession.dropAll` runs.
- **Non-looping deck end:** a non-looping auto-advancing deck holds its last slide and sets `atEnd`. Item-end tracking treats that as ended.
- **Live-folder order:**
  - New files join at the end, sorted by name among themselves.
  - Missing files are skipped but keep their saved position.
  - A file that returns resumes its old position.
  - New files are picked up only when the loop wraps or the deck is taken.
- **Library references:** anything that references a library item stores `mediaItemId` **and** the resolved `assetUrl`. Saving an item with a new `assetUrl` rewrites the stored `assetUrl` in shows and decks. Media already on air is not changed.
- **New cloud table:** `overlaysys.media_items` is optional. The client syncs without it until the apps-portal migration is applied (`OPTIONAL_TABLES`).
- **Operator copy:** plain language. The area is called "Media"; a live folder is "Live folder".
- **Commits:** never stage anything under `data/`. Stage by explicit path. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** `npx vitest run <path>` from the repo root. Typecheck every touched package with `pnpm -C <pkg> exec tsc --noEmit`.

## Review Focus

1. **A graphic copied into the live folder during a service.** A file still being written must never be shown. It appears only after it has been unchanged for 3 s. Pinned in Task 4 (`waits for a file to settle before listing it`).
2. **A file deleted or renamed while it is the current loop slide.** The current slide stays on air until its hold ends, then the loop moves on to the next present file. It must not crash or go black. Pinned in Task 7 (`skips a slide whose file disappeared`).
3. **Folder path unset, missing, unreadable or empty.** A take shows nothing and the server answers with a plain-language error. The loop never spins on an empty list. Pinned in Task 4 (`missing folder lists no files`) and Task 7 (`empty folder deck refuses to take`).
4. **Path traversal or a symlink out of the folder through `/media-folders/...`.** The server responds 404. Pinned in Task 4 (`refuses traversal and symlink escape`).
5. **A lower third taken over a running media loop.** The loop keeps advancing. Another Media row take stops it. Pinned in Task 7 (`graphics take leaves the loop running`, `media take stops the loop`).

---

### Task 1: Core schemas and pure helpers

**Files:**
- Create: `packages/core/src/mediaItem.ts`, `packages/core/src/mediaItem.test.ts`, `packages/core/src/mediaDeck.ts`, `packages/core/src/mediaDeck.test.ts`
- Modify: `packages/core/src/deck.ts`, `packages/core/src/show.ts` (row union at 281-295), `packages/core/src/channel.ts` (`ChannelMediaSchema` 82-95), `packages/core/src/index.ts`, `packages/core/src/slides.ts` (`SlidesSessionSummarySchema` 138-150)

**Interfaces:**
- Produces:
  - **`MediaItemSchema`:** `{ id, name, kind: "file" | "live-folder", mediaType?: "image" | "video", assetUrl?: string, width?: number, height?: number, durationSec?: number, folder?: string, createdAt, updatedAt?, deletedAt? }`. Passthrough. `assetUrl` and `mediaType` are required when `kind === "file"` (zod `superRefine`). Exports types `MediaItem` and `MediaItemMeta = MediaItem & { usedBy: number }`.
  - **`MediaRefSchema`:** `{ mediaItemId?: string, assetUrl: string, mediaType: "image" | "video" }`.
  - **`DeckSlideSchema`** gains optional `media?: MediaRef`, `holdSec?: number` (>0), `advanceOnEnd?: boolean`, and `muted?: boolean`.
  - **`DeckSchema`** gains optional `defaultHoldSec?: number` (>0; its presence means the deck auto-advances), `loop?: boolean`, `liveFolderId?: string`, and `folderOrder?: { file: string; holdSec?: number }[]`.
  - **`ImageRowSchema`** (in show.ts): `{ kind: "media", mediaType: "image", id, assetUrl, mediaItemId?, label?, fit: "contain" | "cover" | "fill" = "cover", transitionIn/transitionOut (MediaTransitionSchema defaults), sectionId?, stageLayouts?, channelHint?, notes?, sermonNotesId?, lengthSec?, lengthSecManual?, sourceRef? }`. Passthrough. Added to the `RundownRowSchema` union; the `RundownRow` type includes `ImageRow`.
  - **`VideoRowObject`** gains optional `mediaItemId?: string`, `loop?: boolean`, and `muted?: boolean`.
  - **`ChannelMediaSchema`** gains `mediaType: "image" | "video"` (default `"video"`), `fit` (default `"contain"`), `loop: boolean` (default `false`), and `muted: boolean` (default `false`).
  - **`SlidesSessionSummarySchema`** gains optional `nextAdvanceAt?: number` (epoch ms, server clock), `loops?: boolean`, and `slot?: "graphics" | "media"`.
  - **`mediaDeck.ts`:**
    - `isMediaOnlyDeck(deck: Deck): boolean`. True when `liveFolderId` is set, or when `slides.length > 0` and every slide has `media`.
    - `resolveFolderDeckSlides(order: Deck["folderOrder"], files: LiveFolderFile[], defaultHoldSec: number | undefined, folderId: string): MediaDeckSlide[]`.
    - `nextFolderOrder(order, files): NonNullable<Deck["folderOrder"]>` returns the saved order plus newly seen files appended, name-sorted.
    - `LiveFolderFile = { name: string; mediaType: "image" | "video"; size: number; mtimeMs: number }`.
    - `MediaDeckSlide = { key: string; assetUrl: string; mediaType: "image" | "video"; holdSec?: number; advanceOnEnd: boolean; muted: boolean; label?: string }`.
    - `liveFolderFileUrl(folderId: string, name: string): string` returns `/media-folders/${folderId}/${encodeURIComponent(name)}`.
    - `mediaDeckSlidesFromDeck(deck: Deck): MediaDeckSlide[]` covers non-folder media-only decks.

- [ ] **Step 1: Write failing tests** in `mediaItem.test.ts` and `mediaDeck.test.ts`:
  - `MediaItemSchema rejects a file item without assetUrl`.
  - `a live-folder item needs no assetUrl`.
  - `RundownRowSchema parses {kind:"media", mediaType:"image", id:"r1", assetUrl:"/assets/a.png"} with fit "cover"`.
  - `an existing {kind:"video"} row parses unchanged with endAction "clear"`.
  - `DeckSchema accepts a media slide {id:"s1", data:{}, media:{assetUrl:"/assets/a.png", mediaType:"image"}, holdSec:8}`.
  - `isMediaOnlyDeck is true for a liveFolderId deck with no slides, false when one slide has no media`.
  - `resolveFolderDeckSlides`:
    - saved `[b,a]` with files `{a,b,c}` gives `[b,a,c]`;
    - saved `[b,x,a]` with x missing gives `[b,a]`;
    - per-file `holdSec` overrides `defaultHoldSec`;
    - videos get `advanceOnEnd: true`.
  - `nextFolderOrder appends unseen files name-sorted and keeps missing ones`.
  - `liveFolderFileUrl encodes spaces and #`.
- [ ] **Step 2:** Run `npx vitest run packages/core/src/mediaItem.test.ts packages/core/src/mediaDeck.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the schemas and helpers above.** Keep `SlidesRowFields`/`DeckSlideFields` in step (the compile check is at show.ts:270). Export everything from `index.ts`.
- [ ] **Step 4:** Run `npx vitest run packages/core` and `pnpm -C packages/core exec tsc --noEmit`. Expected: PASS. Then typecheck `server` and `apps/operator`, and fix exhaustiveness errors **only** by adding `case "media":` branches that mirror the `"video"` branch where the code just passes a row through. Behaviour work happens in later tasks.
- [ ] **Step 5: Commit** `feat(core): media items, image rows, deck timing and live-folder deck helpers`.

### Task 2: Server media library registry and protocol

**Files:**
- Create: `server/src/mediaStore.ts`, `server/src/media.ts`, `server/src/mediaHandlers.ts`, `server/src/media.test.ts`
- Modify: `packages/ws-protocol/src/index.ts` (client msgs near 364, server msgs near 652, `REQUEST_ENTITY_KEYS`/`REQUEST_ID_KEYS` 701-715), `server/src/ws.ts` (routing near 1003), `server/src/index.ts` (boot near 144), `packages/ws-protocol/src/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 `MediaItemSchema`, `MediaItemMeta`.
- Produces:
  - **Client messages:** `list_media`, `get_media_item{id}`, `save_media_item{item}`, `delete_media_item{id}`, `restore_media_item{id}`.
  - **Server messages:** `media_list{items: MediaItemMeta[]}`, `media_item{item}`.
  - **Server functions:** `reloadMedia()`, `listMediaMetas(): Promise<MediaItemMeta[]>` (`usedBy` counts references by `mediaItemId` in show rows, deck slides and folder decks' `liveFolderId`), `getMediaItem(id)`, `saveMediaItem(item)`, `deleteMediaItem(id)`, `restoreMediaItem(id)`.
  - **Disk:** stored under `dataRoot()/media`, mirroring `decksStore.ts`, with `recordFile` and write-file-atomic.

- [ ] **Step 1: Write failing tests** in `server/src/media.test.ts`, using the `decks.test.ts` temp-dir setup:
  - `save then list returns the item with usedBy 0`.
  - `usedBy counts a show image row and a deck media slide referencing it`.
  - `delete tombstones; restore revives`.
  - `rejects an unsafe id with statusCode 400`.
  - In `schema.test.ts`: `save_media_item round-trips`.
- [ ] **Step 2:** Run `npx vitest run server/src/media.test.ts packages/ws-protocol`. Expected: FAIL.
- [ ] **Step 3: Implement the store, registry and handlers by copying the deck pattern.** `slidesHandlers.ts` covers the save/delete ack, broadcast, `scheduleSync()` and `stageFeedHub.invalidateAll()`. Route the messages in `ws.ts`, call `reloadMedia()` at boot, and send `media_list` on `list_media`.
- [ ] **Step 4:** Run the tests and `pnpm -C server exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): media library registry and protocol`.

### Task 3: Media library cloud sync

**Files:**
- Modify: `packages/core/src/syncEngine.ts` (`SyncEntityKind` 87, `perTable` 182, a reconcile block like 252-260, `OPTIONAL_TABLES` 301), `packages/core/src/storageAdapter.ts` (80-85, `SyncCursor`, `PendingWriteKind`), `server/src/fsStorageAdapter.ts` (like 289-313), `packages/supabase/src/cloudStorageAdapter.ts` (`PayloadTable` 44-50, methods like 330-345), `packages/supabase/src/database.types.ts`, `server/src/cloudSync.ts` (like 274-291)
- Create: `docs/cloud-media-sync-migration.md`
- Test: `packages/core/src/syncEngine.test.ts`, `server/src/fsStorageAdapter.test.ts`, `packages/supabase/src/cloudStorageAdapter.test.ts`

**Interfaces:**
- Consumes: Task 2 store functions.
- Produces:
  - `SyncEntityKind` includes `"media"` (in `OPTIONAL_TABLES`).
  - The adapter interface gets `listMediaItems`, `listMediaItemsSince`, `getMediaItem`, `saveMediaItem` and `deleteMediaItem`.
  - The cloud table is `overlaysys.media_items` (payload table, same columns as `decks`).

- [ ] **Step 1: Write failing tests:**
  - `syncEngine: pushes a local media item and pulls a remote one`.
  - `syncEngine: a missing media_items table is skipped quietly` (copy the decks optional-table test).
  - `fsStorageAdapter: media item round-trip keeps the newer stored copy`.
  - `cloudStorageAdapter: media_items save/list maps payload rows`.
- [ ] **Step 2:** Run those three test files. Expected: FAIL.
- [ ] **Step 3: Implement the adapter methods and engine registration.** In `cloudSync.ts`, `touched("media")` triggers `reloadMedia()` and broadcasts `media_list`. Write the migration doc by copying `docs/cloud-slides-sync-migration.md`: the table, RLS policies using `overlaysys.is_org_member(org_id)`, the `updated_at` trigger, and the "regenerate types" and "skipped quietly" notes.
- [ ] **Step 4:** Run the tests and typecheck `packages/core`, `packages/supabase` and `server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sync): media items sync as an optional cloud table`.

### Task 4: Live folders on the server

**Files:**
- Create: `server/src/liveFolders.ts`, `server/src/liveFolders.test.ts`
- Modify: `packages/ws-protocol/src/index.ts`, `server/src/ws.ts`, `server/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `LiveFolderFile`, `liveFolderFileUrl`.
- Produces:
  - **Settings:** `settings/media-folders.json`, shaped `{ [folderId]: { path: string } }`.
  - **Functions:**
    - `getLiveFolderPath(id): Promise<string | null>` and `setLiveFolderPath(id, path | null)`. The path must be absolute and an existing directory, otherwise it throws with `statusCode 400`.
    - `listLiveFolderFiles(id): LiveFolderFile[]` returns only settled files and `[]` when the path is unset, missing or unreadable.
    - `onLiveFolderChange(cb: (id: string, files: LiveFolderFile[]) => void): () => void`.
    - `startLiveFolderWatchers()` and `stopLiveFolderWatchers()`.
    - `resolveLiveFolderFile(id, name): Promise<string | null>` gives the absolute real path or null. It rejects names containing `/`, `\`, `..`, a leading `.`, or NUL, and rejects paths whose `realpath` is outside the folder's `realpath`.
  - **HTTP:**
    - `GET /api/media-folders/:id/path` returns `{path|null}`.
    - `PUT /api/media-folders/:id/path` takes `{path|null}` and is local-only, reusing the existing local gate.
    - `GET /media-folders/:id/:file` streams the file with its mime type and `X-Content-Type-Options: nosniff`, or responds 404.
  - **WS:**
    - Client `list_live_folder{id}`.
    - Server `live_folder_files{id, files: LiveFolderFile[], configured: boolean}`, broadcast on change.
  - **Watching:**
    - Use `fs.watch` on the folder, plus a 5 s polling rescan as a fallback. No new dependency.
    - A file is listed once its `size` and `mtimeMs` have been unchanged for `LIVE_FOLDER_SETTLE_MS = 3000`.

- [ ] **Step 1: Write failing tests** in a temp dir, with fake timers for the settle logic. Inject a `now()` and a scanner so no real watcher is needed:
  - `missing folder lists no files`.
  - `lists top-level images and videos only, ignoring subfolders, dotfiles and .txt`.
  - `waits for a file to settle before listing it` (size changes at t=0 and t=1 s, so it is listed only after t≥4 s).
  - `a removed file leaves the list and fires onLiveFolderChange`.
  - `refuses traversal and symlink escape` (`../x`, a symlink to a file outside, gives null and a 404).
  - `PUT path rejects a relative path and a non-directory with 400`.
- [ ] **Step 2:** Run `npx vitest run server/src/liveFolders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the pure parts (the settle state machine and filtering) in exported functions tested directly. Start the watchers at boot for every live-folder `MediaItem` that has a configured path, and re-sync them when media items or paths change.
- [ ] **Step 4:** Run the tests and `pnpm -C server exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): live folders — per-machine path, settled file list, safe serving`.

### Task 5: Desktop folder picker

**Files:**
- Create: `apps/desktop/src/folderPick.ts`, `apps/desktop/src/folderPick.test.ts`
- Modify: `apps/desktop/src/main.ts` (IPC area near 1519), `apps/desktop/src/preload.ts`, `apps/operator/src/lib/desktop.ts`

**Interfaces:**
- Produces:
  - IPC `overlaysys:pick-folder`, which returns `string | null`.
  - Preload `pickFolder(): Promise<string | null>`.
  - Operator `getDesktopApi()?.pickFolder`.
  - Pure `folderFromDialogResult(r: { canceled: boolean; filePaths: string[] }): string | null`.

- [ ] **Step 1: Write the failing test:** `folderFromDialogResult returns null when canceled or empty, else the first path`.
- [ ] **Step 2:** Run `npx vitest run apps/desktop/src/folderPick.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `main.ts`, use `dialog.showOpenDialog(operatorWindow, { properties: ["openDirectory"] })`. Add the binding to the preload, and the optional method to the operator's `DesktopApi` type.
- [ ] **Step 4:** Run the test, and `tsc` for `apps/desktop` and `apps/operator`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): choose a folder for a live folder`.

### Task 6: Media slot shows photos, loops and mutes

**Files:**
- Modify: `server/src/channels.ts` (`MediaTakeArgs` 551, `mediaTake` 561, `mediaStatus` ~632), `packages/ws-protocol/src/index.ts` (`media_take` 229-243), `apps/renderer/src/MediaLayer.tsx`, `apps/operator/src/lib/mediaTake.ts`, `packages/companion-module/src/actions.ts:139-153`
- Test: `server/src/channels.test.ts` (or the existing media test file), `apps/renderer/src/*.test.ts` for any pure helper you extract, `apps/operator/src/lib/mediaTake.test.ts`

**Interfaces:**
- Consumes: Task 1 `ChannelMediaSchema` fields, `ImageRow`.
- Produces:
  - `MediaTakeArgs` gains `mediaType?: "image" | "video"`, `fit?`, `loop?: boolean`, `muted?: boolean`, and `owner?: string` (the media-deck session marks its own takes; Task 7).
  - `media_take` carries the same optional fields.
  - Operator `mediaRowTakeMessage(row: VideoRow | ImageRow, showId?)` replaces `videoRowTakeMessage`; keep the old name as an alias.

- [ ] **Step 1: Write failing tests:**
  - `mediaTake of an image stores mediaType "image" and never reports ended`.
  - `mediaStatus "ended" on a looping video seeks to 0 and keeps playing`.
  - `mediaRowTakeMessage builds image and video takes with loop and muted`.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Server:** carry the new fields through. Loop goes through the existing seek path, or tell the renderer to set `loop`; pick one and test it.
  - **Renderer:** render `<img>` for `mediaType === "image"`, with the same transitions. Use `objectFit` from `fit`, replacing the hard-coded `"contain"`. Set `muted` and `loop` on `<video>`.
  - **Companion:** builds the same message for both kinds.
- [ ] **Step 4:** Run the tests, and `tsc` for server, renderer, operator and companion-module. Expected: PASS.
- [ ] **Step 5: Commit** `feat(media): the media slot shows photos and can loop or mute a video`.

### Task 7: Media-only deck playback (the announcements loop)

**Files:**
- Create: `server/src/mediaDeckSession.ts`, `server/src/mediaDeckSession.test.ts`
- Modify: `server/src/slidesHandlers.ts` (`takeSlides` 49, `handleSlidesMessage` 124), `server/src/channels.ts` (`mediaTake`/`mediaClear` hooks, `takePvwToPgm` 425), `server/src/itemEnd.ts`, `server/src/ws.ts` (`clear_all_channels` 280)

**Interfaces:**
- Consumes:
  - Task 1 `isMediaOnlyDeck`, `resolveFolderDeckSlides`, `mediaDeckSlidesFromDeck`.
  - Task 4 `listLiveFolderFiles`, `onLiveFolderChange`.
  - Task 6 `mediaTake` with `owner`.
- Produces:
  - `start(channel, args: { rowId: string; showId?: string; deck: Deck; slideIdx?: number }): { ok: true } | { ok: false; error: string }`.
  - `step(channel, delta: 1 | -1)`, `goTo(channel, idx)`, `end(channel)`, `dropAll(channel)`, `promote(from, to)`, `summary(channel): SlidesSessionSummary | null` (with `slot: "media"`, `loops`, `nextAdvanceAt`), and `onSummaryChange(cb)`.
  - The existing `slides_take`, `slides_next`, `slides_prev`, `slides_goto` and `slides_end` messages route here when the session on that channel is a media session. Companion's "go to slide N" keeps working.

**Behaviour (from the spec, binding):**
- **Timer:** each slide calls `channels.mediaTake(channel, {..., owner: "mediaDeck:<rowId>"})`. Images advance after `holdSec ?? deck.defaultHoldSec`; with no hold, they don't advance. A video with `advanceOnEnd` advances on the existing `mediaStatus "ended"`, otherwise on its hold.
- **Wrapping:**
  - When the deck loops, it wraps to 0. A live-folder deck re-resolves its slides at the wrap, so new files join here.
  - A non-looping deck holds its last slide and sets `atEnd`. `itemEnd.rowsOnAir` counts it as ended.
- **Preview:** a take on `"preview"` shows the slide with no timer. `promote` to program starts the timer from the current slide.
- **Missing files:**
  - When a slide's file has disappeared (a live-folder change), the deck skips it at the next advance.
  - If the current file disappears, it stays on air until its hold ends.
  - If every file is gone, the deck holds what's on air and refuses the next take with "This folder has no photos or videos yet."
- **Stopping:** the session is dropped by a `mediaClear`, a `mediaTake` whose `owner` isn't its own, `clear_all_channels`, or another `start` on that channel. Graphics takes, through `slidesSession`/graphic takes, don't touch it.
- **Empty decks:** a take of an empty media-only deck fails with that same plain message.

- [ ] **Step 1: Write failing tests** with fake timers, a fake `channels`, and an injected live-folder source:
  - `advances images on their hold and wraps when looping`.
  - `non-looping deck holds the last slide and reports atEnd`.
  - `video with advanceOnEnd advances on ended, not on a timer`.
  - `preview take does not start the timer; promote starts it from the current slide`.
  - `manual step restarts the hold timer`.
  - `graphics take leaves the loop running`.
  - `media take stops the loop`.
  - `media clear stops the loop`.
  - `skips a slide whose file disappeared`.
  - `new folder file appears only after the wrap`.
  - `empty folder deck refuses to take`.
- [ ] **Step 2:** Run `npx vitest run server/src/mediaDeckSession.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the session, and branch in `takeSlides`.** A media-only deck goes to `mediaDeckSession.start`; template decks go to `slidesSession` unchanged. Hook `channels.mediaTake`/`mediaClear` so they drop a session not owned by the caller, and route the `slides_*` controls. Broadcast the summary through the same path `slidesSession` summaries use.
- [ ] **Step 4:** Run the new tests plus `npx vitest run server/src/slidesHandlers.test.ts server/src/slidesSession.test.ts server/src/channels`. Then run `pnpm -C server exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): media-only decks loop in the media slot and keep running under graphics`.

### Task 8: Auto-advance and loop for template decks

**Files:**
- Modify: `server/src/slidesSession.ts` (`Session`, `render` 51, `start` 78, `advance` 93, `goTo` 120, `dropAll` 165, `promote` 146), `server/src/slidesHandlers.ts`
- Test: `server/src/slidesSession.test.ts`

**Interfaces:**
- Consumes: Task 1 deck fields and the `SlidesSessionSummary` fields `nextAdvanceAt`, `loops` and `slot: "graphics"`.
- Produces: `StartArgs` gains `timing?: { holdSecs: (number | undefined)[]; loop: boolean }`, built in `takeSlides` from each resolved slide's `holdSec ?? deck.defaultHoldSec`.

- [ ] **Step 1: Write failing tests:**
  - `auto-advances on hold and wraps when loop`.
  - `non-looping deck stops at the last slide with atEnd`.
  - `no timer on preview; promote starts it`.
  - `dropAll cancels the timer`.
  - `manual goTo restarts the timer`.
  - `summary carries nextAdvanceAt and loops`.
- [ ] **Step 2:** Run `npx vitest run server/src/slidesSession.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use one timer per session, cleared in `end`/`dropAll`. Decks without `defaultHoldSec` and slides without a hold behave exactly as today.
- [ ] **Step 4:** Run the tests and the server `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): template decks can auto-advance and loop`.

### Task 9: Replacing a library file updates its uses

**Files:**
- Modify: `server/src/media.ts` (`saveMediaItem`)
- Create: `server/src/mediaRefs.ts`, `server/src/mediaRefs.test.ts`

**Interfaces:**
- Consumes: the shows registry (`saveShow`/`listShows`), the decks registry (`saveDeck`/`getDeck`), and Task 2.
- Produces: `rewriteMediaRefs(mediaItemId: string, assetUrl: string, mediaType): Promise<{ shows: number; decks: number }>`. It updates the stored `assetUrl` (and `mediaType`) on every row and deck slide with that `mediaItemId`, and saves through the normal registries so sync picks the change up.

- [ ] **Step 1: Write failing tests:**
  - `rewrites a show image row and a deck media slide that reference the item`.
  - `leaves rows referencing other items untouched`.
  - `does not change channel state already on air`.
- [ ] **Step 2:** Run `npx vitest run server/src/mediaRefs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call it from `saveMediaItem` only when `assetUrl` changed.
- [ ] **Step 4:** Run the tests and the server `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): replacing a library photo or video updates every show and deck using it`.

### Task 10: Bundles, publish and stage feed handle photo rows and media slides

**Files:**
- Modify: `packages/core/src/bundle.ts` (121, 305-337, 407), `server/src/bundleApply.ts` (234, 298), `server/src/stageFeed.ts` (108, 153), `server/src/publishRoute.ts` (92-99)
- Test: `packages/core/src/bundle.test.ts`, `server/src/bundleApply.test.ts`, `server/src/stageFeed.test.ts`

**Interfaces:**
- Produces:
  - `collectReferencedAssetFilenames` also walks image rows and, when given `decks`, every deck slide `media.assetUrl`. Its signature gains an optional `decks?: Deck[]`.
  - `rewriteShowAssetUrls` rewrites image rows.
  - Live-folder URLs (`/media-folders/...`) are never collected.

- [ ] **Step 1: Write failing tests:**
  - `collects an image row's asset`.
  - `collects deck media slide assets when decks are passed`.
  - `ignores /media-folders urls`.
  - `bundleApply retargets an image row url`.
  - `stage feed treats an image row like a video row`.
- [ ] **Step 2:** Run those test files. Expected: FAIL.
- [ ] **Step 3: Implement** the `case "media"` branches. Pass the referenced decks from `publishRoute`.
- [ ] **Step 4:** Run the tests and `tsc` for core and server. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bundle): photo rows and media slides travel in bundles and publish`.

### Task 11: Operator store and connection for media and live folders

**Files:**
- Modify: `apps/operator/src/lib/store.ts` (deck fields 107-116 and actions 454-480 as the template), `apps/operator/src/lib/useWs.ts` (115, 163, 166, 248)
- Create: `apps/operator/src/lib/mediaRequests.ts`, `apps/operator/src/lib/mediaRequests.test.ts`

**Interfaces:**
- Produces:
  - **Store:** `mediaItems: MediaItemMeta[]`, `setMediaItems`, `upsertMediaItem`, `liveFolderFiles: Record<string, { files: LiveFolderFile[]; configured: boolean }>`, `setLiveFolderFiles(id, files, configured)`.
  - **`mediaRequests.ts`:** `saveMediaItem(item)`, `deleteMediaItem(id)` and `restoreMediaItem(id)`, using `sendAndAwaitAck` from `lib/awaitAck.ts`. Also `setLiveFolderPath(id, path)` (HTTP PUT) and `requestLiveFolder(id)`.

- [ ] **Step 1: Write failing tests:**
  - `upsertMediaItem replaces by id and keeps sort by name`.
  - `setLiveFolderFiles stores files per folder`.
  - `saveMediaItem rejects when disconnected` (with a fake client).
- [ ] **Step 2:** Run `npx vitest run apps/operator/src/lib/mediaRequests.test.ts apps/operator/src/lib/store`. Expected: FAIL.
- [ ] **Step 3: Implement.** Send `list_media` on connect. Handle `media_list`, `media_item` and `live_folder_files`.
- [ ] **Step 4:** Run the tests and the operator `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): media library and live folder state`.

### Task 12: Operator Media area

**Files:**
- Create:
  - `apps/operator/src/app/media/page.tsx`, `apps/operator/src/app/media/libraryConfig.ts`, `apps/operator/src/app/media/libraryConfig.test.ts`.
  - `apps/operator/src/app/media/importMedia.ts` and `apps/operator/src/app/media/importMedia.test.ts`: pure mapping from an upload result to a `MediaItem` (id via the existing id helper, name from the file name, `mediaType` from the mime, width/height/duration when known).
  - `apps/operator/src/app/media/LiveFolderDialog.tsx`.
- Modify: `apps/operator/src/app/shell/areas.ts` (library destinations 32-39, `NO_SWITCHER` 91-100), `apps/operator/src/app/shell/areas.test.ts`

**Interfaces:**
- Consumes: Task 11 store and requests, `lib/uploadAsset.ts` (`uploadAsset`, `resolveAssetUrl`), Task 5 `pickFolder`, `LibraryList` from `@overlaysys/ui`, the existing toast pattern, and `lib/awaitAck.ts`.
- Produces: the `/media` route. A library grid with thumbnails (image: the asset URL; video: the existing `/api/assets/poster/:filename`; live folder: its first settled file, else a folder icon), a type badge, video duration, search, operator folders (`MediaItem.folder`), drag-and-drop or button import, rename, move to folder, and delete with a confirm that shows "Used by N" when N > 0. Plus "Add live folder": name it, choose the folder (desktop `pickFolder`; on a non-desktop console the button is disabled with "Choose the folder on the show computer"), and show "N photos and videos" from the live files.

- [ ] **Step 1: Write failing tests:**
  - `importMedia: png → image item, mp4 → video item, name without extension, safe id`.
  - `libraryConfig: delete confirm mentions usage when usedBy > 0; filters by type and folder`.
  - `areas: library destinations include /media after /slides, desktop and web`.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3: Implement the page** following `app/slides/page.tsx` and its `libraryConfig.ts`. Use the Lucide `Images` icon.
- [ ] **Step 4:** Run the tests and the operator `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): Media area — library, folders and live folders`.

### Task 13: Library picker, Media row form and design layers

**Files:**
- Create: `apps/operator/src/app/media/MediaPicker.tsx`, `apps/operator/src/app/media/pickerModel.ts`, `apps/operator/src/app/media/pickerModel.test.ts`
- Modify:
  - `apps/operator/src/app/shows/edit/forms/VideoItemForm.tsx`, renamed to `MediaItemForm.tsx` (image or video).
  - `forms/itemFormModel.ts:224`.
  - `apps/operator/src/app/components/VideoRowModal.tsx`, renamed to `MediaRowModal.tsx` (keep `VideoRowSaveArgs` → `MediaRowSaveArgs`).
  - `apps/operator/src/app/shows/edit/page.tsx` (472-474, 830).
  - The rundown "add row" menu (label "Media").
  - `packages/editor-kit/src/ImageInput.tsx:25`, `packages/editor-kit/src/VideoInput.tsx:23`, `packages/editor-kit/src/PropertyInspector.tsx` (231-260), `packages/editor-kit/src/FieldsPanel.tsx` (287, 316).
  - `apps/operator/src/app/design/edit/page.tsx` (667-668), `DesignerInspector.tsx` (116-131).

**Interfaces:**
- Consumes: Task 1 `ImageRow`/`VideoRow`/`MediaRef`, Task 11 store.
- Produces:
  - **`MediaPicker`:** `MediaPicker({ open, accept: "image" | "video" | "any", onPick: (ref: MediaRef & { name: string }) => void, onClose })`. It lists file items only; live folders are not pickable here.
  - **`ImageInput`/`VideoInput`:** gain an optional prop `onPickFromLibrary?: () => Promise<{ url: string } | null>`. When present, they show "From library", which sets the value to the picked `assetUrl`. `PropertyInspector`/`FieldsPanel` pass it through.
  - **`pickerModel.ts`:** `newMediaRowFromPick(ref, id): VideoRow | ImageRow`. Video picks become `kind: "video"` with `endAction: "hold"`, `mediaItemId` and `assetUrl`. Image picks become `kind: "media"`, `mediaType: "image"`.

- [ ] **Step 1: Write failing tests:**
  - `newMediaRowFromPick: video pick → kind "video", endAction "hold", mediaItemId set`.
  - `image pick → kind "media", mediaType "image", fit "cover"`.
  - `pickerModel filters by accept`.
  - `itemFormModel` prefills a video row's length from its library duration.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The form shows:
  - **Source:** library pick or upload; an upload also adds the file to the library through Task 12's `importMedia`.
  - **Video only:** Loop and Mute switches, volume, and end action (Hold last frame / Clear).
  - **Photo only:** fit.
  - **Both:** transitions.

  Rows show the library item's name.
- [ ] **Step 4:** Run the tests, and `tsc` for operator and editor-kit. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): Media rows take photos or videos from the library; designs can use library media`.

### Task 14: Photo rows on Live and the rundown

**Files:**
- Modify every `kind === "video"` site listed below so that a photo row (`kind === "media"`) behaves like a video row except where noted. Photos have no playback controls, duration or transport, and never "end".
  - `app/components/live/ItemBar.tsx:64,124,220`, `app/components/Rundown.tsx:59`, `app/shows/edit/ItemPreview.tsx:54`, `app/components/rundown/rundownModel.ts:50,54`, `app/hooks/useGlobalShortcuts.ts:116,220`, `app/components/live/ThumbStrip.tsx:215`.
  - `lib/liveKeys.ts:46`, `lib/onAir.ts:60`, `lib/stageMode.ts:10,54,141`, `lib/thumbClick.ts:218,314`, `lib/rowView.ts:123`, `lib/rowAirState.ts:92`.
- Test: the existing `*.test.ts` next to each `lib/` and `rundownModel` file.

**Interfaces:**
- Consumes: Task 6 `mediaRowTakeMessage`.
- Produces: `isMediaRow(row): row is VideoRow | ImageRow` in `apps/operator/src/lib/rowView.ts`, used at every site above.

- [ ] **Step 1: Write failing tests** in the existing test files, one per behaviour:
  - `onAir: an image row in the media slot is on air`.
  - `rowView: image row label/thumb from its asset`.
  - `rowAirState: image row never reports ended`.
  - `thumbClick: clicking an image row takes it to the media slot`.
  - `liveKeys: take key on an image row sends media_take`.
  - `stageMode: image row is a media item`.
- [ ] **Step 2:** Run `npx vitest run apps/operator/src/lib apps/operator/src/app/components/rundown`. Expected: FAIL.
- [ ] **Step 3: Implement** with `isMediaRow`. In the ItemBar, photo rows hide the transport, timeline and duration controls.
- [ ] **Step 4:** Run the tests and the operator `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): photo rows on Live and the rundown`.

### Task 15: Deck editor — media slides, timing, loop and live-folder decks; Live indicator

**Files:**
- Modify: `apps/operator/src/app/slides/edit/DeckEditor.tsx` (154), `apps/operator/src/app/slides/edit/deckDraftOps.ts` and its test, `apps/operator/src/app/slides/NewDeckDialog.tsx`, `apps/operator/src/lib/slidesLive.ts`, `apps/operator/src/lib/slidesRowView.ts` (94)
- Create: `apps/operator/src/app/slides/edit/folderDeckOps.ts`, `apps/operator/src/app/slides/edit/folderDeckOps.test.ts`

**Interfaces:**
- Consumes: Task 1 `nextFolderOrder` and `resolveFolderDeckSlides`, Task 11 `liveFolderFiles`, Task 13 `MediaPicker`, and Task 7/8 summary fields `nextAdvanceAt`, `loops` and `slot`.
- Produces:
  - **`deckDraftOps`:** `addMediaSlide(draft, ref)` (adds `{ id, data: {}, media: ref }`), `setSlideHold(draft, slideId, sec | undefined)`, `setDefaultHold(draft, sec | undefined)`, `setLoop(draft, on)`, `setAdvanceOnEnd(draft, slideId, on)`.
  - **`folderDeckOps`:** `moveFolderFile(order, from, to)` and `setFolderFileHold(order, file, sec | undefined)`.
- **Behaviour:**
  - **New deck:** "New deck" offers "From a live folder". It creates `{ liveFolderId, slides: [], defaultHoldSec: 8, loop: true }`.
  - **A folder deck's editor:** shows the resolved slides as draggable thumbnails (using `liveFolderFileUrl`), lets the operator set a per-graphic hold, and has no "add slide".
  - **Other machines:** where `configured` is false, it shows "These graphics are on the show computer" and allows editing order and holds by file name.
  - **Every deck:** gets a "Timing" section: auto-advance on/off with a default hold time, a per-slide hold, and on video media slides "Advance when the video ends". It also gets a "Loop" switch.
  - **Live:** shows "auto · loops" (or "auto") and a countdown to `nextAdvanceAt` on the slides row and in the ItemBar, using the server clock offset (`serverTimeOffsetMs`).

- [ ] **Step 1: Write failing tests:**
  - `addMediaSlide adds data {}`.
  - `setDefaultHold undefined turns auto-advance off`.
  - `moveFolderFile reorders and keeps per-file holds`.
  - `slidesRowView shows "auto · loops" when the summary loops`.
  - `countdown seconds from nextAdvanceAt with a server offset`.
- [ ] **Step 2:** Run those tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Save the folder order with `nextFolderOrder` whenever the operator reorders, so new files get a stable position.
- [ ] **Step 4:** Run the tests and the operator `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): decks with photos and videos, timing, loop and live folders`.

### Task 16: Companion knows Media rows and looping decks

**Files:**
- Modify: `packages/companion-module/src/config.ts` (18, 24), `actions.ts` (139-153, 194-200), `feedbacks.ts` (414, 713-733), `variables.ts` (112-117, 203), `labels.ts` (13), `presets.ts` (80-170)
- Test: `packages/companion-module/src/__tests__/*`

**Interfaces:**
- Consumes: Task 6 `media_take` fields, Task 7/8 summary fields.
- Produces:
  - `RowKind` includes `"media"`, labelled "Media". Video rows are also labelled "Media" in kind labels, with colour defaults unchanged.
  - Take actions work for photo rows.
  - The `slides_on_air` feedback and slides variables also cover media-slot decks (`slot: "media"`).
  - New variable `slides_next_in` gives the seconds until the next auto-advance, or empty.

- [ ] **Step 1: Write failing tests:**
  - `take on a photo row sends media_take with mediaType image`.
  - `kind label for photo and video rows is "Media"`.
  - `slides_on_air is true for a media-slot deck`.
  - `slides_next_in counts down from nextAdvanceAt`.
- [ ] **Step 2:** Run `npx vitest run packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(companion): Media rows and looping decks`.

### Task 17: Media panel on Live (user-approved addition)

**Files:**
- Create: `apps/operator/src/app/components/live/MediaPanel.tsx`, `apps/operator/src/app/components/live/mediaPanelModel.ts`, `apps/operator/src/app/components/live/mediaPanelModel.test.ts`
- Modify: the Live drawer/tab host that shows the hotcards panel (find where `HotcardsPanel` is mounted on Live and add a "Media" tab beside it); `server/src/mediaHandlers.ts` + `packages/ws-protocol/src/index.ts` (new client message `media_folder_take{ id, channel }`); `server/src/mediaDeckSession.ts` (start a folder loop without a show row)
- Test: `server/src/mediaDeckSession.test.ts`, `server/src/mediaHandlers` tests

**Interfaces:**
- Consumes: `MediaThumb`/`MediaCard` (apps/operator/src/app/media/MediaCard.tsx), store `mediaItems`/`liveFolderFiles`, `mediaRowTakeMessage` (ws-protocol), `mediaDeckSession.start`, `resolveFolderDeckSlides`.
- Produces:
  - `mediaPanelModel.ts`: `mediaItemTakeMessage(item: MediaItemMeta, channel: "preview" | "program"): ClientMessage` for file items — builds a `media_take` with `rowId: "media-item:<id>"`, photo → `mediaType "image"`, `fit "cover"`; video → `endAction "hold"`, `volume 1`, not muted, not looping (the Media row defaults). `filterPanelItems(items, query, folder)`.
  - Protocol `media_folder_take{ id: string; channel: string }`: the server starts a media-only folder loop on that channel with `rowId: "media-folder:<id>"`, `loop: true`, `defaultHoldSec: 8`, and the folder's saved order if a deck links that folder, else name order. Refused with "This folder has no photos or videos yet." when empty. Preview shows statically (existing preview rule).

**Behaviour (user-approved):** a "Media" tab beside hotcards on Live; same thumbnails/search/folders as the Media area; each item has **Cue** (to preview) and **Take** (to program) like hotcards; a photo holds until the next take; a video plays with sound and holds its last frame; taking anything else into the media slot replaces it; a live folder takes as a looping 8 s deck that keeps running under graphics; nothing changes the show.

- [ ] **Step 1: Write failing tests:** `mediaItemTakeMessage builds a photo take to preview and a video take to program with hold/sound defaults`; `filterPanelItems by query and folder`; server: `media_folder_take starts a looping folder deck with 8 s hold`, `media_folder_take on an empty folder is refused with the plain message`, `a graphics take leaves a panel-started loop running`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest run apps/operator server packages/ws-protocol` and tsc for operator, server, ws-protocol. Expected: PASS.
- [ ] **Step 5: Commit** `feat(live): Media panel — cue or take library photos, videos and live folders`.

### Task 18: Hotcard creation shows the template's fields (user-reported)

**Files:**
- Modify: `apps/operator/src/app/hotcards/edit/HotcardNewStep.tsx`, `apps/operator/src/app/hotcards/edit/page.tsx` (`create`, the template fetch effect so it also runs on the new step)
- Test: `apps/operator/src/app/hotcards/edit/hotcardDraft.test.ts` (or a new pure helper's test)

**Interfaces:**
- Produces: `NewHotcardValues` gains `data: Record<string, string>`; `create` saves it as the new hotcard's `data`.

**Behaviour:** the "New hotcard" step shows the picked template's fields (same field editor the hotcard editor uses), fetching the template when it isn't cached (local: `get_template`; cloud: `getTemplateCloud`), showing "Loading template…" until it arrives. Values typed there are saved with the new card. Changing the template keeps values for field keys the new template also declares and drops the rest. Fields are optional; Create still needs only a name and template.

- [ ] **Step 1: Write the failing test** for a pure helper `carryFieldValues(prev: Record<string,string>, fields: {key: string}[]): Record<string,string>` (keeps declared keys, drops others) and that `create` includes `data`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest run apps/operator` + operator tsc. Expected: PASS.
- [ ] **Step 5: Commit** `fix(hotcards): the New hotcard step shows and saves the template's fields`.
