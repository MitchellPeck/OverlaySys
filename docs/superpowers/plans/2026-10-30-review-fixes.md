# Review-pass fixes (server, desktop, renderer, companion, operator)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix every finding from the 2026-10-30 comprehensive review pass. Each task names the findings it owns, with file:line pointers taken from that review.

**Spec:** none. The findings below are the requirements. Each one came from a read-only review. Some are marked *plausible*, meaning nobody reproduced them.

## Global Constraints

- **Confirm before fixing.** Read the code and confirm the defect first. If a finding marked *plausible* turns out not to be a real defect, don't change anything for it; say so in the report, with the code that proves it.
- **TDD.** Write a failing test first for every behaviour change, wherever the code can be unit-tested. Tests use vitest and run from the repo root with `npx vitest run <path>`; the root `vitest.config.ts` holds the include globs. Follow the style of the neighbouring `*.test.ts` files.
- **Typecheck** every package you touch with `pnpm -C <pkg dir> exec tsc --noEmit`.
- Match the surrounding code: comment density, naming, idiom. Don't refactor or make improvements while you're in there; only fix what the finding describes.
- **Never stage or commit anything under `data/`.** Those are live user records, modified by running the app. Stage files by explicit path, never with `git add -A` or `git add .`.
- **One commit per task** (or a few small ones), message style `fix(<area>): <what now works>`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Operator-facing copy is plain language, short, with no raw error dumps.
- **Local-only means local-only.** The server's existing local-only gate (the `security.ts` / LAN-token checks) must not be loosened.

---

### Task 1: Server — record ids can't escape their directory

Findings:
- **S1:** `server/src/decksStore.ts:41`, with `slidesHandlers.ts:144` and `ws.ts:1146`. `deck.id` goes into a file path unchecked, and `DeckSchema` is `.passthrough()`. A LAN client sends `save_deck` with `id: "../stt/config"`, which writes `data/stt/config.json` containing a `customCommand`. A remote `stt_spawner_start` then runs it through `bash -c`.
- **S2:** `server/src/storage.ts:194/232/265/298/319`. The save paths for templates, shows, channels, songs and hotcards build file paths from ids that are never validated. Projects have the same problem if they are file-backed; check.

Requirements:
- One shared guard, for example `assertSafeId(id)` or a zod refinement, used by every file-backed save, get and delete in the server. It rejects empty ids, ids containing `/` or `\`, ids that are `.` or `..` or start with `.`, and NUL.
- Allowed characters: check what ids the app actually generates (`template-49ff73b5`, `be-thou-my-vision`, `show-0a59dfb3`, `alpha-program`, uuids) and allow a superset of those. Use `[A-Za-z0-9_-]` plus the extra characters existing data needs; grep `data/` read-only to confirm.
- A rejected id reaches a WS client as the existing `error` message, or a 400 on HTTP.
- As defence in depth, the resolved path must stay inside its directory: check `path.resolve(dir, id + ".json")` starts with `dir + path.sep`.
- Separately, the STT spawner must not run a `customCommand` that came from a file a remote client could write. Confirm that S1's guard closes this path. If another write path into `data/stt/` exists, close it too.
- Tests: traversal ids are rejected for decks and at least two other entity types, and ordinary ids still save.

### Task 2: Server — `/api/import` validates the bundle

Finding:
- **S3:** `server/src/importRoute.ts:71-140`. `/api/import` casts the body to its type and saves projects, templates, songs, shows and hotcards with no schema parse. A malformed template (for example one with no `layers`) gets into the registries and is broadcast.

Requirements:
- Parse the body with `BundleSchema` from `@overlaysys/core`, or the per-entity schemas, before saving anything.
- An invalid bundle gets a 400 with a short error and saves nothing.
- Ids pass the Task 1 guard.
- Tests: a malformed bundle is rejected and nothing is written; a valid bundle still imports.

### Task 3: Server — asset writes are atomic and cleaned up; the raw PUT can't plant content

Findings:
- **S5:** `server/src/assets.ts:206-208`. ffmpeg writes straight to the final content-addressed path. A crash leaves a partial `<sha>.mp4` that later uploads reuse. The static route can serve a half-written file. Two uploads of the same file encode to one path at the same time.
- **S6:** `server/src/assets.ts:159-168`. When an upload aborts or errors, the `.tmp-*` file is closed but never deleted.
- **S9:** `server/src/assets.ts:334-370` and `bundleApply.ts:322`. The raw PUT trusts the hash the caller gives, writes without an atomic rename, and accepts a 1 GB base64 JSON body. Any client can put an `.svg` containing script under some hash, and it is served from the operator's origin.

Requirements:
- ffmpeg encodes to a temp file in the same directory, then `rename` to the final path only on success; on failure the temp file is deleted. Concurrent encodes of the same source share one in-flight promise, or write unique temp files where the last rename wins and the content is identical.
- An aborted or errored upload deletes its `.tmp-*` file.
- Raw PUT: compute sha256 of the decoded bytes and reject with 400 when it doesn't match the hash in the filename. Write atomically (temp file, then rename).
- Raw PUT body limit: lower it to a sane value of your choosing, ≥ the largest asset the bundle export produces. Check the export side and document the number.
- SVG: serve `.svg` assets with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:` and `X-Content-Type-Options: nosniff`, so a script in an SVG can't run when the SVG is opened directly. `<img>` rendering is unaffected.
- Tests: hash mismatch is rejected; the temp file is removed after a simulated failure (mock the encoder, don't spawn ffmpeg); SVG responses carry the CSP header.

### Task 4: Server — WS subscription leaks and the post-close subscribe

Findings:
- **S4:** `server/src/ws.ts:1149-1155, 1307-1308`. `stt_match_subscribe` and `stt_levels_subscribe` add a new per-message `send` wrapper each time. Neither `on:false` nor socket close removes it, so unsubscribe does nothing, re-subscribing duplicates messages, and dead sockets' closures pile up.
- **S7:** `server/src/ws.ts:347-378`. `subscribe` has no `closed` guard (`stage_layout_preview` has one). A subscribe still queued when the socket closes calls `outputs.addOutput` for a renderer that never gets removed.

Requirements:
- Each connection keeps one stable callback per stream. `on:false` removes it, and socket close removes it.
- `subscribe` returns early when the connection has already closed, mirroring `stage_layout_preview`.
- Tests: subscribe twice, then unsubscribe, leaves zero subscribers. Close removes subscribers. A subscribe that resolves after close adds no output.

### Task 5: Server — channel grace timer, unhandled rejections, test script

Findings:
- **S8:** `server/src/channels.ts:324-330`. The 1.5 s grace timer after a clear checks only `phase==="out"`, not which take it belongs to. Clear A, then take and clear B within 1.5 s, and A's timer nulls B early.
- **S10:** `server/src/index.ts`. There is no `unhandledRejection` handler, and several `void` promises have no `.catch`: `channels.ts:251/505` (`maybeScheduleAutoOut`) and `ws.ts:304-308`.
- `pnpm -C server test` prints "No test files found" and exits 1, because the root vitest include globs are relative to the repo root.

Requirements:
- The grace timer only clears when the state is still the same take it was armed for. Compare `takenAt` or an equivalent token.
- Add `.catch` logging to the listed `void` promises.
- Add a `process.on("unhandledRejection")` handler in the server entry that logs and does not exit.
- Fix the server `test` script so it runs the server's tests, for example `vitest run --root ../ server/src` or an equivalent that works. Verify by running it.
- Tests: the A/B grace race (fake timers).

### Task 6: Desktop — navigation, window-open and external-link hardening

Findings:
- **D1:** `apps/desktop/src/main.ts:844-900`. The operator window has no `will-navigate` guard and the preload attaches to whatever page it loads. The plain `<a href={PORTAL}>` in `apps/operator/src/app/account/page.tsx:108` navigates the main window to apps.mitchellpeck.com. The console is lost, and the remote page gets `window.overlaysys`, including `cloudGetTokens()`.
- **D2:** `main.ts:893-900`. `setWindowOpenHandler`'s same-origin test is a string `startsWith`, so `http://127.0.0.1:4000@evil.com` passes. Every other URL goes to `shell.openExternal` with no scheme check, so `file:` and `smb:` get through.
- **D4:** `main.ts:1404` with `decklink/host.ts:75,172`. `set-decklink-ffmpeg-path` accepts any path and then runs it.

Requirements:
- A `will-navigate` handler on the operator window, and on any window that has the preload, allows only the operator's own origin and calls `preventDefault` on everything else. http(s) targets open externally instead.
- The same-origin test compares `new URL(x).origin` exactly.
- External opens, from the window-open handler and from `will-navigate`, are allowed only for `https:`, `http:` and `mailto:`. Reuse the scheme rule the `overlaysys:open-external` IPC handler (line ~1604) already applies, if it has one; otherwise share one helper between them.
- Operator `account/page.tsx:108`: the portal link opens externally. Use the same mechanism other external links in the operator use (grep `openExternal` / `target="_blank"`).
- ffmpeg path: accept only an absolute path to an existing regular file whose basename starts with `ffmpeg`, with `~` expanded. Reject anything else with a plain-language error back to the operator.
- Put the pure checks (origin compare, scheme allowlist, ffmpeg path validation) in electron-free modules with unit tests.

### Task 7: Companion — `stop()` while connecting doesn't crash the module

Finding:
- **D3:** `packages/companion-module/src/connection.ts:63-66`. `stop()` calls `removeAllListeners()` and then `ws.close()`. On a socket that is still connecting, `ws` emits `error` with no listener, which throws an uncaught exception. Confirmed with the installed `ws` ("WebSocket was closed before the connection was established").

Requirements:
- After stopping, keep a no-op `error` listener on the socket, or terminate it in a way that doesn't emit. Pending reconnect timers are cleared.
- Test: start against a port with nothing listening, call stop immediately, and no uncaught error occurs.

### Task 8: Desktop — DeckLink reopen after a fatal error; channel auto-reload recovers later

Findings:
- **D5:** `apps/desktop/src/decklink/output.ts:232-235` with `host.ts:125,197`. After a non-retryable failure (`ffmpeg-not-found` or `no-decklink`) the channel stays in `running` with its offscreen window still rendering. After the operator fixes the ffmpeg path and reopens, `reconcile` sees the same device and format and returns early, so nothing restarts.
- **D8:** `main.ts:816-831` (`attachAutoReload`). After 3 failures in 60 s it gives up for good and never retries.

Requirements:
- A non-retryable failure moves the output to a stopped or failed state that `reconcile` treats as "needs (re)start". The offscreen window is closed or paused, and the operator is told the output closed; check the existing `notify` events.
- Changing the ffmpeg path setting causes failed outputs to retry.
- `attachAutoReload`: after the burst limit, retry later with a back-off, using `respawnDelayMs()` from `supervisor.ts` or similar, instead of giving up for good. Burst protection is kept.
- Tests on the electron-free parts: the state transitions in `output.ts`/`host.ts` reconcile, and the back-off schedule.

### Task 9: Renderer — mount failures and listener isolation

Findings:
- **D6:** `apps/renderer/src/channelPlayer.ts:156` (also `:110`, `:134`). `deps.mount` and `m.update` aren't wrapped, and `mountTemplate` appends `root` before building the timeline. A template with bad tracks throws, leaves a hidden orphan root, and `void player.apply()` becomes an unhandled rejection.
- **D7:** `apps/renderer/src/wsClient.ts:85-95`. Listener dispatch shares the try/catch with decoding. If one listener throws, the error is logged as a decode failure and later listeners never get the message.

Requirements:
- If mount or update fails, the partial root is removed from the stage, the error is logged with the template id, and the player stays usable for the next state.
- `player.apply()` callers catch.
- Decode errors and listener errors are handled separately. Every listener is called even when an earlier one throws, and each listener error is logged as a listener error.
- Tests for both.

### Task 10: Operator — keyboard handling: designers behind dialogs, Live Enter/Space

Findings:
- **O1:** `apps/operator/src/app/design/edit/page.tsx:329` and `app/design/stage/edit/page.tsx:421`. The keydown handlers skip text fields but not open dialogs, and the Modal only stops Esc, Enter and Tab. With the Revert or Delete confirm open, Backspace deletes the selected layers behind it; ⌘Z, ⌘D and Space also act on the canvas.
- **O6:** `apps/operator/src/hooks/useGlobalShortcuts.ts:195`. Only text fields are exempt, so Enter on a focused button calls preventDefault and cues preview; the button never fires.

Requirements:
- One shared helper, for example `isShortcutBlocked(event)`. It returns true when the event target is inside an open modal or dialog (`[role="dialog"]` / `aria-modal`, or the Modal's own marker), or when the target is a text field. The designers use it.
- Live global shortcuts don't take Enter or Space when the focused element is a button, link, `[role="button"]`, checkbox, select or summary.
- Tests: helper unit tests (jsdom, if the operator tests already use it; check).

### Task 11: Operator — command-palette navigation respects the unsaved-changes guard

Finding:
- **O2:** `apps/operator/src/app/shell/CommandPalette.tsx:53,120`. ⌘⇧L and ⌘K navigate with `router.push`, but `useUnsavedGuard` only catches link clicks, Back/Forward and unload, so unsaved show edits are lost silently.

Requirements:
- All programmatic navigation from the palette and its shortcuts goes through the guard and shows the same confirm a link click does.
- Find how `useUnsavedGuard` exposes its state and add a guarded navigate function next to it. Use it in the palette and in any other `router.push` call driven by a global shortcut (grep).
- Test the guarded navigate function.

### Task 12: Operator — Modal backdrop close

Finding:
- **O3:** `packages/ui/src/Modal.tsx:223`. `closeOnBackdrop` defaults to true, and the handler doesn't check where the press started. Dragging a text selection out of a field, or a stray click, closes VideoRowModal, ArrangementModal, ScriptureRowModal or ImportFromFileModal and throws away the work.

Requirements:
- Close on backdrop only when both the mousedown/pointerdown and the click happen on the backdrop itself.
- The four editing modals named above pass `closeOnBackdrop={false}`. Keep the default for simple informational modals.
- Test the press-origin rule.

### Task 13: Operator — editors that never finish loading or keep stale state

Findings:
- **O4:** `shows/edit/page.tsx:652` and `hotcards/edit/page.tsx:331` don't handle not_found or a load failure, so a deleted or bookmarked id shows "Loading show…" forever. The song, design, stage and deck editors handle it.
- **O5:** `design/edit/page.tsx:474-490`. Revert clears the draft, marks it as fetched, and the fetch is dropped. On reconnect the load effect skips it, so the page sits on "Loading template…" until a full reload.
- **O8** (*plausible*): `songs/edit/page.tsx:53-90` doesn't reset when the id changes. ⌘K from song A to song B shows A's lyrics under B's URL, and "Undo paste" restores A.

Requirements:
- Shows and hotcards: the same not-found and failed states the song editor uses (copy its pattern). Not-found offers a way back to the list.
- Revert: when the fetch can't go out or is dropped, the template is not left marked as fetched, so the reconnect load retries.
- Songs: when the id changes, the editor state (draft, undo stack, paste-undo) resets and the new song loads.

### Task 14: Operator — failures that are silent today

Findings:
- **O7:** `projects/page.tsx:215,239,248-250`. Project save, rename and delete are fire-and-forget `send` calls. Delete switches the current project even if it failed, and a rename while reconnecting silently does nothing.
- **O10** (*plausible*): `design/edit/page.tsx:173-179`. While a save is in flight, any `error` message is treated as that save failing.
- **O12:** `shows/page.tsx:137-146`. Show Export returns silently when disconnected, or after a 2 s timeout.

Requirements:
- Projects: when disconnected, the action is refused with a toast. Delete switches the current project only after the server confirms the delete; if the server sends no ack, check `ws-protocol` for the list broadcast that follows and use that. Failures toast.
- Template save: an `error` counts as this save failing only when it correlates with this request. Use the request id or template id if the protocol carries one; check `ws-protocol` first. If nothing correlates, use the narrowest rule available, such as an error that names this template's id.
- Show export: toast when disconnected and on timeout.

### Task 15: Operator — remaining races and clock skew

Findings:
- **O9** (*plausible*): `TimerPanel.tsx:168` and `ActiveTimersPanel.tsx:138` anchor graphic timers on local `Date.now()` and ignore `serverTimeOffsetMs`, which the stage timers do use. A laptop whose clock is 20 s off puts the on-air countdown 20 s off.
- **O11** (*plausible*): `data/ImportPreview.tsx:176-212`. A slow earlier file read can finish after a later pick, so the wrong preview wins.
- **O13** (*plausible*): `live/ItemBar.tsx:246` and `useGlobalShortcuts.ts:89`. Take or an F-key on a hotcard that isn't cached only requests the card, so the first press does nothing.
- **Side note:** `lib/useWs.ts` adopts any `show` message as the Live show when Live has none loaded, so an export, an editor fetch, or "move unassigned" can quietly set which show Live loads.

Requirements:
- Timers: use the same server-offset clock the stage timers use.
- Import preview: drop the result of any read that isn't the latest pick (a token or counter).
- Hotcard: a take or F-key on an uncached card requests it and then takes it when it arrives, but only if no other take has happened since.
- `useWs`: adopt a `show` as the Live show only when Live itself asked for that show (track the pending request id).
- Tests wherever the logic is extractable.
