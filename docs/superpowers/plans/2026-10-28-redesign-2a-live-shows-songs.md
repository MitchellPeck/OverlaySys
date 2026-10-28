# Redesign 2a: Live, show editor and song editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Live screen (spec option B), the show editor and the song editor in the new look, and fold in the functional fixes from FIX-PLAN workstreams WS1–WS4.

**Architecture:** Each screen keeps its logic in pure helpers under `apps/operator/src/lib` (or next to the editor), with Vitest tests. The React components only render what those helpers return. Live and the show editor share one sectioned rundown list (`components/rundown/*`), and every row is described by one view model (`rowView`). The thumbnail strip is driven by `thumbsFor` and `thumbActivate`. The song editor is built from reusable slide pieces (`songs/edit/slides/*`) that plan 3 imports for Slides decks. Server protocol, `wsClient` and `packages/ws-protocol` don't change.

**Tech Stack:** Next.js 15 / React 19 operator, zustand store, zod schemas in `@overlaysys/core`, `@overlaysys/ui` kit (plan 1), lucide-react icons, Vitest (node env, logic only), Playwright screenshots with `uxreview/lib.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md`. Shared names: `docs/superpowers/plans/2026-10-28-redesign-contracts.md` (this plan owns §9 and §10). Execution order, cross-plan dependencies and file ownership: `docs/superpowers/plans/2026-10-28-redesign-execution-order.md`. Functional tasks folded in: session scratchpad `uxreview/FIX-PLAN.md` WS1–WS4 and section 3 decisions.

## Global Constraints

- Palette and tokens come only from `@overlaysys/ui` `colors.*` / CSS vars (contracts §1): `--bg #1b1b1d`, `--surface #202022`, `--surface-2 #242426`, `--control #3a3a3e`, `--border #333336`, `--text #e8e8ea`, `--text-dim #aaaab0`, `--text-muted #98989e`, `--accent #4f7cff` (alias of `--brand`), `--onair #e5484d`, `--ok #30a46c`, `--warn #f5b942`. Don't add new hard-coded colours, except the section-kind chip palette in Task 19, which is tested for contrast.
- Colour carries meaning only. Red (`onair`) is program / on air and any action that changes Program (D5). Green (`ok`) is preview / next. Blue (`accent`) is selection and primary actions. Kind colours come from `kindColor` (graphic `#60a5fa`, song `#f5b942`, slides `#34d399`, scripture `#f472b6`, video `#a78bfa`, section `#8e8e94`).
- Density: UI text is 11–13 px. Rundown rows are two lines at most. Hit targets are ≥ 24 px, icon buttons ≥ 28 px, and every icon-only button has an `aria-label` that names its object ("Delete Verse 1").
- Use only the plan 1 controls (contracts §2): `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `NumberInput`, `SegmentedControl`, `Switch`, `Checkbox`, `FileDrop`, `Menu`/`useContextMenu`, `useConfirm`, `useToast`, `Tooltip`, `KindBar`, `SaveBar`, `OfflineState`. Use plan 1's operator helpers (contracts §7): `sendAndAwaitAck`/`ackErrorText` (`lib/awaitAck.ts`), `useConnection`, `templatesFor`/`templateRole` (`lib/templateRoles.ts`), `exportFileName`, `formatDuration`. Don't use `window.confirm`, browser-default buttons or checkboxes, emoji or text glyphs as icons (use lucide).
- Copy is in sentence case and uses the D11 glossary: Cue / Take / Clear; "show" for the document and "rundown" for its list; "template"; "Sermon notes"; "Auto-advance (STT)"; the Live page title is "Live".
- Save model on every editor: `SaveBar` (unsaved dot, Revert, Save ⌘S), the existing `useUnsavedGuard`, and save confirmed by server ack before `dirty` clears.
- Data is additive. A show or song re-saved by these editors keeps every key it didn't touch (spread the loaded object; never rebuild it from known fields). `sections`/`sectionId` and unknown row kinds survive a round trip.
- Cue never reaches Program. Any Cue (button, Enter, double-click, thumbnail click on a non-live item, hotcard) targets `"preview"` (controller addition, Task 1).
- Never type real song lyrics. Use placeholders such as "Line one of verse one".
- Don't change `packages/ws-protocol`, `server/**`, `apps/operator/src/lib/wsClient.ts` or `lib/store.ts`. Slides rows reach this plan's code only through the adapter `lib/slidesRowView.ts` (contracts §9).
- Cloud build: the Live page keeps redirecting to `/shows` in cloud mode, and the show and song editors keep their cloud load/save paths (`getSongCloud`, `saveSongCloud`, and so on). `pnpm --filter operator build:cloud` must pass.
- Verification for every UI task: `pnpm typecheck`, `pnpm --filter operator build`, and the named screenshot with `uxreview/lib.mjs` at 1280×800, 1440×900 and 1920×1080, saved as `shots/after/2a/<name>.png`. Operator runs at :3000, renderer at :3001, server at :4000. Use preview or a test channel, not Program, unless the task is about Program.
- Tasks that carry a FIX-PLAN default decision say `[Dn]` and stay in their own commit so they can be reverted.

## Review Focus

1. **A different song is live while the operator clicks a slide of the selected song.** The click must cue the selected song to PVW at that slide, and must never move the live program session. Test: Task 4, `thumbActivate › song not live while another song is on program cues preview only`.
2. **Repeated sections (Chorus ×3).** Clicking the third chorus thumbnail of a live song lands on that occurrence, not the first. Test: Task 4, `thumbActivate › repeated chorus lands on the clicked occurrence`.
3. **A row whose `sectionId` names no existing section** (deleted on another machine, or a bad import). It must still render and count toward totals, never disappear. Test: Task 3, `liveGroups › rows with an unknown sectionId stay visible in the no-section group`.
4. **Save while the connection drops or the server never answers.** The editor must stay "Unsaved" and toast the reason. Test: P1.6, `awaitAck.test.ts › rejects with not_connected / timeout / disconnected` (plan 1 owns `sendAndAwaitAck`). Both editors use it (Tasks 17 and 20), and each task's screenshot step checks the offline save.
5. **A live song edited and saved mid-service** (sections removed or renamed, so the live session's arrangement points at ids that no longer exist). Thumbnails come from the session's own arrangement. A click on a slide whose section is gone sends nothing and says so, and never sends a jump to the wrong section. Test: Task 4, `thumbActivate › stale live arrangement falls back safely`.

---

## File Structure

Plan 2a owns exactly these files. Files marked ★ were not in the prompt's list but are owned by no other plan. They are claimed here and listed again under "Contract changes".

**Live: page, components, hooks**
- Modify `apps/operator/src/app/page.tsx`: Live layout (rundown | air zone + strip | drawer).
- Modify `apps/operator/src/app/components/Monitors.tsx`: fixed-size PVW/PGM with tally ring.
- Modify `apps/operator/src/app/components/OnAirStrip.tsx`: rewritten to export `AirControls` (vertical strip) and `MonitorCaption`.
- Modify `apps/operator/src/app/components/ChannelPreview.tsx`: BLANKED overlay, `emptyLabel`, IN… chip.
- Modify `apps/operator/src/app/components/Rundown.tsx`: Live wrapper around `RundownList`.
- Create `apps/operator/src/app/components/rundown/RundownList.tsx`, `RundownRow.tsx`, `SectionDivider.tsx`: shared by Live and the show editor.
- Create `apps/operator/src/app/components/live/ThumbStrip.tsx`, `ItemBar.tsx`, `LiveDrawer.tsx`.
- Modify `apps/operator/src/app/components/StageArea.tsx`: becomes the "selected item" region (ItemBar + ThumbStrip + item controls).
- Modify `apps/operator/src/app/components/SongModePanel.tsx`: reduced to `SongLiveBar` (title, Blank, End song, Auto-advance (STT), STT strip); the slide grid is removed.
- Modify `SongTakeStrip.tsx`, `ScriptureTakeStrip.tsx`, `TakePanel.tsx`, `MediaTransportStrip.tsx`, `ConsoleBottomBar.tsx`, `ChannelDots.tsx`, `ChannelWindowSettingsPopover.tsx` (restyle only), `TimersRail.tsx`, `TimerPanel.tsx`, `StageTimersSection.tsx`, `ActiveTimersPanel.tsx`, `StagePanel.tsx`, `ShowPicker.tsx`, `HotcardsPanel.tsx` (all in `apps/operator/src/app/components/`).
- Modify (show editor row editors) `ScriptureRowModal.tsx`, `ScriptureSlideEditor.tsx`, `ScriptureIntroEditor.tsx`, `VideoRowModal.tsx`, `VideoThumb.tsx` (all in `apps/operator/src/app/components/`).
- Modify `apps/operator/src/app/hooks/useGlobalShortcuts.ts`; create `apps/operator/src/app/hooks/useLivePrefs.ts` (drawer open state, double-click setting). `useTakeFeedback.ts` is unchanged.
- `AnchoredPopover.tsx` is **not** owned (the shell uses it); 2a imports it only.

**Live and editor logic (`apps/operator/src/lib`)**
- Modify `onAir.ts`, `shortcutGuards.ts`, `songNav.ts`, `rowAirState.ts`, `rowData.ts`, `stageMode.ts`, `mediaTime.ts`, `mediaTake.ts`, `rowLength.ts`, `notesImport.ts`, `slideBreaks.ts` (no API change), ★`songChannel.ts`, ★`channelDotModel.ts`, each with its `*.test.ts`. (P3.8 first adds a one-line `case "slides"` placeholder to `onAir.ts`, `rowAirState.ts`, `stageMode.ts` and `components/StageArea.tsx`; the tasks here keep those cases and route them through the adapter.)
- Create ★`airRoute.ts`, ★`rowView.ts`, ★`liveNext.ts`, ★`thumbClick.ts`, ★`textOverflow.ts`, ★`liveCommands.ts`, each with its test. Also ★`slidesRowView.ts`, the slides adapter with stub bodies (contracts §9), whose ownership passes to plan 3 at P3.13. (`awaitAck.ts`, `useConnection.ts` and `templateRoles.ts` are plan 1's, P1.6 and P1.8.)

**Show editor** (`apps/operator/src/app/shows/edit/`)
- Modify `page.tsx`, `ArrangementModal.tsx`, `SermonNotesEditor.tsx`, `SongOverrideEditor.tsx`, `SongsInShowPanel.tsx`.
- Create `showEditOps.ts` (+test), `songPicker.ts` (+test), `ShowHeader.tsx`, `ShowDetailsPane.tsx`, `ItemPreview.tsx`, `SongPickerDialog.tsx`, `TemplateSelect.tsx`, `forms/GraphicItemForm.tsx`, `forms/SongItemForm.tsx`, `forms/ScriptureItemForm.tsx`, `forms/VideoItemForm.tsx`, `forms/ItemCommonFields.tsx`, and `forms/SlidesItemForm.tsx` (`SlidesItemForm` + `SlidesAddFlow` placeholders, contracts §9; ownership passes to plan 3 at P3.16).

**Song editor** (`apps/operator/src/app/songs/`)
- Modify `edit/page.tsx`, `edit/SongDraftEditor.tsx`, `edit/FieldMappingTable.tsx`, `edit/songDraftOps.ts` (+test).
- Create `edit/ArrangementChips.tsx`, `edit/SectionsList.tsx`, `edit/SongDetails.tsx`.
- Create the reusable deck-mode pieces (contracts §9): `edit/slides/EditorFrame.tsx`, `edit/slides/SlideThumbGrid.tsx`, `edit/slides/SlideTextEditor.tsx`, `edit/slides/slideFields.ts` (+test), `edit/slides/sectionColors.ts` (+test), `edit/slides/index.ts`.
- Modify `PasteLyricsModal.tsx`, ★`pasteLyrics.ts` (+test), ★`ImportFromFileModal.tsx`, ★`songImport.ts` (+test).

**Core song parsers** (`packages/core/src/`)
- Modify `songParser.ts`, `sectionEmit.ts`, `parsePlainLyrics.ts`, `songSelectParser.ts` (+tests).
- Create `chordPro.ts` (+`chordPro.test.ts`).
- Modify ★`sermonNotes.ts` (+test).
- Modify `index.ts`: append one export line only (shared, append-only; execution-order doc).

**Not touched (other plans):** `packages/ui/**`, list pages (`shows/page.tsx`, `songs/page.tsx`, …), `packages/core/src/show.ts`, `sections.ts`, `template.ts`, `hotcard.ts`, `lib/thumbnails/**`, designers, settings, shell, `hotcards/edit`, `pco`, `data`, companion, `packages/editor-kit/**`, decks, sync.

### Plan 1 dependencies (marked on tasks)

- **[P1-tokens]** contracts §1 (`colors`, `kindColor`, `ItemKind`) — P1.1
- **[P1-controls]** contracts §2 — P1.2–P1.7 (save kit, `useConnection`, `sendAndAwaitAck`: P1.6)
- **[P1-helpers]** contracts §7 — `templatesFor` (P1.8), `exportFileName`/`listFormat` (P1.11)
- **[P1-list]** contracts §3 `LibraryList`
- **[P1-sections]** contracts §4 (`ShowSection`, `Show.sections`, `RundownRow.sectionId`, `groupRowsBySection`, `orderRowsBySection`, `moveRow`, `insertRow`, `addSection` → `{ show, section }`, `renameSection`, `deleteSection`, `moveSection`, `sectionLength`) — P1.17, P1.18
- **[P1-thumb]** contracts §5 `TemplateThumbnail` — P1.10
- **[P3-core]** contracts §6 types (`Deck`, `SlidesRowView`, `ResolvedSlide`) — P3.1; `SlidesRow` in the union — P3.8

### Parallel groups

- **Group A, pure logic, no plan 1 dependency (start at once, all in parallel):** Tasks 1, 5 (rowLength part only), 7, 9, 10. Task 8 after Task 7 and P1.11.
- **Group A′, after P3.1 and P3.8** (the adapter imports core slides types; P3.8's placeholder lines in `onAir.ts`/`rowAirState.ts`/`stageMode.ts` land first): Task 2.
- **Group B, needs P1-sections/P1-tokens types only:** Task 3 (after 1, 2), Task 4 (after 1 and 3), Task 5 (show ops, after P1-sections).
- Task 6 is moved to plan 1 (P1.6, P1.8).
- **Group C, UI, needs P1-controls + P1-tokens (+P1-thumb where noted):**
  - Live: Tasks 11, 12, 13 (after 19), 14, 15 can run in parallel once Group A/B are done. Task 16 assembles them.
  - Show editor: 17 → 18.
  - Song editor: 19 → 20; Task 21 in parallel with 20.
- Live (11–16), show editor (17–18) and song editor (19–21) touch disjoint files and can run in parallel. Task 22 (stage screens) follows 15 and 18 and P2b.33. 17 imports 11's `RundownList`, so 17 starts after 11.

---

### Task 1: Cue always targets preview for rundown rows (controller addition)

**Files:**
- Create: `apps/operator/src/lib/airRoute.ts`, `apps/operator/src/lib/airRoute.test.ts`
- Modify: `apps/operator/src/lib/rowData.ts:33-45` (`graphicRowMessage`), `apps/operator/src/lib/songChannel.ts:30-33` (`songCueChannel`), `apps/operator/src/app/components/StageArea.tsx:93-100` (hotcard message → `hotcardMessage` from `shortcutGuards`)
- Test: `apps/operator/src/lib/rowData.test.ts`, `apps/operator/src/lib/songChannel.test.ts`

**Interfaces:**
- Consumes: `hotcardRoute(hint, action)` from `@overlaysys/core` (`packages/core/src/hotcard.ts:125`).
- Produces: `cueTakeRoute(hint: string | undefined, action: "cue" | "take"): string` (same rule as `hotcardRoute`: cue → `"preview"`; take → `hint` unless it's missing, `"preview"` or `"program"`, in which case `"program"`). `graphicRowMessage(row, "cue", …)` now always has `channel: "preview"`. `songCueChannel(...)` always returns `"preview"`. Later tasks route every row Cue through these two functions.

- [ ] **Step 1: Write failing tests**

```ts
// airRoute.test.ts
it.each([
  [undefined, "cue", "preview"], ["program", "cue", "preview"], ["preview", "cue", "preview"], ["stage-1", "cue", "preview"],
  [undefined, "take", "program"], ["program", "take", "program"], ["preview", "take", "program"], ["stage-1", "take", "stage-1"],
])("cueTakeRoute(%s, %s) → %s", (hint, action, want) => expect(cueTakeRoute(hint, action as "cue" | "take")).toBe(want));

// rowData.test.ts
it("a graphic row hinted to program cues on preview", () => {
  const row = { kind: "graphic", id: "r", templateId: "t", data: { title: "A" }, channelHint: "program" } as GraphicRow;
  expect(graphicRowMessage(row, "cue", {}, "s")).toMatchObject({ type: "cue", channel: "preview" });
  expect(graphicRowMessage(row, "take", {}, "s")).toMatchObject({ type: "take", channel: "program" });
});
it("a graphic row hinted to another output takes there but still cues on preview", () => { /* hint "stage-1": cue→preview, take→stage-1 */ });

// songChannel.test.ts
it("songCueChannel is preview even when the song routes to another output", () => {
  /* row.channelHint = "lyrics-out" → songCueChannel === "preview"; songTakeChannel === "lyrics-out" */
});
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/airRoute.test.ts apps/operator/src/lib/rowData.test.ts apps/operator/src/lib/songChannel.test.ts`. Expected: FAIL (`cueTakeRoute` is not defined, and the cue channel is `"program"` / `"lyrics-out"`).
- [ ] **Step 3: Implement.** `airRoute.ts` re-exports core `hotcardRoute` as `cueTakeRoute`, so there is one rule. `graphicRowMessage` uses `cueTakeRoute(row.channelHint, type)`. `songCueChannel` returns `"preview"` (update its doc comment: "a cue never goes live, whatever the routing"). In `StageArea`, the hotcard path uses the existing `hotcardMessage` from `shortcutGuards.ts`, not `h.channelHint ?? target`. Scripture rows have no Cue today; the thumbnail cue for scripture is built in Task 4 with `channel: "preview"`. Video has no PVW stage (`mediaTake.ts:4`), so it has no cue path to fix.
- [ ] **Step 4: Run** the same tests, plus `rg -n "channelHint \?\?" apps/operator/src`. Expected: tests PASS. Every remaining hit is a Take or a take-only path, and each is noted in the commit message.
- [ ] **Step 5: Commit** `fix(live)!: Cue from any rundown row always goes to preview (controller addition, D7a rule for rows)`

---

### Task 2: Air-state and key logic for Live (WS1/WS2 logic)  [P3-core] (after P3.1, P3.8)

**Files:**
- Create: `apps/operator/src/lib/rowLike.ts` (`type RowLike = Show["rows"][number] | { kind: string; id: string; sectionId?: string; lengthSec?: number; deckId?: string }`; Task 3's `rowView.ts` re-exports it), `apps/operator/src/lib/slidesRowView.ts` (the slides adapter with stub bodies, every signature in contracts §9), `apps/operator/src/lib/slidesRowView.test.ts` (asserts the stubs' neutral values, so plan 3 replaces the test with real cases)
- Modify: `apps/operator/src/lib/onAir.ts`, `rowAirState.ts`, `channelDotModel.ts`, `shortcutGuards.ts`, `songNav.ts`, `stageMode.ts` (keep P3.8's `case "slides"` lines and route them through the adapter)
- Test: matching `*.test.ts` files

**Interfaces:**
- Produces:
  - `pvwTakeMessages(pvw: ChannelState | undefined, showId: string | null): ClientMessage[]`
    - A song session on PVW with `liveRow` in this show → `[song_take_pvw_to_pgm]`.
    - A scripture session on PVW → `[{type:"scripture_take_slide", showId, rowId, slideIdx, channel:"program"}, {type:"scripture_end", channel:"preview"}]`.
    - Otherwise → `[take_pvw_to_pgm]`.
    - Nothing on PVW → `[]`.
    - A slides session on PVW needs no special case: the server's `takePvwToPgm` carries it (P3.5), so `[take_pvw_to_pgm]` is right.
  - `onAirCaption(st, ctx)`: puts "Blanked · " first when the song session is blanked. It lists every layer, joined with " · " and prefixed by layer: `"Video: Announcements · L3: <first field>"`.
  - `rowAirState(...)` returns `AirState = "program" | "preview" | "other-show" | null`. It returns `"other-show"` when the channel's `liveRow.showId !== ctx.showId` for a song or scripture row. A `slides` row returns `slidesAirState(row, channelStates)` from the adapter (stub `null`).
  - The adapter file `lib/slidesRowView.ts` exports exactly the contracts §9 list with stub bodies: `slidesAddItemEnabled = false`, `useDeckCache()` (a frozen `{}`), `useDeckFor` (undefined), `slidesRowViewFor`, `slidesAirState`, `slidesThumbState`, `slidesThumbMessages`, `slidesRowTakeMessages`, `slidesStripNotice`, `slidesKeyChannel`, `slidesAdvanceMessage`, `slidesBlankMessage` (null). It imports `Deck`, `SlidesRowView` types from `@overlaysys/core` (P3.1) and `RowLike` from `rowLike.ts`.
  - `channelDotModel` gives tone `"blanked"` (amber) for a blanked program song.
  - `escPress(now: number, lastEscAt: number | null, windowMs = 600): "arm" | "act"`.
  - `keyMode(store: { songSessions; channelStates }): "song" | "scripture" | "slides" | "rundown"`.
  - `scriptureKeyChannel(channelStates): "program" | null`.
  - `advanceMessage(mode, delta: 1 | -1): ClientMessage | null`.
  - `sectionAvailable(song: Pick<Song,"sections">, arrangement: string[], kind: SectionKind, ordinal: number): boolean`.
  - `shortcutHint(mode)` uses the D2 copy below.

- [ ] **Step 1: Write failing tests**

```ts
// onAir.test.ts
it("pvwTakeMessages promotes a cued song with its session", () => expect(pvwTakeMessages(pvwWithSong("show1","row3"), "show1")).toEqual([{ type: "song_take_pvw_to_pgm", showId: "show1", songRowId: "row3", fromChannel: "preview", toChannel: "program" }]));
it("pvwTakeMessages moves a cued scripture slide to program and ends the preview session", () => expect(pvwTakeMessages(pvwWithScripture("row5", 2), "show1")).toEqual([
  { type: "scripture_take_slide", showId: "show1", rowId: "row5", slideIdx: 2, channel: "program" }, { type: "scripture_end", channel: "preview" }]));
it("pvwTakeMessages swaps a plain graphic", () => expect(pvwTakeMessages(pvwWithGraphic(), "show1")).toEqual([{ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" }]));
it("pvwTakeMessages is empty with nothing cued", () => expect(pvwTakeMessages(undefined, "show1")).toEqual([]));
it("caption leads with Blanked", () => expect(onAirCaption(blankedSong(), ctx)).toBe("Blanked · Song title"));
it("caption lists video and graphic layers", () => expect(onAirCaption(videoPlusL3(), ctx)).toBe("Video: Announcements · L3: Pastor Placeholder"));
// rowAirState.test.ts
it("a song live from another show is other-show, not program", () => expect(rowAirState(songRow, statesWithLiveRow("otherShow"), sessions, { showId: "show1", rows })).toBe("other-show"));
// channelDotModel.test.ts
it("blanked program song is amber", () => expect(channelDotModel(/* blanked */).tone).toBe("blanked"));
// shortcutGuards.test.ts
it("escPress arms then acts within 600 ms", () => { expect(escPress(1000, null)).toBe("arm"); expect(escPress(1500, 1000)).toBe("act"); expect(escPress(1700, 1000)).toBe("arm"); });
it("keyMode is scripture when a scripture session is live on program", () => expect(keyMode({ songSessions: {}, channelStates: { program: { channel: "program", scriptureSession: s } } })).toBe("scripture"));
it("advanceMessage sends scripture_advance ±1", () => expect(advanceMessage("scripture", -1)).toEqual({ type: "scripture_advance", channel: "program", delta: -1 }));
// songNav.test.ts
it("sectionAvailable is false when the arrangement has no chorus", () => expect(sectionAvailable(song, ["v1","v2"], "chorus", 1)).toBe(false));
it("sectionAvailable counts the ordinal among that kind", () => expect(sectionAvailable(song, ["v1","c1","v2"], "verse", 2)).toBe(true));
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/{onAir,rowAirState,channelDotModel,shortcutGuards,songNav,stageMode,slidesRowView}.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the signatures above.
  - Hint copy for `shortcutHint` (D2):
    - song live: `"Space next · Shift+Space previous · C/B/T chorus/bridge/tag · 1–9, 0 verse · . blank · Esc Esc end song"`
    - scripture live: `"Space next · Shift+Space previous · Enter cue selection · ⌘Enter take PVW · Esc Esc clear program"`
    - rundown: `"↑/↓ select · Enter cue · Space take · ⌘Enter take PVW · Esc Esc clear program"`
  - `keyMode` precedence: a program song session, then a program scripture session, then `slidesKeyChannel(channelStates)` from `slidesRowView.ts` (stub returns null), then rundown.
  - `advanceMessage("slides", …)` delegates to the adapter's `slidesAdvanceMessage(delta)` (null until plan 3). `blankMessage(mode)`: song → the existing blank toggle; slides → `slidesBlankMessage()`; else null. The B key means "bridge" in song mode and "blank" in slides mode.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(live): air-state and key helpers for PVW take, double Esc, scripture keys, other-show rows [LIVE-6, LIVE-9, LIVE-10, LIVE-14, LIVE-19, LIVE-22]`. The `escPress` and `keyMode` wiring is split into a separate commit in Task 16 because it carries D2 and D3.

---

### Task 3: Row view model, sections grouping and "next" row  [P1-sections types, P1-tokens types, P3-core] (after Tasks 1, 2)

**Files:**
- Create: `apps/operator/src/lib/rowView.ts`, `apps/operator/src/lib/rowView.test.ts`, `apps/operator/src/lib/liveNext.ts`, `apps/operator/src/lib/liveNext.test.ts`
- Uses the adapter `lib/slidesRowView.ts` created in Task 2 (contracts §9)

**Interfaces:**
- Consumes: `groupRowsBySection`, `sectionLength`, `ShowSection` (P1-sections); `ItemKind` (P1-tokens); `resolveArrangement` (core); `formatClock` (`mediaTake.ts`); `effectiveRowData` (`rowData.ts`).
- Produces:
```ts
export type { RowLike } from "./rowLike";   // Task 2
type RowViewCtx = { show: Show; songs: SongMeta[]; songCache: Record<string, Song>; templates: TemplateMeta[]; templateCache: Record<string, Template>; overrides: RowDataOverrides; deckCache: Record<string, Deck> /* from useDeckCache() */ };
type RowView = { kind: ItemKind; title: string; detail: string | null; chips: string[]; moreChips: number; tag: string | null; lengthSec: number | null; supported: boolean };
function rowView(row: RowLike, ctx: RowViewCtx): RowView;
function sectionShortLabel(section: Section, sections: Section[]): string; // "V1", "C", "C2", "B", "T", "I", "O", "X"
type LiveGroup = { section: ShowSection | null; rows: RowLike[]; lengthSec: number | null; startIndex: number };
function liveGroups(show: Show): LiveGroup[];                 // wraps groupRowsBySection; adds totals + running row index
function nextRowId(rows: RowLike[], air: Record<string, AirState>, selectedRowId: string | null): string | null;
// slides rows: through the adapter lib/slidesRowView.ts (Task 2; contracts §9)
//   slidesRowViewFor(row, row.deckId ? ctx.deckCache[row.deckId] : null): SlidesRowView | null
```

- [ ] **Step 1: Write failing tests**

```ts
it("graphic title is the first text field value, template name is the tag [D19]", () => {
  expect(rowView(gfx({ title: "Welcome placeholder", subtitle: "Second line" }), ctx)).toMatchObject({ kind: "graphic", title: "Welcome placeholder", detail: "Second line", tag: "Section Intro" });
});
it("graphic title skips image/colour fields and data URLs", () => { /* fields [image logo, color bg, text name] → title = name value */ });
it("graphic with no field values falls back to the template name", () => expect(rowView(gfx({}), ctx).title).toBe("Section Intro"));
it("session overrides change the graphic title", () => { /* overrides r1.title = "Edited" → title "Edited" */ });
it("song row shows section chips V1 V2 V3 +5", () => expect(rowView(songRowWith8Verses, ctx)).toMatchObject({ kind: "song", chips: ["V1", "V2", "V3"], moreChips: 5 }));
it("repeated chorus gets C then C2 only for a different chorus section", () => { /* sections c1, c2 → "C", "C2"; arrangement c1 c1 → chips C C */ });
it("scripture detail is the abbreviation, else the id upper-cased [LIVE-23]", () => { /* translationAbbreviation "NIV" → "NIV"; absent, translation "kjv" → "KJV" */ });
it("video detail is its length", () => expect(rowView(video({ durationSec: 32 }), ctx).detail).toBe("0:32"));
it("an unknown kind renders as unsupported, never throws", () => expect(rowView({ kind: "future", id: "x" }, ctx)).toMatchObject({ supported: false, title: "Unsupported item" }));
it("a slides row with no plan-3 adapter renders a placeholder", () => expect(rowView({ kind: "slides", id: "x" }, ctx)).toMatchObject({ kind: "slides", title: "Slides deck", detail: "Needs Slides decks", supported: false }));
it("a slides row uses the adapter view when it returns one", () => { /* vi.mock("./slidesRowView") → { title: "Gloria", detail: "3 slides", missingDeck: false } → title "Gloria", detail "3 slides", supported true; missingDeck → supported false */ });
it("liveGroups › rows with an unknown sectionId stay visible in the no-section group", () => {
  const groups = liveGroups(showWith({ sections: [{ id: "a", name: "Gathering" }], rows: [row("1", "a"), row("2", "gone")] }));
  expect(groups.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(["1", "2"]);
});
it("liveGroups sums section length and is null when no row has one", () => { /* 60+90 → 150; none → null */ });
it("liveGroups with no sections is one flat group", () => expect(liveGroups(flatShow).length).toBe(1));
it("nextRowId prefers the row cued on preview", () => expect(nextRowId(rows, { r3: "preview", r1: "program" }, "r2")).toBe("r3"));
it("nextRowId is the selection when it isn't on program", () => expect(nextRowId(rows, { r1: "program" }, "r2")).toBe("r2"));
it("nextRowId is the row after program when the selection is on air", () => expect(nextRowId(rows, { r1: "program" }, "r1")).toBe("r2"));
it("nextRowId skips unsupported rows and is null at the end", () => { /* last row on program → null */ });
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/rowView.test.ts apps/operator/src/lib/liveNext.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - `rowView` dispatches on `row.kind`. For `"slides"` it calls `slidesRowViewFor(row, deck)` with `deck = row.deckId ? ctx.deckCache[row.deckId] : null` (undefined while not loaded); on null it returns the placeholder above, with the "Slides deck" title and `kind: "slides"`; otherwise `{ kind: "slides", title: v.title, detail: v.detail, supported: !v.missingDeck }`.
  - Graphic values use template field order from `templateCache[row.templateId]?.fields`, else data key order. They skip `type` image/color and values starting with `data:` or `/assets/`.
  - Chips come from `resolveArrangement(row, showSong, song)` with at most 3 chips, the rest counted in `moreChips`. Before the song is cached, chips are `[]` and detail is `"Default arrangement"`.
  - `sectionShortLabel`: kind letter (verse V, chorus C, bridge B, tag T, intro I, outro O, other X). A verse adds its ordinal among verse sections. Other kinds add an ordinal only from the second section of that kind.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(live): row view model, section groups with lengths, next row [LIVE-12 D19, LIVE-23]`

---

### Task 4: Thumbnail strip model and click rule (after Tasks 1 and 3)

**Files:**
- Create: `apps/operator/src/lib/thumbClick.ts`, `apps/operator/src/lib/thumbClick.test.ts`

**Interfaces:**
- Consumes: `slideDeltaTo` (`songNav.ts`), `resolveArrangement` (core), `scriptureSlideData` (`@overlaysys/scripture`), `songTakeChannel`, `songCueChannel` (`songChannel.ts`), `graphicRowMessage` (`rowData.ts`), `rowAirState`, `posterPathFor` (`mediaTake.ts`), the adapter's `slidesRowViewFor`, `slidesThumbState`, `slidesThumbMessages` (contracts §9), `sectionShortLabel` (Task 3).
- Produces:
```ts
type ThumbCtx = RowViewCtx & { channelStates: Record<string, ChannelState>; songSessions: Record<string, SongSessionSummary | null> };
type ThumbRender = { kind: "template"; templateId: string; data: Record<string, string> } | { kind: "poster"; src: string | null } | { kind: "placeholder"; text: string };
type ThumbSpec = { key: string; label: string; group: { label: string; sectionKind: SectionKind } | null; render: ThumbRender; state: "live" | "cued" | null; blanked: boolean };
function thumbsFor(row: RowLike, ctx: ThumbCtx): ThumbSpec[];
type ThumbAction = { messages: ClientMessage[]; toast?: string };
function thumbActivate(row: RowLike, index: number, ctx: ThumbCtx): ThumbAction;
```
- Rule (spec, owner): if the row is live (on its program channel), the click takes **that slide** to air on that channel. Otherwise it cues to **preview**. It never goes straight to program.
  - **Song:**
    - Live on channel X: `song_advance(X, delta)`, where delta is `slideDeltaTo(session.arrangement, …, cursor, arrIdx) + slideIdx`. Delta 0 sends nothing. A null delta with the section still in the song sends `song_jump(X, sectionId, slideIdx)`.
    - Not live: if the same row's session is on preview, `song_advance("preview", delta)`. Otherwise `song_take("preview")` followed by `song_advance("preview", delta-from-{0,0})` (only when delta > 0).
  - **Scripture:** live → `scripture_goto(channel, i)`. Not live → `scripture_take_slide({showId,rowId,slideIdx:i,channel:"preview"})`.
  - **Graphic:** live → no messages, toast `"Already on air"`. Not live → `graphicRowMessage(row,"cue",…)`.
  - **Video:** live → none. Not live → none, toast `"Videos play straight to their output: use Take"`.
  - **Slides:** `slidesThumbMessages(ctx.show.id, row, i, live ? "program-live" : "preview")`, where `live = slidesAirState(row, ctx.channelStates) === "program"`. When that returns null, no messages and toast `"Slides decks aren't available yet"`. Slides thumbs come from `slidesRowViewFor(...).slides` (`ResolvedSlide`: `key`, `label ?? "Slide n"`, `{ kind: "template", templateId, data }`) with `state = slidesThumbState(row, position, channelStates)`.
- Song thumbs use the **session's** arrangement when a session for this row exists (program first), otherwise `resolveArrangement`. `blanked` is true on the live thumb when the session is blanked.

- [ ] **Step 1: Write failing tests**

```ts
it("song thumbs: one per slide in arrangement order with group labels", () => {
  expect(thumbsFor(songRow, ctx).map((t) => t.label)).toEqual(["V1 · 1", "V1 · 2", "C · 1", "V2 · 1", "C · 1"]);
  expect(thumbsFor(songRow, ctx)[0]!.render).toEqual({ kind: "template", templateId: "lyric", data: { text: "Line one of verse one\nLine two of verse one" } });
});
it("live song: the slide under the cursor is live, preview cursor is cued", () => { /* program session cursor {1,0} → thumbs[2].state === "live" */ });
it("thumbActivate › live song jumps to the clicked slide", () => expect(thumbActivate(songRow, 3, liveCtx).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]));
it("thumbActivate › repeated chorus lands on the clicked occurrence", () => {
  // arrangement v1 c1 v2 c1, each 1 slide, cursor at index 0 → click thumb 3 (second chorus) → delta 3, not a song_jump to c1
  expect(thumbActivate(songRow, 3, liveCtxAt0).messages).toEqual([{ type: "song_advance", channel: "program", delta: 3 }]);
});
it("thumbActivate › song not live while another song is on program cues preview only", () => {
  const msgs = thumbActivate(otherSongRow, 2, ctxWithDifferentSongOnProgram).messages;
  expect(msgs).toEqual([
    { type: "song_take", channel: "preview", showId: "show1", songRowId: "rowB" },
    { type: "song_advance", channel: "preview", delta: 2 },
  ]);
  expect(msgs.every((m) => !("channel" in m) || m.channel === "preview")).toBe(true);
});
it("thumbActivate › stale live arrangement falls back safely", () => {
  // session.arrangement references "c9", which the cached song no longer has; click that thumb
  expect(thumbActivate(songRow, 4, staleCtx)).toEqual({ messages: [], toast: "That section is no longer in this song" });
});
it("scripture: live goes to the slide, not live cues it on preview", () => { /* scripture_goto program 2 / scripture_take_slide channel preview */ });
it("graphic hinted to program: a click on a non-live graphic cues preview", () => expect(thumbActivate(gfxProgramHint, 0, ctx).messages[0]).toMatchObject({ type: "cue", channel: "preview" }));
it("video never sends from a thumbnail", () => expect(thumbActivate(videoRow, 0, ctx)).toEqual({ messages: [], toast: "Videos play straight to their output: use Take" }));
it("video thumb is the poster frame", () => expect(thumbsFor(videoRow, ctx)[0]!.render).toEqual({ kind: "poster", src: "/assets/poster/abc.jpg" }));
it("slides without plan 3: placeholder thumb, click sends nothing", () => { /* render.kind === "placeholder"; messages [] */ });
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/thumbClick.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the rule above. The lyric template id is the session's `lyricTemplateId` when live, else `row.lyricTemplateId`. Scripture thumbs use `row.templateId` with `scriptureSlideData(row, i)` as data. The poster src comes from `posterPathFor(row.assetUrl)` (null → `{kind:"poster",src:null}`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(live): thumbnail model and click rule (live → that slide on air; otherwise cue to PVW)`

---

### Task 5: Show editor logic and length parsing  [rowLength part: no dependency; showEditOps: P1-sections]

**Files:**
- Modify: `apps/operator/src/lib/rowLength.ts`, `apps/operator/src/lib/rowLength.test.ts`
- Create: `apps/operator/src/app/shows/edit/showEditOps.ts` (+test), `apps/operator/src/app/shows/edit/songPicker.ts` (+test)

**Interfaces:**
- Consumes: `moveRow`, `insertRow`, `addSection` (returns `{ show, section }`), `renameSection`, `deleteSection`, `moveSection`, `groupRowsBySection`, `orderRowsBySection` (P1-sections). Every op here returns `rows` in display order (contracts §4 invariant): build on these helpers rather than splicing `rows` directly.
- Produces:
```ts
// rowLength.ts  [D13]
function parseRowLength(text: string): { ok: true; sec: number | undefined } | { ok: false };
function lengthEcho(text: string): string | null;  // "= 5:00" live echo; null when empty/invalid
function cumulativeStarts(rows: RowLike[]): (number | null)[]; // start offset in seconds of each row, null after a row without a length
function showTotal(rows: RowLike[]): number | null;
// showEditOps.ts
function removeRowAt(show: Show, rowId: string): { show: Show; removed: { row: RowLike; index: number } | null };
function restoreRow(show: Show, removed: { row: RowLike; index: number }): Show;
function nudgeRow(show: Show, rowId: string, delta: -1 | 1): Show;     // Alt+↑/↓; crosses section boundaries
type DropPos = { overRowId: string; half: "before" | "after" } | { overSectionId: string | null; at: "start" | "end" };
function dropTarget(show: Show, pos: DropPos): { toSectionId: string | null; toIndex: number };
function canSave(s: { connected: boolean; cloud: boolean; dirty: boolean; saving: boolean }): { ok: boolean; reason: string | null };
function nameForSave(name: string): string;                            // "" / whitespace → "Untitled show"
function insertRowsAfter(show: Show, afterRowId: string | null, sectionId: string | null, rows: RowLike[]): Show;  // repeated core insertRow
// songPicker.ts
function rankSongs(songs: SongMeta[], query: string, recentIds: string[]): SongMeta[];
```
- D13 semantics:
  - A bare integer means minutes: `"5"` → 300.
  - A decimal means minutes: `"4.5"` → 270.
  - `"1:30"` → 90. `"1:02:03"` → 3723.
  - An `s` suffix means seconds: `"90s"` → 90. `"2m"` → 120. `"2m30s"` → 150.
  - `"0"` → `sec: undefined` (clears). `""` → undefined.
  - Anything else → `{ ok: false }`.
- `canSave` reasons are `"No changes to save"`, `"Not connected"` and `"Saving…"`.
- `rankSongs`: an empty query returns recent first, then by title. Otherwise the order is title prefix > title word-start > author or CCLI contains > title subsequence, ties broken by recent then title.

- [ ] **Step 1: Write failing tests**

```ts
it.each([["5", 300], ["4.5", 270], ["1:30", 90], ["90s", 90], ["2m", 120], ["2m30s", 150], ["1:02:03", 3723], ["0", undefined], ["", undefined]])(
  "parseRowLength(%s) [D13]", (t, sec) => expect(parseRowLength(t)).toEqual({ ok: true, sec }));
it.each(["abc", "1:75", "-3", "5x"])("rejects %s", (t) => expect(parseRowLength(t)).toEqual({ ok: false }));
it("lengthEcho echoes minutes", () => expect(lengthEcho("5")).toBe("= 5:00"));
it("cumulativeStarts and total", () => { expect(cumulativeStarts([l(60), l(90), l(30)])).toEqual([0, 60, 150]); expect(showTotal([l(60), l(90)])).toBe(150); });
it("removeRowAt/restoreRow round-trip keeps index and sectionId", () => { /* remove index 2 → restore → deep equal original */ });
it("nudgeRow up from the first row of a section moves it to the end of the previous section", () => { /* sectionId changes */ });
it("dropTarget before a row in another section yields that section and index", () => { /* … */ });
it("canSave explains why not", () => expect(canSave({ connected: false, cloud: false, dirty: true, saving: false })).toEqual({ ok: false, reason: "Not connected" }));
it("nameForSave falls back", () => expect(nameForSave("  ")).toBe("Untitled show"));
it("rankSongs puts title-prefix matches first, then recent", () => { /* … */ });
it("rankSongs matches CCLI number", () => expect(rankSongs(songs, "1234567", [])[0]!.id).toBe("s-ccli"));
it("removeRowAt keeps unknown row keys and show keys", () => { /* row with extra key "future": 1 survives restore; show.extra survives */ });
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/rowLength.test.ts apps/operator/src/app/shows/edit/showEditOps.test.ts apps/operator/src/app/shows/edit/songPicker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `parseRowLength` handles the D13 forms itself and only delegates colon forms to `parseDuration`. `core/timeField.ts` is not changed (timers use it). All show ops return a new `Show` built by spreading the input, so unknown keys survive.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** in two commits:
  - `feat(shows): length accepts minutes; show total and start times [SHOWS-9, D13]` (rowLength only)
  - `feat(shows): editor ops for undo delete, keyboard and cross-section moves, song picker ranking [SHOWS-3, SHOWS-5, SHOWS-10, SHOWS-16]`

---

### Task 6: Save ack, connection and template-role helpers — moved

Moved to plan 1: `awaitAck` / `useConnection` → **P1.6** (`sendAndAwaitAck`, `requestOne`, `AckError`, `ackErrorText`, `useConnection(): { connected; conn; retry }`), and `templatesFor` / template roles → **P1.8** (`templatesFor(metas, use, recentIds?)`, `templateRole`). Names and signatures: contracts §7. This plan's tasks consume them; there is no `connectionView` in this plan (the shell's banner logic is P2b.1's).

---

### Task 7: Core song parsers: headerless lyrics, ChordPro, empty-section warnings

**Files:**
- Modify: `packages/core/src/songParser.ts`, `sectionEmit.ts`, `parsePlainLyrics.ts`, `songSelectParser.ts` (+tests)
- Create: `packages/core/src/chordPro.ts`, `packages/core/src/chordPro.test.ts`
- Modify: `packages/core/src/index.ts` (append `export * from "./chordPro";` only)

**Interfaces:**
- Produces:
```ts
// songParser.ts
type SongTextParse = { song: Song; notice: string | null };
function parseSongTextWithNotice(id: string, title: string, text: string): SongTextParse;  // never throws on non-empty text
function parseSongFromText(id, title, text): Song;  // unchanged signature; now = parseSongTextWithNotice(...).song
// sectionEmit.ts
function emptySections(sections: Section[]): Section[];          // sections whose every slide is blank lines
// chordPro.ts
type ChordProResult = { meta: { title?: string; artist?: string; ccliNumber?: string; copyright?: string }; sections: Section[]; defaultArrangement: string[] };
function looksLikeChordPro(text: string): boolean;              // any {directive} line or {soc}/{start_of_*}
function parseChordPro(text: string): ChordProResult;
```
- Headerless text (SONGS-3) is imported as one "Verse 1" section, with slides split at blank lines. The notice reads `"No section headers found, so everything was imported as Verse 1. Add [Verse 1], [Chorus] headers to split it."`
- Lines before the first header become an "Intro" section.
- Empty text throws `"Paste some lyrics first."`.
- ChordPro:
  - Reads `{title:|t:}`, `{artist:}`, `{ccli:}`, `{copyright:}`.
  - `{start_of_verse[: label]}…{end_of_verse}`, `{sov}/{eov}`, `{start_of_chorus}`, `{soc}/{eoc}`, `{start_of_bridge}`/`{sob}` (and tab/grid blocks are skipped) map to sections. The label defaults to "Verse n" / "Chorus" / "Bridge".
  - `{c: text}` / `{comment: text}` on its own line starts a section labelled by the text when it matches a header word, else it is ignored.
  - `{chorus}` (a recall) adds the last chorus id to the arrangement.
  - `[G]` chords are stripped by `stripChords`.
  - Everything goes through `emitSections`.

- [ ] **Step 1: Write failing tests** (invented placeholder lyrics only)

```ts
// songParser.test.ts
it("headerless text becomes Verse 1 with slides at blank lines, with a notice", () => {
  const r = parseSongTextWithNotice("id", "T", "Line one\nLine two\n\nLine three");
  expect(r.song.sections).toEqual([{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["Line one", "Line two"] }, { id: "v1s2", lines: ["Line three"] }] }]);
  expect(r.notice).toMatch(/No section headers found/);
});
it("orphan lines before the first header become Intro", () => { /* "Lead line\n\n[Verse 1]\nLine one" → sections [intro, verse] */ });
it("repeated empty header still references the earlier section (SONGS-1 regression)", () => {
  /* V1 / Chorus / V2 / [Chorus] / Bridge / [Chorus] → 4 sections, arrangement ["v1","c1","v2","c1","b1","c1"] — same via parsePlainLyrics and parseSongSelectText */
});
// chordPro.test.ts
it("parses directives, sections, chorus recall and strips chords", () => {
  const r = parseChordPro("{title: Placeholder Song}\n{artist: A. Writer}\n{ccli: 1234567}\n{start_of_verse}\n[G]Line one of [C]verse one\n{end_of_verse}\n{soc}\nLine one of chorus\n{eoc}\n{start_of_verse}\nLine one of verse two\n{end_of_verse}\n{chorus}");
  expect(r.meta).toEqual({ title: "Placeholder Song", artist: "A. Writer", ccliNumber: "1234567" });
  expect(r.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus", "Verse 2"]);
  expect(r.sections[0]!.slides[0]!.lines).toEqual(["Line one of verse one"]);
  expect(r.defaultArrangement).toEqual(["v1", "c1", "v2", "c1"]);
});
it("looksLikeChordPro", () => { expect(looksLikeChordPro("{soc}\nx\n{eoc}")).toBe(true); expect(looksLikeChordPro("[Verse 1]\nx")).toBe(false); });
// sectionEmit.test.ts
it("emptySections finds a section of blank slides", () => { /* … */ });
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/songParser.test.ts packages/core/src/chordPro.test.ts packages/core/src/sectionEmit.test.ts packages/core/src/parsePlainLyrics.test.ts packages/core/src/songSelectParser.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.** Headerless and orphan handling lives in `songParser.tokenize` (one synthetic `RawSection`, header "Verse 1" or "Intro"). ChordPro builds `RawSection[]` and calls `emitSections`. Error messages are sentence case.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @overlaysys/core typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): headerless lyrics import as Verse 1, ChordPro parser, empty-section check [SONGS-1 rest, SONGS-3, SONGS-4]`

---

### Task 8: Paste and file-import routing, chord detection, export round trip

**Files:**
- Modify: `apps/operator/src/app/songs/pasteLyrics.ts` (+test), `apps/operator/src/app/songs/songImport.ts` (+test)

**Interfaces:**
- Consumes: Task 7 (`parseSongTextWithNotice`, `parseChordPro`, `looksLikeChordPro`, `emptySections`); `exportFileName("song", song)` from `lib/exportName.ts` (P1.11) for the export file name (no song-specific copy here).
- Produces:
```ts
type LyricsFormat = "chordpro" | "songselect" | "plain";
function detectLyricsFormat(text: string, fileName?: string): LyricsFormat;   // ".cho"/".chordpro"/".chopro" or looksLikeChordPro → chordpro
const CHORD_TOKEN_RE: RegExp; // ^[A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(/[A-G][#b]?)?$
function hasInlineChords(text: string): boolean;  // a [token] matching CHORD_TOKEN_RE on a line that also has lyric text
type LyricsParse =
  | { ok: true; patch: SongPatch; format: LyricsFormat; notice: string | null; warnings: string[] }
  | { ok: false; error: string; format: LyricsFormat };
function parsePastedLyrics(song: Pick<Song, "id" | "title">, text: string, updateMeta: boolean, fileName?: string): LyricsParse;
function parseSongImportJson(text: string): { ok: true; song: Song } | { ok: false; error: string };  // validates with SongSchema
```
- `warnings` has one entry per empty section: `"Chorus has no lines: it will show a blank slide"`.
- Empty input returns `{ok:false, error:"Paste or drop lyrics to preview."}`.
- A file with no sections returns `"Couldn't find any verses or choruses in this file."`.

- [ ] **Step 1: Write failing tests**

```ts
it.each(["[Chorus]", "[Bridge]", "[Ending]"])("%s alone is a header, not a chord", (h) => expect(hasInlineChords(`${h}\nLine one`)).toBe(false));
it("inline chords count", () => expect(hasInlineChords("[G]Line one [D/F#]of verse")).toBe(true));
it("ChordPro by extension and by directive", () => { expect(detectLyricsFormat("x", "a.cho")).toBe("chordpro"); expect(detectLyricsFormat("{soc}\nx\n{eoc}")).toBe("chordpro"); });
it("plain bracketed text stays plain (not SongSelect) after the chord fix", () => expect(detectLyricsFormat("[Verse 1]\nLine one\n\n[Chorus]\nLine two")).toBe("plain"));
it("headerless paste is ok with a notice", () => expect(parsePastedLyrics(song, "Line one\n\nLine two", false)).toMatchObject({ ok: true, notice: expect.stringMatching(/Verse 1/) }));
it("an empty section is warned", () => { /* SongSelect text with an empty "Chorus 2" body → warnings[0] === "Chorus 2 has no lines: it will show a blank slide" */ });
it("export file name comes from plan 1's helper", () => expect(exportFileName("song", { id: "s", title: "Placeholder: Song", ccliNumber: "123" })).toBe("Placeholder Song (CCLI 123).json"));
it("export then import round-trips", () => { const s = sampleSong(); const r = parseSongImportJson(JSON.stringify(s)); expect(r).toEqual({ ok: true, song: s }); });
it("import rejects JSON that isn't a song", () => expect(parseSongImportJson("{}")).toMatchObject({ ok: false }));
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/app/songs/pasteLyrics.test.ts apps/operator/src/app/songs/songImport.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `looksLikeSongSelect` drops its chord-bracket rule and uses `hasInlineChords` instead. The detection order is chordpro, then songselect, then plain.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(songs): ChordPro routing, stricter chord detection and JSON import [SONGS-4, SONGS-9, SONGS-10]`

---

### Task 9: Song draft operations

**Files:**
- Modify: `apps/operator/src/app/songs/edit/songDraftOps.ts`, `songDraftOps.test.ts`

**Interfaces:**
- Produces (all pure, `Song → Song`, spreading unknown keys):
```ts
function addSongSection(song: Song, kind: SectionKind): { song: Song; sectionId: string };  // appends to sections AND defaultArrangement; label "<Kind> n" unique (named so it never shadows core's show addSection)
function sectionsNotInArrangement(song: Song): string[];
function appendToArrangement(song: Song, sectionId: string): Song;
function moveArrangementChip(song: Song, from: number, to: number): Song;
function removeArrangementAt(song: Song, index: number): Song;
function setSectionKind(song: Song, sectionId: string, kind: SectionKind): Song;      // relabels only an auto label (/^(Verse|Chorus|…) \d+$/ or bare kind)
function uniqueLabel(song: Song, label: string, exceptId?: string): string;        // "Chorus" taken → "Chorus 2"
function firstLine(section: Section): string;                                     // first non-empty line, "" if none
function removeSlide(song: Song, sectionId: string, slideId: string): { song: Song; removed: { sectionId: string; index: number; slide: Slide } | null };
function restoreSlide(song: Song, removed: { sectionId: string; index: number; slide: Slide }): Song;
function removeSection(song: Song, sectionId: string): { song: Song; removed: { index: number; section: Section; arrangementIdx: number[] } };
function restoreSection(song: Song, removed: …): Song;
function slideText(slide: Slide): string;                    // lines.join("\n")
function linesFromText(text: string): string[];              // split on \n, trim trailing blank lines, [""] when empty (schema needs ≥1)
```

- [ ] **Step 1: Write failing tests**

```ts
it("addSongSection joins the arrangement [SONGS-2]", () => { const r = addSongSection(song, "bridge"); expect(r.song.defaultArrangement.at(-1)).toBe(r.sectionId); });
it("sectionsNotInArrangement lists unused sections", () => expect(sectionsNotInArrangement(songWithUnusedTag)).toEqual(["t1"]));
it("uniqueLabel suffixes duplicates", () => expect(uniqueLabel(songWithChorus, "Chorus")).toBe("Chorus 2"));
it("setSectionKind relabels an auto label only", () => { expect(setSectionKind(s("Verse 2"), "v2", "chorus").sections[1]!.label).toBe("Chorus 2"); expect(setSectionKind(s("Big ending"), "v2", "tag").sections[1]!.label).toBe("Big ending"); });
it("removeSlide/restoreSlide round-trip [SONGS-5]", () => { const r = removeSlide(song, "v1", "v1s2"); expect(restoreSlide(r.song, r.removed!)).toEqual(song); });
it("removeSection drops its arrangement entries and restore puts them back", () => { /* … */ });
it("linesFromText keeps one empty line for an empty slide", () => expect(linesFromText("")).toEqual([""]));
it("firstLine", () => expect(firstLine(section(["", "Line one of verse one"]))).toBe("Line one of verse one"));
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/app/songs/edit/songDraftOps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. Section ids use the existing `SECTION_ID_PREFIX` map (move it from `SongDraftEditor.tsx` into `songDraftOps.ts` and export it).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(songs): draft ops for arrangement, unique labels, undoable slide and section removal [SONGS-2, SONGS-5, SONGS-15]`

---

### Task 10: Sermon notes import keeps the title out of the points

**Files:**
- Modify: `packages/core/src/sermonNotes.ts` (+test), `apps/operator/src/lib/notesImport.ts` (+test)

**Interfaces:**
- Produces: `splitPoints(body)` (unchanged signature). When the first heading is an H1 and H2s follow, that H1 is dropped from the points. `titleFromMarkdown(md: string): string | null` returns that H1's text. `notesFromFile` uses `titleFromMarkdown(body) ?? titleFromFileName(name)`.

- [ ] **Step 1: Write failing tests:** `"# Placeholder sermon\n## Point one\nBody\n## Point two\nBody"` gives two points ("Point one", "Point two") and the title "Placeholder sermon". A document of only H1s keeps them as points. Text with no headings splits by blank-line paragraphs, as today.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/sermonNotes.test.ts apps/operator/src/lib/notesImport.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(shows): sermon notes import uses the H1 as the set title [SHOWS-13]`

---

### Task 11: Shared sectioned rundown list  [P1-controls, P1-tokens, P1-sections] (after Tasks 3, 5)

**Files:**
- Create: `apps/operator/src/app/components/rundown/RundownList.tsx`, `RundownRow.tsx`, `SectionDivider.tsx`
- Modify: `apps/operator/src/app/components/Rundown.tsx` (Live wrapper)

**Interfaces:**
- Consumes: `rowView`, `liveGroups`, `nextRowId` (Task 3); `rowAirState` (Task 2); `formatRowLength`, `cumulativeStarts`, `showTotal` (Task 5); `KindBar`, `Button`, `IconButton`, `useContextMenu`, `Tooltip` (P1).
- Produces:
```tsx
type RundownListProps = {
  show: Show;
  mode: "live" | "edit";
  selectedRowId: string | null;
  onSelect(rowId: string): void;
  air?: Record<string, AirState>;                 // live only
  nextRowId?: string | null;                     // live only
  onTake?(rowId: string): void;                  // live: Take on the next row
  onCue?(rowId: string): void;                   // live: Cue on the selected row
  onDoubleClick?(rowId: string): void;           // live: D4 behaviour chosen by the page
  warnRowIds?: Set<string>;                      // ⚠ text-overflow rows (Task 13)
  // edit only
  onMoveRow?(rowId: string, target: { toSectionId: string | null; toIndex: number }): void;
  onSectionMenu?(sectionId: string, e: React.MouseEvent | HTMLElement): void;
  onRenameSection?(sectionId: string, name: string): void;
  onRowMenu?(rowId: string, e: React.MouseEvent | HTMLElement): void;
  footer?: React.ReactNode;                       // edit: "+ Add item · + Section"
};
function RundownList(p: RundownListProps): JSX.Element;
```
- Row anatomy (spec, option B):
  - A 3 px `KindBar`.
  - Line 1 is `view.title` (13 px, weight 500, ellipsis). Edit mode puts a `GripVertical` 14 px before it; Live puts the row number before it in `textMuted` 11 px.
  - Line 2 is muted 11 px: `view.detail` or chips (`10px`, `surface-3` background, 0 5 px padding) plus `+N`.
  - On the right: the length (`M:SS`, `textMuted`). Edit mode adds the cumulative start time under it.
  - A graphic's template name is in a `Tooltip` on the title, not the headline (D19).
- Row height ≤ 44 px with two lines, at most 2 lines and no wrap.
- Live row states:
  - **On air:** inset `3px 0 0 var(--onair)`, background `rgba(229,72,77,0.10)`, and an "ON AIR" chip (10 px, bold, onair bg, white).
  - **Next:** inset `3px 0 0 var(--ok)`, plus a `Button variant="onair" size="sm"` "Take" (24 px tall). This is the only Take in the list.
  - **Cued on preview:** a green "CUED" chip.
  - **Selected:** `control` background.
  - **Selected and not on air:** also a ghost "Cue" before Take, with an 8 px gap (WS2.5).
  - **Other show:** muted text, no colour, and title `"On air in another show"`.
  - All row actions are always visible on their row (no hover-only actions).
- Section divider: 11 px, weight 700, uppercase, letter-spacing .08em, `textMuted` on `bg`. The name is on the left. `sectionLength` is on the right as `M:SS` when it isn't null.
  - Edit mode: double-click the name to rename inline (`Input`, Enter commits, Esc reverts), plus a "⋯" `IconButton` (`aria-label="Section options for <name>"`).
  - Live: the divider isn't interactive.
- The header line shows `show.name · N items · Total M:SS` (`showTotal`).
- Edit-mode drag uses native HTML5 drag. The drop line is `box-shadow: inset 0 2px 0 var(--ok)` (before) or `inset 0 -2px 0 var(--ok)` (after). A drop on a divider means "start of that section". The target comes from `dropTarget` (Task 5). Alt+↑/↓ on the focused row calls `onMoveRow` with the `nudgeRow` result.
- Keyboard: `role="listbox"` / `role="option"` with `aria-activedescendant` (kept from today), and ↑/↓ via the page.
- Empty states:
  - Live with no show: `"Pick a show to start"` + "Shows" button.
  - Disconnected: last show dimmed under `<OfflineState variant="stale" onRetry={useConnection().retry}>` ("Not connected to the server" · "Showing what was last loaded." · Retry).
  - Edit with no rows: a row of buttons, one per add action.
- `Rundown.tsx` (Live) computes `air` per row with `rowAirState` and `nextRowId`. It wires `onTake` to the existing per-kind take messages (graphic `graphicRowMessage(...,"take")`, song `song_take` to `songTakeChannel`, scripture `scripture_take_slide` index 0 or next, video `videoRowTakeMessage`; slides through the adapter's `slidesRowTakeMessages(show.id, row, "take")` when not null). `onCue` uses `graphicRowMessage(...,"cue")`, `song_take` to `songCueChannel` (= preview), scripture `scripture_take_slide` with `channel:"preview"`, and slides `slidesRowTakeMessages(show.id, row, "cue")`. Video has no Cue button. It keeps the template prefetch effect.

- [ ] **Step 1: Typecheck the new files:** `pnpm --filter operator typecheck`. Expected: PASS.
- [ ] **Step 2: Build** with `pnpm --filter operator build`. Expected: PASS.
- [ ] **Step 3: Shoot `rundown-sections`** on Live with a show that has 3 sections and 9 rows (create it with `uxreview/live-mkshow.mjs`, adding `sections`/`sectionId`).
  - Measure: every row is ≤ 44 px tall at 1280; no row text wraps (`scrollHeight <= 2 * lineHeight`); exactly one `button` named "Take" in `[role=listbox]`; section totals read `M:SS`.
  - Then take row 2, re-shoot `rundown-onair-next`. Row 2 has the ON AIR chip, and row 3 is green with Take.
- [ ] **Step 4: Commit** `feat(live): sectioned rundown with two-line rows, ON AIR / next states, one Take [LIVE-8, LIVE-12, LIVE-19, LIVE-33]`

---

### Task 12: Air zone: fixed monitors, tally, air controls  [P1-controls, P1-tokens] (after Task 2)

**Files:**
- Modify: `apps/operator/src/app/components/Monitors.tsx`, `OnAirStrip.tsx`, `ChannelPreview.tsx`, `MediaTransportStrip.tsx`, `ConsoleBottomBar.tsx`, `ChannelDots.tsx`, `ChannelWindowSettingsPopover.tsx`

**Interfaces:**
- Consumes: `pvwTakeMessages`, `clearChannelMessages`, `channelHasContent`, `onAirCaption` (Task 2); `channelDotModel` (Task 2); `useConfirm`, `Button` (P1).
- Produces:
  - `monitorColumns(): string`: `"minmax(0,1fr) minmax(0,1fr) 112px"`. The `compact` parameter is removed (D1).
  - `Monitors()` takes no props.
  - `AirControls()` (in `OnAirStrip.tsx`) is a vertical stack of 4 full-width `sm` buttons with an 8 px gap:
    - "Take" (`onair`, disabled when PVW is empty, label "Taking…" while pending). It sends `pvwTakeMessages(pvw, show?.id)`.
    - "Clear PVW" (secondary).
    - "Clear PGM" (secondary).
    - "Clear all" (`danger`). It asks first with `useConfirm({ title: "Clear all channels?", message: "Everything on <list> will be cleared.", confirmLabel: "Clear all", danger: true })`.
    - Every button blurs after click.
  - `MonitorCaption({ channel: "preview" | "program" })` is a one-line ellipsised caption under its monitor, with the full text as `title`. It reads `emptyLabel` when the channel is empty.
  - `ChannelPreview` gets new props `{ emptyLabel?: string }`:
    - Shows a centred amber "BLANKED" overlay when `state.songSession?.blanked`.
    - Shows an "IN…" chip from `active.takenAt` until the template's in-timeline duration (read from the cached template, default 0) has elapsed.
    - Shows no "(idle)" when media is set.
  - `MediaTransportStrip` gets a new prop `size?: "sm" | "lg"`. Its buttons are labelled "Play", "Pause", "Fade out" (secondary) and "Cut" (danger outline), with lucide icons.
- Monitor ring:
  - Idle: 1 px `border`.
  - With content (`channelHasContent`): 3 px ring, PGM `onair` with an "ON AIR" chip, PVW `ok` with a "CUED" chip.
  - The PVW/PGM tags stay top-left.
- Monitors never resize between modes (D1). Their width is `(centre width − 112 − 2×12 gap − 24 padding) / 2`, and the air zone is capped at `42vh` by limiting monitor width to `calc(42vh * 16 / 9)`.
- `ConsoleBottomBar` shows the keys badge `"Keys: Song" | "Keys: Scripture" | "Keys: Slides" | "Keys: Rundown"` from `keyMode` (Task 2) on the left, then the media transport, then channel dots. The dot tone `"blanked"` uses `warn`.

- [ ] **Step 1: Typecheck and build:** `pnpm --filter operator typecheck && pnpm --filter operator build`. Expected: PASS.
- [ ] **Step 2: Shoot `air-zone`** idle, then with a song on PGM (`air-zone-song`), with paired `__out-pgm` shots.
  - Measure: monitor rects are identical before and after taking lyrics (±1 px) [D1].
  - At 1440×900 with the drawer open, each monitor is ≥ 330 px wide.
  - All four air buttons are ≤ 32 px tall and inside the air zone.
  - The PVW Take is not red while PVW is empty.
- [ ] **Step 3: Shoot `air-zone-blanked`** after `.`. The PGM monitor shows BLANKED, and the caption begins "Blanked · ".
- [ ] **Step 4: Shoot `air-zone-video`** with a video playing. The transport reads Play/Pause/Fade out/Cut.
- [ ] **Step 5: Commit** `feat(live): fixed air zone with tally ring and air-controls strip [LIVE-4 D1, LIVE-6, LIVE-14, LIVE-15, LIVE-30, LIVE-31, LIVE-34]`

---

### Task 13: Selected-item region: thumbnail strip and item bar  [P1-controls, P1-thumb] (after Tasks 3, 4, 12, 19 — imports `sectionKindColor`; P3.8's `StageArea.tsx` placeholder lands first)

**Files:**
- Create: `apps/operator/src/app/components/live/ThumbStrip.tsx`, `apps/operator/src/app/components/live/ItemBar.tsx`, `apps/operator/src/lib/textOverflow.ts` (+test)
- Modify: `apps/operator/src/app/components/StageArea.tsx`, `TakePanel.tsx`, `apps/operator/src/lib/stageMode.ts`

**Interfaces:**
- Consumes: `thumbsFor`, `thumbActivate` (Task 4); `rowView` (Task 3); `TemplateThumbnail` (P1-thumb); `useToast` (P1); `MediaTransportStrip size="lg"` (Task 12); adapter `useDeckFor`, `useDeckCache`, `slidesStripNotice`, `slidesRowTakeMessages` (Task 2, contracts §9). `useDeckFor(selectedRow)` is called so the selected slides row's deck is fetched.
- Produces:
```tsx
function ThumbStrip({ row, ctx }: { row: RowLike; ctx: ThumbCtx }): JSX.Element;
function ItemBar({ row }: { row: RowLike }): JSX.Element;
// textOverflow.ts
type FieldMeasure = { key: string; label: string; text: string; scrollW: number; clientW: number; scrollH: number; clientH: number };
function overflowSummary(m: FieldMeasure[]): { key: string; label: string; shown: number; total: number; message: string }[];
function templateHasVisibleText(t: Pick<Template, "layers">): boolean;
```
- The ThumbStrip grid is `repeat(auto-fill, minmax(180px, 1fr))` with a 10 px gap.
  - Each card is a `TemplateThumbnail width={cardWidth}` (or poster `<img>`, or a placeholder box with its text).
  - The group label sits under the card (10 px bold, coloured by `sectionKindColor` from Task 19's `sectionColors.ts`).
  - Border: 2 px. `live` = `onair`, `cued` = `ok`, otherwise transparent. Hover = `borderStrong`.
  - A `blanked` live card gets an amber "BLANKED" overlay (WS2.12).
  - Cards mount lazily (an IntersectionObserver mounts the `TemplateThumbnail` the first time it is within 200 px of view).
  - `scrollIntoView({block:"nearest"})` on the live card when it changes.
  - Click = `thumbActivate`. Send `messages` in order, and show `toast` via `useToast({tone:"info"})` when present.
  - Each card is a `button` with `aria-label="<label>, <state>"`.
- The ItemBar is one 36 px row:
  - `KindBar`, the title (14 px, 600), the detail (muted), the length.
  - On the right, per kind:
    - **Graphic:** Cue, Take, and "Edit fields" (toggles the session-edit panel; the existing `GraphicStage` field list moves here unchanged in behaviour, with "Reset edits").
    - **Song:** the `SongTakeStrip` segments Intro / Lyrics / Outro (restyled in Task 14) + Cue.
    - **Scripture:** Intro (if any) + Previous / Next / End scripture (WS2.7).
    - **Video:** `MediaTransportStrip size="lg"` when on air, else Take.
    - **Slides:** Cue / Take through `slidesRowTakeMessages` (hidden while the adapter returns null, with the text "Slides decks arrive with plan 3"). Above the strip, one notice line from `slidesStripNotice(row, view, channelStates)` when non-null (plan 3: end of deck, missing deck, skipped slides).
    - **Hotcard selection:** Cue / Take through `hotcardMessage`.
  - Quick take is a ghost toggle at the far right. `TakePanel` clears its fields when it's toggled off (WS1.14) and uses the labels Cue / Take.
- Pinned bar (WS2.3): when a program session or media is live for a row other than the selected one, a 28 px sticky bar sits above the strip: `On air: <title> · <slide label>`, with a "Show" ghost button that selects the live row.
- The text-overflow warning (WS2.13, D21 = warnings only):
  - After the selected graphic's thumbnail mounts, measure its text nodes (`[data-field-key]` in the mount) and pass them to `overflowSummary`.
  - Show a warn badge next to the field in the edit panel: `"<Label> doesn't fit: about <shown> of <total> characters shown"`.
  - Report the row id upward so the rundown row shows ⚠ (`warnRowIds`).
  - `templateHasVisibleText` false → the bar shows `Template "<name>" has no text layers`, and Take asks `useConfirm` first.
- `stageModeFor` stays the source for which item the region shows. The `song-live` mode now carries the selection, and the region shows the **selected** row's thumbnails. With no selection, it shows the live song's thumbnails.

- [ ] **Step 1: Write failing tests** for `textOverflow.ts`

```ts
it("overflowSummary estimates characters shown", () => expect(overflowSummary([{ key: "h", label: "Header", text: "x".repeat(35), scrollW: 700, clientW: 360, scrollH: 40, clientH: 40 }])[0]).toMatchObject({ shown: 18, total: 35, message: "Header doesn't fit: about 18 of 35 characters shown" }));
it("fitting text is not reported", () => expect(overflowSummary([{ key: "h", label: "H", text: "ok", scrollW: 10, clientW: 10, scrollH: 10, clientH: 10 }])).toEqual([]));
it("templateHasVisibleText looks inside groups and ignores hidden layers", () => { /* group{ text visible:false } → false; group{ text } → true */ });
```
  `shown = floor(total × min(1, clientW/scrollW) × min(1, clientH/scrollH))`.
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/textOverflow.test.ts`. Expected: FAIL, then implement and PASS.
- [ ] **Step 3: Typecheck and build.** Expected: PASS.
- [ ] **Step 4: Shoot `thumbs-song`** with a song selected and not live. Click thumb 3: `/health` shows the preview session at that slide, and program is unchanged. Take the song, then click thumb 4: program advances (`thumbs-song-live`, with `__out-pgm`). Select a lower third while the song is live (`thumbs-pinned`): the pinned bar is at y < 900 at 1440×900.
- [ ] **Step 5: Shoot `thumbs-scripture`, `thumbs-graphic-overflow`** (long L3 text: warn badge + ⚠ on the row), and `quick-take`.
- [ ] **Step 6: Commit** `feat(live): selected item as thumbnails; click rule; item bar; overflow warnings [LIVE-3, LIVE-5, LIVE-7, LIVE-9, LIVE-14, LIVE-24, LIVE-27, LIVE-29]`

---

### Task 14: Song and scripture take controls restyled  [P1-controls] (after Task 2)

**Files:**
- Modify: `apps/operator/src/app/components/SongModePanel.tsx`, `SongTakeStrip.tsx`, `ScriptureTakeStrip.tsx`

**Interfaces:**
- Produces:
  - `SongLiveBar({ channel, session })`, exported from `SongModePanel.tsx`. It replaces the 3-column grid: the song title, "Blank" (toggle, amber when on), "End song (Esc Esc)" (danger ghost; asks `useConfirm` first, the same as the second Esc press per D3), an `Auto-advance (STT)` `Switch`, and the STT strip. The section list and slide grid are removed (the thumbnail strip replaces them).
  - `SongTakeStrip` keeps its props. It is a `SegmentedControl`-style group of three buttons; a segment whose target channel is program uses `variant="onair"` (D5).
  - `ScriptureTakeStrip` keeps its props, with buttons "Intro", "Previous", "Next" and "End scripture". The per-slide buttons are removed (the thumbnails replace them).
- Copy: "End song (Esc Esc)", "Auto-advance (STT)", "Update" (was "Update Program").

- [ ] **Step 1: Typecheck and build.** Expected: PASS. Also run `rg -n 'Trust Mode|End Song|Update Program|variant="primary"' apps/operator/src/app/components/{SongModePanel,SongTakeStrip,ScriptureTakeStrip}.tsx`. Expected: no Program action uses `primary`, and none of the old strings remain.
- [ ] **Step 2: Shoot `song-live-bar`** at 1024 and 1280. No control overlaps (bounding boxes are disjoint), and the bar is ≤ 40 px tall.
- [ ] **Step 3: Commit** `feat(live): song live bar and take strips in the new controls [LIVE-5, LIVE-11 D5, LIVE-23]`

---

### Task 15: Right drawer: timers, stage, hotcards  [P1-controls] (after Task 1)

**Files:**
- Create: `apps/operator/src/app/components/live/LiveDrawer.tsx`, `apps/operator/src/app/hooks/useLivePrefs.ts`
- Modify: `TimersRail.tsx`, `TimerPanel.tsx`, `StageTimersSection.tsx`, `ActiveTimersPanel.tsx`, `StagePanel.tsx`, `HotcardsPanel.tsx` (all in `apps/operator/src/app/components/`)

**Interfaces:**
- Produces:
  - `useLivePrefs(): { drawerOpen: boolean; setDrawerOpen(b: boolean): void; doubleClickTakes: boolean; setDoubleClickTakes(b: boolean): void }`. It persists to localStorage `overlaysys:live:drawerOpen` (default true) and `overlaysys:live:doubleClickTakes` (default false, D4).
  - `LiveDrawer()`:
    - Open: 280 px wide with three collapsible sections, "Timers", "Stage" and "Hotcards". Each header is 28 px with a chevron, and the section's open state is persisted under `overlaysys:live:drawer:<id>`.
    - Collapsed: 40 px with three icon `IconButton`s (`Timer`, `MonitorSpeaker`, `Zap`; aria-labels "Show timers", "Show stage controls", "Show hotcards"). Clicking one opens the drawer at that section.
    - Footer: a "Double-click takes to program" `Switch` (D4).
  - F-keys keep working while the drawer is collapsed (handled in the hook, not the panel).
- Timers (WS2.9, WS2.10):
  - "+ New" becomes "+ Stage timer" and "+ Graphic timer".
  - The graphic-timer popover is titled "New graphic timer" and is anchored to the left of the drawer (`AnchoredPopover` with `placement="left"`), so it never overlaps the PGM monitor.
  - Buttons read Cue / Take (onair) / Clear. Labels read "Countdown" and not "countdown (countdown)".
  - The "Stage timers" heading is sentence case. Its form collapses behind "+ Stage timer", and running timers are listed first.
- Stage (WS2.16, D20 Live part):
  - "Follow PCO Live" is disabled when the show has no `sourceRef` rows, with the helper text "This show has no Planning Center items".
  - The live message reads "On stage: <text>", with `title` = the full text, an `IconButton` ✕ ("Clear stage message"), and the target display names.
  - When `stageLayoutPreviews` is non-empty, a warn row reads `"Stage layout preview is showing on <channel name>"`, with a "Stop preview" button. That button sends `{ type: "stage_layout_preview", channel, layout: null }`.
- Hotcards (WS1.12, WS1.13, WS1.16):
  - Take is `onair` and Cue is `secondary`, both routed by `hotcardMessage`.
  - The subtitle uses the UI font.
  - An image field shows a 48 px thumbnail via `resolveAssetUrl`, with no raw path.
  - Offline: last-known cards inside `<OfflineState variant="stale" onRetry={retry}>` (P1.6). Never "No hotcards yet".

- [ ] **Step 1: Typecheck and build.** Expected: PASS.
- [ ] **Step 2: Shoot `drawer-open`, `drawer-collapsed`, `timer-popover`.** Measure that the popover rect doesn't intersect the PGM monitor rect, and that the Create button isn't clipped at 1280.
- [ ] **Step 3: Shoot `drawer-stage-preview`** with a stage layout preview active (start it from the stage editor). The warn row is shown, and Stop clears `/health` previews.
- [ ] **Step 4: Shoot `drawer-offline`** with the server stopped.
- [ ] **Step 5: Commit** `feat(live): collapsible drawer for timers, stage and hotcards [LIVE-11 D5, LIVE-13, LIVE-17, LIVE-21, LIVE-25, LIVE-26, SS-4 (Live), D20 (Live part)]`

---

### Task 16: Live page assembly, shortcuts, show picker, palette commands  [P1-controls, P1-list] (after Tasks 2, 11–15)

**Files:**
- Modify: `apps/operator/src/app/page.tsx`, `apps/operator/src/app/hooks/useGlobalShortcuts.ts`, `apps/operator/src/app/components/ShowPicker.tsx`
- Create: `apps/operator/src/lib/liveCommands.ts` (+test)

**Interfaces:**
- Consumes: everything from Tasks 2 and 11–15; `LibraryList` (P1-list); `useToast`, `useConfirm` (P1).
- Produces:
```ts
type PaletteCommand = { id: string; label: string; group: "On air"; keywords: string[]; confirm: { title: string; message: string; confirmLabel: string }; messages(): ClientMessage[] };
function liveCommands(s: { channelStates; hotcards: HotcardMeta[]; hotcardCache: Record<string, Hotcard>; currentProjectId: string; show: Show | null }): PaletteCommand[];
```
  - `liveCommands` returns these commands (contracts §10), each with a `confirm` (D17c: never a silent take). The palette itself is P2b.24's; it maps them with `toPaletteEntry` and runs `confirm` before sending `cmd.messages()`. The palette defines no on-air verbs of its own.
    - `take-pvw` "Take preview to program" (`pvwTakeMessages`)
    - `clear-program` "Clear program"
    - `clear-preview` "Clear preview"
    - `clear-all` "Clear all outputs"
    - `hotcard-cue:<id>` "Cue hotcard <name>" (→ preview) and `hotcard-take:<id>` "Take hotcard <name>" (→ `hotcardRoute(hint, "take")`) for each card in the current project
- Page layout:
  - `PageChrome title="Live" context={<ShowPicker/>}`.
  - Grid columns: `300px minmax(0,1fr) auto` (drawer 280 / 40).
  - Centre column: `Monitors` + `AirControls` in one fixed grid row (`flex-shrink:0`) with `MonitorCaption`s under the monitors, then `StageArea` (scrolls).
  - Then `ConsoleBottomBar`.
  - The page title no longer reads "Show".
- Shortcuts:
  - **Unchanged:** F1–F12 hotcard, Shift+F cue (already routed), ↑/↓ select.
  - **Enter:** cue the selection (via Task 1 routes; scripture → `scripture_take_slide` preview slide 0; video → nothing).
  - **⌘Enter:** `pvwTakeMessages`.
  - **Space / Shift+Space (D2, separate commit):** when `keyMode` ≠ rundown, send `advanceMessage(mode, ±1)` (song, scripture and slides). Otherwise Space takes the selection as today (video toggles pause).
  - **B in slides mode:** `blankMessage("slides")` (adapter `slidesBlankMessage`). In song mode B stays "bridge" and `.` blanks.
  - **Esc (D3, separate commit):** `escPress`. The first press toasts "Press Esc again to clear program", or "Press Esc again to end song" in song mode, and sends nothing. The second press within 600 ms acts (`escapeMessages` / `song_end`).
  - **C/B/T and digits:** check `sectionAvailable` first. Missing → toast "No chorus in this arrangement" (kind-specific copy: "No bridge…", "No tag…", "No verse 3…"), and nothing is sent.
- Double-click a row: cue by default. With `doubleClickTakes` it takes (D4, separate commit).
- ShowPicker:
  - The "+" becomes a `List` icon button labelled "Shows". It opens a `Dialog` containing `LibraryList` over `showMetas` (sorts `date-desc` default, `name-asc`; `storageKey "live-show-picker"`; `onOpen` = switch show).
  - It keeps the "Switch show?" `useConfirm` when `anythingOnAir`. The message wraps, and its copy is `"<Show> is on air. Switching won't clear the outputs."`.
  - No count. Offline keeps the last show name dimmed.

- [ ] **Step 1: Write failing test** `liveCommands.test.ts`

```ts
it("every on-air command needs confirmation", () => expect(liveCommands(state).every((c) => c.confirm.confirmLabel.length > 0)).toBe(true));
it("lists hotcards of the current project only", () => expect(liveCommands(state).filter((c) => c.id.startsWith("hotcard-take:")).map((c) => c.label)).toEqual(["Take hotcard Welcome"]));
it("a hotcard cue goes to preview even with a default output", () => expect(liveCommands(state).find((c) => c.id.startsWith("hotcard-cue:"))!.messages()[0]).toMatchObject({ type: "cue", channel: "preview" }));
it("Take preview uses pvwTakeMessages", () => expect(liveCommands(stateWithSongOnPvw).find((c) => c.id === "take-pvw")!.messages()[0]!.type).toBe("song_take_pvw_to_pgm"));
```
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/liveCommands.test.ts`. Expected: FAIL, then implement and PASS.
- [ ] **Step 3: Typecheck, build, and `pnpm --filter operator build:cloud`.** Expected: PASS.
- [ ] **Step 4: Shoot `live-idle` at 1024/1280/1440/1920**, plus `live-esc-armed` (one Esc: the toast is visible and `/health` program is unchanged), `live-keys-scripture` (badge "Keys: Scripture"; Space advances scripture), and `live-show-picker`.
- [ ] **Step 5: Commit** in four commits:
  - `feat(live)!: Live page in option B layout; show picker; palette commands [LIVE-18, LIVE-20, LIVE-22, D17]`
  - `feat(live): Space/Shift+Space drive live scripture; keys badge [LIVE-9, D2]`
  - `feat(live): Esc twice to clear or end song [LIVE-10, D3]`
  - `feat(live): double-click cues; setting to take [LIVE-8, D4]`

---

### Task 17: Show editor shell: sectioned list, header, save model  [P1-controls, P1-sections, P1-tokens] (after Tasks 5, 11; P1.6, P1.7)

**Files:**
- Modify: `apps/operator/src/app/shows/edit/page.tsx`
- Create: `apps/operator/src/app/shows/edit/ShowHeader.tsx`, `ShowDetailsPane.tsx`
- Modify: `SermonNotesEditor.tsx`, `SongsInShowPanel.tsx` (restyle; moved into `ShowDetailsPane`)

**Interfaces:**
- Consumes: `RundownList mode="edit"` (Task 11); `showEditOps.*`, `nameForSave`, `canSave` (Task 5); `sendAndAwaitAck`, `ackErrorText`, `useConnection` (P1.6); `useUnsavedGuard` (P1.7); `addSection` (→ `{ show, section }`), `renameSection`, `deleteSection`, `moveRow`, `moveSection` (P1-sections); `SaveBar`, `useConfirm`, `useToast`, `useContextMenu` (P1); `slidesAddItemEnabled` (adapter) and `SlidesAddFlow` (`forms/SlidesItemForm.tsx`, Task 18).
- Produces:
  - Page layout: `grid-template-columns: minmax(320px, 38%) 1fr`. The left is `RundownList` in edit mode. The right is the selected item's form (Task 18), or `ShowDetailsPane` when nothing is selected or the "Show details" pseudo-row at the top of the list is selected.
  - `ShowHeader({ draft, onChange, dirty, saving, onSave, onRevert, onDelete, canSaveReason })`:
    - The name `Input` (flex, min 280 px).
    - "Service date" date input.
    - Muted `"<n> item(s) · Total M:SS"`.
    - `SaveBar` (⌘S).
    - A "⋯" menu with Duplicate and "Delete show" (danger, confirm `Delete "<name>"? This can't be undone.`).
    - No raw id.
  - `ShowDetailsPane`: Sermon notes sets (existing editor, restyled, with the hint "Each heading starts a new point. Without headings, each blank-line paragraph is a point.") and "Song defaults for this show" (`SongsInShowPanel` collapsed by default, its picker relabelled "Set show-wide defaults for a song…").
- Footer of the list: `+ Add item ▾` (a Menu with Graphic, Song, Scripture, Video, and "Slides", which is disabled with the reason "Needs Slides decks" while `slidesAddItemEnabled` is false and otherwise opens `<SlidesAddFlow open onClose onAdd>`) and `+ Section` (`addSection(draft, "", currentSectionId)`, then select and rename the returned `section`). New items go after the selection, in its section (`insertRowsAfter`).
- Section menu: Rename, "Delete section (keep its items)", and "Delete section and its N items" (danger; confirm). Both show a toast "Section deleted" with Undo, which restores the previous draft.
- Row menu: Duplicate, Move to section ▸ (submenu of sections), Delete (toast "Item deleted" with Undo via `restoreRow`).
- Save:
  - `save()` calls `sendAndAwaitAck(getClient(), { type: "save_show", show: {...draft, name: nameForSave(draft.name)} }, { op: "save_show", id })`. Only on resolve does the baseline move.
  - On reject: toast `` `Not saved: ${ackErrorText(e)}` `` (tone error), e.g. "Not saved: Not connected to the server.".
  - ⌘S runs only when `canSave().ok`.
  - Revert asks "Discard unsaved changes to this show?".
  - Cloud mode keeps its existing cloud save path.
  - `useUnsavedGuard` is kept.
- The project context ("Shows in Default Project") is dropped from the editor.

- [ ] **Step 1: Typecheck, build, `build:cloud`.** Expected: PASS.
- [ ] **Step 2: Shoot `show-editor-1440`** with sections. Drag a row from section 1 into section 2 (`show-editor-drag`, captured during dragover with the drop line visible). Save, reload, and check the row's `sectionId` changed and the row order in the saved JSON is as dragged.
- [ ] **Step 3: Disconnect test:** stop the server, edit, press ⌘S. "Unsaved" stays, and the toast reads "Not saved: Not connected to the server." (`show-editor-offline`).
- [ ] **Step 4: Round-trip check:** add `"futureKey": 1` to a show JSON file on disk and to one row. Open it, edit the name, save. Both keys are still in the file.
- [ ] **Step 5: Commit** `feat(shows)!: sectioned show editor with drag between sections, save on ack, undoable deletes [SHOWS-1, SHOWS-2, SHOWS-3, SHOWS-6, SHOWS-10, SHOWS-14, SHOWS-15, SHOWS-16, SHOWS-22, SHOWS-23, SHOWS-26, SHOWS-28]`

---

### Task 18: Show editor item forms with live thumbnail  [P1-controls, P1-thumb, P1-helpers] (after Task 17; P1.8)

**Files:**
- Create: `apps/operator/src/app/shows/edit/forms/ItemCommonFields.tsx`, `GraphicItemForm.tsx`, `SongItemForm.tsx`, `ScriptureItemForm.tsx`, `VideoItemForm.tsx`, `SlidesItemForm.tsx` (stub), `apps/operator/src/app/shows/edit/ItemPreview.tsx`, `SongPickerDialog.tsx`, `TemplateSelect.tsx`
- Modify: `apps/operator/src/app/shows/edit/ArrangementModal.tsx`, `SongOverrideEditor.tsx`, `apps/operator/src/app/components/ScriptureRowModal.tsx`, `ScriptureSlideEditor.tsx`, `ScriptureIntroEditor.tsx`, `VideoRowModal.tsx`, `VideoThumb.tsx`

**Interfaces:**
- Consumes: `templatesFor` (P1.8, with `recentIds`); `rankSongs`, `parseRowLength`, `lengthEcho` (Task 5); `thumbsFor` (Task 4) for preview data; `TemplateThumbnail` (P1-thumb); `sectionShortLabel` (Task 3); `ArrangementChips` (Task 20) is **not** imported. The song form has its own small chip list so 18 and 20 stay independent.
- Produces:
```tsx
type ItemFormProps<R> = { row: R; show: Show; onChange(next: R): void };
function GraphicItemForm(p: ItemFormProps<GraphicRow>): JSX.Element;
function SongItemForm(p: ItemFormProps<SongRow>): JSX.Element;
function ScriptureItemForm(p: ItemFormProps<ScriptureRow>): JSX.Element;
function VideoItemForm(p: ItemFormProps<VideoRow>): JSX.Element;
function SlidesItemForm(p: ItemFormProps<RowLike>): JSX.Element;   // placeholder: "Slides decks aren't available yet" (P3.16 replaces; contracts §9)
function SlidesAddFlow(p: { open: boolean; onClose(): void; onAdd(row: RowLike): void }): JSX.Element | null; // placeholder: null (P3.16 replaces)
function ItemCommonFields(p: { row: RowLike; onChange(patch: Partial<RowLike>): void; showSermonNotes: boolean; sets: SermonNotes[] }): JSX.Element; // Output, Length, Cue note, Sermon notes
function ItemPreview({ row, show }: { row: RowLike; show: Show }): JSX.Element;  // TemplateThumbnail width=360 of thumbsFor(row)[0]; poster for video
function TemplateSelect(p: { value: string; use: TemplateUse; onChange(id: string): void; label: string; recentIds?: string[] }): JSX.Element; // optgroups "Suggested" / "Other templates" via templatesFor(metas, use, recentIds)
function SongPickerDialog(p: { open: boolean; onClose(): void; onAdd(songIds: string[]): void }): JSX.Element;
```
- Form layout (mockup):
  - The form header reads `<Kind> · <template name>`.
  - Labelled rows use a `90px 1fr` grid.
  - The right column has `ItemPreview` at the top-right (46%), labelled "Live preview of this item". It re-renders as fields change.
- ItemCommonFields:
  - **Output:** `Select` with "Program (auto)" for unset, then the channel names.
  - **Length:** `Input` with placeholder "M:SS" and the `lengthEcho` hint. Invalid input gets a red border and "Use M:SS".
  - **Cue note:** `Textarea` with placeholder "Operator cue…", auto-growing 1–4 rows.
  - **Sermon notes:** only on graphic and scripture rows.
- **Graphic:** `TemplateSelect use="graphic"` (recent first), then fields via `FieldInput`. There is no slug.
- **Song:**
  - Song title (read-only) and "Change song…" (opens SongPickerDialog in single mode).
  - Lyric template (`TemplateSelect use="lyric"`).
  - "Arrangement for this item": chips with `sectionShortLabel` labels. Drag to reorder, × to remove, "+ section" menu, "Reset to song default".
  - Intro and outro overrides via the restyled `SongOverrideEditor` (selects max 320 px wide, resolved value chips "Intro: Song Intro (song)").
- **Scripture:**
  - Reference and translation, with "Change passage…" (opens `ScriptureRowModal` titled "Edit scripture", which keeps the row id, length and notes link).
  - `ScriptureSlideEditor` inline, `ScriptureIntroEditor`, and `TemplateSelect use="scripture"`.
  - The `ScriptureRowModal` fallback template is `templatesFor(metas,"scripture").suggested[0]`.
- **Video:**
  - `VideoRowModal` content inline: asset, label, end action, transitions, volume.
  - Length is prefilled from `durationSec` when unset.
  - `VideoThumb` shows `videoPosterUrl`.
  - The preview uses the caller's `resolveUrl`.
- SongPickerDialog:
  - Type-ahead over title, author and CCLI (`rankSongs`), recent first.
  - Checkbox multi-select; Enter toggles the focused row.
  - The button reads "Add N songs" and inserts them in the picked order via `insertRowsAfter`.
- "+ Graphic" opens a template choice using `TemplateSelect` grouping (WS3.5). A new row uses the last-used graphic template if there is one.

- [ ] **Step 1: Typecheck, build, `build:cloud`.** Expected: PASS.
- [ ] **Step 2: Shoot `show-form-graphic`, `show-form-song`, `show-form-scripture`, `show-form-video`** at 1440.
  - The preview updates within 500 ms of typing a field.
  - The cue field has `scrollWidth <= clientWidth`.
  - The Output select shows "Program (auto)" unclipped.
- [ ] **Step 3: Add 8 songs** with SongPickerDialog in ≤ 10 keystrokes or clicks (scripted), and shoot `show-song-picker`.
- [ ] **Step 4: Edit scripture** and change the passage. The row id is unchanged in the saved JSON.
- [ ] **Step 5: Commit** `feat(shows): item forms with live thumbnail, grouped template pickers, song picker [SHOWS-4, SHOWS-5, SHOWS-7, SHOWS-8, SHOWS-11, SHOWS-12, SHOWS-19, SHOWS-20, SHOWS-21, SHOWS-24, SHOWS-25, SHOWS-27]`

---

### Task 19: Reusable slide editor pieces (deck mode)  [P1-controls, P1-thumb, P1-tokens]

**Files:**
- Create: `apps/operator/src/app/songs/edit/slides/EditorFrame.tsx`, `SlideThumbGrid.tsx`, `SlideTextEditor.tsx`, `slideFields.ts`, `slideFields.test.ts`, `sectionColors.ts`, `sectionColors.test.ts`, `index.ts`

**Interfaces (contracts §9; plan 3 imports these from `@/app/songs/edit/slides` for the deck editor, P3.15):**
```tsx
type SlideCard = { id: string; templateId: string | null; data: Record<string, string>; caption?: string; group?: { label: string; color: string } | null; badge?: string };
function SlideThumbGrid(p: {
  slides: SlideCard[]; selectedId: string | null; onSelect(id: string): void;
  onReorder?(from: number, to: number): void; onAdd?(): void; addLabel?: string;        // "+ slide"
  menuItems?(id: string): MenuItem[]; minCardWidth?: number /* 200 */; emptyText?: string;
}): JSX.Element;
type SlideField = { key: string; label: string; multiline?: boolean };
function slideFieldsFor(template: Pick<Template, "fields"> | null | undefined): SlideField[];
  // template field order; type "text" → multiline: true; "time" / "number" → single line; color/image/video are not SlideFields
  // (the deck editor renders those with lib/FieldInput.tsx); null template → [{ key: "text", label: "Text", multiline: true }]
function SlideTextEditor(p: {   // multi-field: one input per SlideField, in order
  heading: string;                      // "Edit slide 1"
  fields: SlideField[]; value: Record<string, string>; onChange(next: Record<string, string>): void;
  budget?: SlideBudget;                 // LYRIC_SLIDE_BUDGET for songs
  autoFocus?: boolean;
}): JSX.Element;
function EditorFrame(p: { header: ReactNode; left: ReactNode; main: ReactNode; right?: ReactNode; leftWidth?: string /* "26%" */; rightWidth?: string /* "300px" */ }): JSX.Element;
// the song editor passes no `right`; the deck editor uses it for deck settings
const sectionKindColor: Record<SectionKind, string>;
function sectionChipTextColor(bg: string): string;   // "#111113" or "#ffffff", whichever has ≥ 4.5:1
```
- Section colours (no red or green, which carry air meaning): verse `#8b9cf8`, chorus `#f0a35e`, bridge `#c084fc`, tag `#2dd4bf`, intro `#94a3b8`, outro `#94a3b8`, other `#8e8e94`.
- `SlideTextEditor`:
  - Multiline fields are a `Textarea` in the sans UI font at 14 px, auto-sized to the content (2–8 rows).
  - Single-line fields are an `Input`.
  - Under a multiline field is a muted budget meter from `lyricSlideStats` ("3 lines · 96 characters"; warn colour over budget).
- `SlideThumbGrid`:
  - Cards are `TemplateThumbnail` (or a dark placeholder with the text's first line when `templateId` is null), 2 px `accent` border when selected.
  - The caption sits below as "Slide n" or `caption`. A group chip sits above.
  - Drag reorder is native.
  - The "⋯" per card is visible on hover, focus or selection; each card also opens the same menu on right-click.

- [ ] **Step 1: Write failing test** `sectionColors.test.ts`

```ts
it.each(Object.entries(sectionKindColor))("%s chip text has ≥ 4.5:1 contrast", (_k, bg) => expect(contrastRatio(sectionChipTextColor(bg), bg)).toBeGreaterThanOrEqual(4.5));
it("no section colour is the on-air red or the preview green", () => { for (const c of Object.values(sectionKindColor)) expect([colors.onair, colors.ok]).not.toContain(c); });
```
  `contrastRatio` is a WCAG relative-luminance helper defined in the test file.
  `slideFields.test.ts`:
```ts
it("text fields are multiline, time is single line, image and colour are skipped", () =>
  expect(slideFieldsFor({ fields: [{ key: "leader", label: "Leader", type: "text" }, { key: "bg", label: "Background", type: "image" }, { key: "t", label: "Time", type: "time" }] } as never))
    .toEqual([{ key: "leader", label: "Leader", multiline: true }, { key: "t", label: "Time", multiline: false }]));
it("no template gives one Text field", () => expect(slideFieldsFor(null)).toEqual([{ key: "text", label: "Text", multiline: true }]));
```
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/app/songs/edit/slides`. Expected: FAIL, then implement and PASS.
- [ ] **Step 3: Typecheck and build.** Expected: PASS.
- [ ] **Step 4: Commit** `feat(songs): reusable slide grid, multi-field slide editor and editor frame for songs and decks`

---

### Task 20: Song editor rebuild  [P1-controls, P1-helpers] (after Tasks 9, 19; P1.6, P1.7, P1.8, P1.11)

**Files:**
- Modify: `apps/operator/src/app/songs/edit/page.tsx`, `SongDraftEditor.tsx`, `FieldMappingTable.tsx`
- Create: `apps/operator/src/app/songs/edit/ArrangementChips.tsx`, `SectionsList.tsx`, `SongDetails.tsx`

**Interfaces:**
- Consumes: Task 9 ops; Task 19 pieces; `templatesFor` (P1.8); `sendAndAwaitAck`, `ackErrorText` (P1.6); `exportFileName` (P1.11); `SaveBar`, `useConfirm`, `useToast`, `Menu`, `SegmentedControl` (P1).
- Produces:
  - `SongDraftEditor({ draft, onChange, layout? }: { draft: Song; onChange: Dispatch<SetStateAction<Song>>; layout?: "frame" | "stacked" })`. The default is `"stacked"` (single column, used by `pco/page.tsx`, unchanged call site). The song page passes `"frame"`.
  - `ArrangementChips({ song, onChange })`:
    - Chips use `sectionKindColor` with `sectionShortLabel` text; the tooltip is `<label> · <first line>`.
    - Drag to reorder (`moveArrangementChip`).
    - × per chip (`aria-label="Remove <label> from arrangement"`).
    - A "+" menu lists every section with its first line.
  - `SectionsList({ song, selectedId, onSelect, onChange })`:
    - Each row shows the kind colour bar, the label, the slide count (right), and a "Not in arrangement" badge with "Add to end" when applicable.
    - Rows drag to reorder sections.
    - "+ Section ▾" opens a kind menu (`addSongSection`).
  - `SongDetails` is a collapsible "Details" group:
    - "Lyric template" (`templatesFor("lyric")`).
    - "Intro" and "Outro" templates (`templatesFor("title")`) with the `FieldMappingTable`. Its headers read "Template field" / "Filled with", there is no mono key, an `aria-label` per row, and "Literal value…" becomes "Custom text…".
    - "Default output": program-type channels, plus a "Stage" optgroup with the hint "Lyrics on a stage display only".
    - Author, CCLI number, Copyright.
    - "Custom fields", which asks for a label and derives the key with `slugifyTitle`.
- Page layout (frame):
  - Header: the title `Input` and the muted line "Song · CCLI n". Actions: "Paste lyrics…", "⋯" (Export via `exportFileName("song", draft)`, Import from file…), `SaveBar`. Keep the ⋯ items in one array literal: P3.20 adds "Convert to slide deck…" there in a marked block.
  - `?paste=1` (set by P1.13 after "New song") opens the paste panel focused on load.
  - Left (26%): ArrangementChips, then SectionsList, then SongDetails.
  - Main:
    - The selected section header: label `Input` (`uniqueLabel` on blur), kind `Select` (`setSectionKind`), "Delete section" `IconButton` (`Trash2`, `aria-label="Delete <label>"`; toast with Undo via `restoreSection`).
    - `SlideThumbGrid`: cards are the lyric template + `{text}`, the group chip is the section colour, and the menu has "Delete slide" with an Undo toast.
    - `SlideTextEditor`: `fields=[{key:"text",label:"Lyrics",multiline:true}]` and `budget=LYRIC_SLIDE_BUDGET`. Text maps to lines through `slideText`/`linesFromText`.
- Save:
  - ⌘/Ctrl+S saves (preventDefault). It is disabled with the reason "No changes to save" / "Not connected".
  - The ack is awaited with `sendAndAwaitAck(getClient(), { type: "save_song", song }, { op: "save_song", id })` (replacing the hand-rolled timer; keep `decideIncomingSong` and the conflict banner). Failure toasts `` `Not saved: ${ackErrorText(e)}` ``.
  - Revert asks "Discard unsaved changes to this song?". "Undo paste" stays.
  - Cloud paths are unchanged.
- Bad id: on `{type:"error", code:"not_found"}` for this id, show `"This song doesn't exist (it may have been deleted)."` with "Back to songs". If the id is in Recently deleted (the existing `libraryClient` deleted-songs list; local mode only), also show "Restore", which calls `restoreDeletedSong(id)`, toasts `Restored “<title>”` and reloads the editor (SONGS-6). With no `id`, `router.replace("/songs")`. Keep this not-found block as one component (`SongNotFound`) so P3.20 can add the converted-to-deck notice inside it.
- Every panel title is an `h2`.

- [ ] **Step 1: Typecheck, build, `build:cloud`.** Expected: PASS.
- [ ] **Step 2: Shoot `song-editor-1440`.** The first slide textarea is at y < 400. A 5-line slide has `scrollHeight <= clientHeight`. Chips are coloured, and no chip is red or green.
- [ ] **Step 3: Add a Bridge section.** It appears at the end of the arrangement chips. Delete a slide, then Undo, and it is back (`song-editor-undo`).
- [ ] **Step 4: Open `/songs/edit?id=nope`** (`song-editor-bad-id`): the message shows, and there's no spinner after 2 s. Delete a song from /songs, open its old editor link: "Restore" is offered and brings it back (`song-editor-restore`).
- [ ] **Step 5: Open the PCO import's song editor** (`/pco`, stacked layout) and shoot `pco-song-editor-stacked`. It renders without layout overflow (`scrollWidth <= clientWidth` on its container).
- [ ] **Step 6: Commit** `feat(songs)!: song editor with arrangement chips, sections list, slide thumbnails [SONGS-2, SONGS-5, SONGS-6, SONGS-8, SONGS-11, SONGS-12, SONGS-13, SONGS-14, SONGS-15, SONGS-16, SONGS-18, SONGS-19, SONGS-20, SONGS-21, SONGS-28, SONGS-32]`

---

### Task 21: Paste panel and import-from-file  [P1-controls] (after Task 8)

**Files:**
- Modify: `apps/operator/src/app/songs/PasteLyricsModal.tsx`, `apps/operator/src/app/songs/ImportFromFileModal.tsx`

**Interfaces:**
- Consumes: `parsePastedLyrics`, `detectLyricsFormat`, `parseSongImportJson` (Task 8); `Dialog`, `Button`, `Checkbox`, `FileDrop`, `useToast` (P1).
- Produces: unchanged props for both components (`PasteLyricsModal({song,onApply,onClose})`; `ImportFromFileModal` keeps its current props).
- Paste panel:
  - It focuses the textarea on open and closes on Esc (only when focus is inside the panel).
  - The toggle button label is "Close paste".
  - It shows a quiet "Format: ChordPro" / "Format: SongSelect" / "Format: Plain text" note.
  - Preview lists each section label + first line + slide count. `notice` shows as an info line, and `warnings` show in `danger` text.
  - "Also update title, author, CCLI number and copyright" is a `Checkbox`, shown for SongSelect and ChordPro.
  - "Replace song body" is primary.
- Import modal:
  - Fixed 560 px wide. The drop zone is plan 1's `<FileDrop accept=".txt,.cho,.chordpro,.chopro,.json" hint="Drop a SongSelect .txt, ChordPro .cho or song .json file, or browse" />` (no local file input).
  - It routes `.json` through `parseSongImportJson`.
  - Slug goes under an "Advanced" disclosure.
  - The duplicate prompt's secondary button reads "Back".
  - The preview shows the first line of each section.
  - After import, it opens the new song and toasts "Imported <title>".
  - The error copy is "Couldn't find any verses or choruses in this file."

- [ ] **Step 1: Typecheck and build.** Expected: PASS.
- [ ] **Step 2: Shoot `paste-chordpro`** (with the invented ChordPro fixture from Task 7), `paste-noheaders` (notice visible), `paste-empty-section` (red warning), and `import-modal` (560 px measured).
- [ ] **Step 3: Commit** `feat(songs): paste panel and file import in the new controls with ChordPro and JSON [SONGS-1 rest, SONGS-3, SONGS-4, SONGS-9, SONGS-10, SONGS-24, SONGS-29]`

### Task 22: Stage screens on Live and in every row's editor  [P1-controls] (after Tasks 15, 18; P1.22, P2b.33)

Spec "Stage screens choose their layout dynamically" (Live drawer and the item's "Stage screens" section). Contracts §16.

**Files:**
- Create: `apps/operator/src/lib/stageLayoutStatus.ts` (+test), `apps/operator/src/app/shows/edit/forms/StageScreensField.tsx`
- Modify: `apps/operator/src/app/components/StagePanel.tsx` (drawer Stage section), `apps/operator/src/app/shows/edit/forms/ItemCommonFields.tsx`

**Interfaces:**
- Consumes: `StageLayoutStatus`, `StageLayoutReason` (P1.22); messages `set_stage_layout` / `stage_layout_status` (P2b.33); stage channel configs and layout metas already in the store (read only; `store.ts` is not changed).
- Produces:
```ts
// stageLayoutStatus.ts — module-level cache fed by getClient().on("stage_layout_status"), so a late-mounted panel still has the last value
function useStageLayoutStatus(): StageLayoutStatus[];
function reasonLabel(reason: StageLayoutReason): string;   // "Manual" | "This item" | "Rule: song" | … | "Default"
function setStageLayoutMessage(channel: string, layoutId: string | null): ClientMessage;
// StageScreensField.tsx — used by every item form (and by plan 3's slides inspector, P3.22)
function StageScreensField(p: { value: Record<string, string> | undefined; onChange(next: Record<string, string> | undefined): void }): JSX.Element;
```
- Live drawer, Stage section: one line per stage screen — name, current layout name, a muted reason chip (`reasonLabel`), and a `Select` "Switch layout" whose first option is "Automatic" (sends `layoutId: null`). A manual pick shows the hint "Until the next item goes live".
- Row editors: `ItemCommonFields` gets a collapsible "Stage screens" section rendering `StageScreensField`: one row per stage screen, `Select` with "Use screen rules" (unset) then the layouts; clearing the last one removes the `stageLayouts` key (spread the row; no other key changes).

- [ ] **Step 1: Write the failing tests** (`stageLayoutStatus.test.ts`): `reasonLabel("rule:song") === "Rule: song"`; `setStageLayoutMessage("stage1", null)` deep-equals `{ type: "set_stage_layout", channel: "stage1", layoutId: null }`; the cache keeps the last `stage_layout_status` for a subscriber added later (fake client).
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/stageLayoutStatus.test.ts`. Expected: FAIL, then implement and PASS.
- [ ] **Step 3: Typecheck, build and `build:cloud`.** Expected: PASS.
- [ ] **Step 4: Shoot `drawer-stage-layouts`** (two stage screens, one on "Rule: song", one switched manually) and `show-form-stage-screens`. Take the next row: the manual screen returns to automatic.
- [ ] **Step 5: Commit** `feat(live): stage screens show their layout and reason; per-item stage layouts`

---

## Self-review notes

- **Spec coverage:**
  - Live option B: Tasks 12 (air zone), 11 (sectioned rundown), 13 (thumbnails below, click rule), 15 (right drawer), 16 (assembly).
  - Rows and sections: Tasks 3 and 11.
  - Show editor: Tasks 17 and 18.
  - Song editor and deck mode: Tasks 19 and 20.
  - Slides rows on Live and rundown via the adapter `lib/slidesRowView.ts` (contracts §9), with a placeholder until P3.13: Tasks 2, 3, 4, 11 and 13.
  - Save model everywhere: Tasks 17 and 20.
  - No `window.confirm`: every confirm uses `useConfirm`.
  - Fade to black is not in scope (spec).
- **Type consistency:**
  - `RowLike`, `RowViewCtx`, `ThumbCtx`, `AirState` (now including `"other-show"`) and `SlidesRowView` are defined once (Tasks 2–4) and used by name after that.
  - `monitorColumns()` loses its parameter in Task 12; both callers are in 2a.
  - `songCueChannel` keeps its signature.
- **Proportion:** UI tasks give props, values and copy, not bodies. Logic tasks give signatures and tests.

---

## Contract changes

Resolved in contracts §9 (slide editor pieces incl. `slideFieldsFor` and `EditorFrame.right`; the slides adapter `lib/slidesRowView.ts` and the `SlidesItemForm`/`SlidesAddFlow` handoff to plan 3), §10 (`liveCommands` for the palette), §16 (stage layout rules: Task 22), §7 (this plan's `awaitAck`, `useConnection` and `templatesFor` moved to P1.6/P1.8; `songExportFileName` replaced by `exportFileName`), §4 (`addSection` returns `{ show, section }`; song op renamed `addSongSection`), §1 (tuned text colours) and §15 (log). The ★ ownership claims, `packages/core/src/index.ts` append-only and the `VideoInput` request to P2b.9 are recorded in the execution-order doc's ownership tables. `sectionKindColor` stays in `songs/edit/slides/sectionColors.ts`.

---

## Appendix: Fix-plan coverage

Already on main (not re-planned): WS1.1 LIVE-1, WS1.2 LIVE-2, WS1.3 LM-2, WS1.4 LM-1, WS3.1 SHOWS-1, WS4.1 SONGS-1 (parser). The SONGS-1 paste warning remainder is in Tasks 7, 8 and 21.

**WS1**

| ID | Covered by |
|---|---|
| WS1.1 / LIVE-1 | done on main; Esc path kept in Task 16 |
| WS1.2 / LIVE-2 | done on main; ChannelPreview video kept in Task 12 |
| WS1.3 / LM-2 | done on main; the same rule is extended to rows in Task 1 |
| WS1.4 / LM-1 | done on main; F-keys kept in Tasks 15 and 16 |
| WS1.5 / LIVE-10 [D3] | Tasks 2 and 16 |
| WS1.6 / LIVE-9 keys [D2] | Tasks 2, 12 (badge) and 16 |
| WS1.7 / LIVE-22 | Tasks 2 and 16 |
| WS1.8 / LIVE-6 | Tasks 2 and 12 |
| WS1.9 / LIVE-31, LIVE-34 | Task 12 |
| WS1.10 / LIVE-14 | Tasks 2 and 12 |
| WS1.11 / LIVE-4 strip, LIVE-15 | covered by rebuild in Task 12 (vertical air controls) |
| WS1.12 / LIVE-11 [D5] | Task 15 |
| WS1.13 / LIVE-25 | Task 15 |
| WS1.14 / LIVE-29 | Task 13 |
| WS1.15 / LIVE-23 part | Tasks 13, 14 and 16 (copy) |
| WS1.16 / SS-4 Live hotcards | Task 15 |

**WS2**

| ID | Covered by |
|---|---|
| WS2.1 / LIVE-5 | covered by rebuild: the song grid is replaced by ThumbStrip (Task 13) and SongLiveBar (Task 14) |
| WS2.2 / LIVE-4 [D1] | Task 12 |
| WS2.3 / LIVE-7 | Task 13 (pinned bar) |
| WS2.4 / LIVE-27 | Tasks 12 and 13 (blur after click on all air and item buttons) |
| WS2.5 / LIVE-8 [D4] | Tasks 11 and 16 |
| WS2.6 / LIVE-12 [D19] | Tasks 3 and 11 |
| WS2.7 / LIVE-9 UI | Tasks 4, 13 and 14 (scripture thumbnails, Previous / Next / End) |
| WS2.8 / LIVE-11 [D5] | Tasks 14 and 15 |
| WS2.9 / LIVE-13 | Task 15 |
| WS2.10 / LIVE-17 | Task 15 |
| WS2.11 / LIVE-14 stage | Task 13 |
| WS2.12 / LIVE-6 card | Task 13 |
| WS2.13 / LIVE-3, LIVE-24 [D21 warnings only] | Task 13 |
| WS2.14 / LIVE-19 | Tasks 2 and 11 |
| WS2.15 / LIVE-18, LIVE-20, SS-4 Live | Tasks 11 and 16 |
| WS2.16 / LIVE-21, LIVE-26 | Task 15 |
| WS2.17 / LIVE-30 | Task 12 |
| WS2.18 / LIVE-33 | covered by rebuild: the next row in the rundown replaces Up next (Task 11) |
| WS2.19 / LIVE-23 rest | Tasks 3 (translation), 14 and 16 |

**WS3**

| ID | Covered by |
|---|---|
| WS3.1 / SHOWS-1 | done on main; guard kept in Task 17 |
| WS3.2 / SHOWS-2, SHOWS-28 | P1.6 (`sendAndAwaitAck`) and Tasks 5 and 17 |
| WS3.3 / SHOWS-10 | Tasks 5 and 17 |
| WS3.4 / SHOWS-3 | Tasks 5, 11 and 17 |
| WS3.5 / SHOWS-4, SHOWS-21 | P1.8 (`templatesFor`) and Task 18 |
| WS3.6 / SHOWS-5 | Tasks 5 and 18 |
| WS3.7 / SHOWS-7 [D15] | covered by rebuild in Tasks 11 and 18 (D15 superseded by spec) |
| WS3.8 / SHOWS-8 | Task 18 |
| WS3.9 / SHOWS-9 [D13] | Tasks 5, 11 and 17 |
| WS3.10 / SHOWS-6 [D15] | covered by rebuild in Task 17 (ShowDetailsPane) |
| WS3.11 / SHOWS-27 | Task 18 |
| WS3.12 / SHOWS-11, SHOWS-24 icon | Task 18; the `VideoInput` icon and `resolveUrl` preview are P2b.9 (editor-kit owner); the 404 is P1.21; "Choose from library" deferred (D22) |
| WS3.13 / SHOWS-12 | Task 18 |
| WS3.14 / SHOWS-13 | Tasks 10 and 17 (hint copy) |
| WS3.15 / SHOWS-14, SHOWS-15 | Task 17 |
| WS3.16 / SHOWS-16 | Tasks 5 and 17 |
| WS3.17 / SHOWS-17 | P1.12 (shows list page) |
| WS3.18 / SHOWS-19, SHOWS-20 | Task 18 |
| WS3.19 / SHOWS-22 (editor), SHOWS-23, SHOWS-24 spacing, SHOWS-25, SHOWS-26 | Tasks 11, 17 and 18 |
| SHOWS-18 | P1.9, P1.12 (LibraryList) |

**WS4**

| ID | Covered by |
|---|---|
| WS4.1 / SONGS-1 | done on main (parser); paste warning in Tasks 7, 8 and 21 |
| WS4.2 / SONGS-2 | Tasks 9 and 20 |
| WS4.3 / SONGS-3 | Tasks 7 and 21 |
| WS4.4 / SONGS-4 | Tasks 7, 8 and 21 |
| WS4.5 / SONGS-10 | Task 8 |
| WS4.6 / SONGS-6 | Task 20 (bad id, with Restore when the song is in Recently deleted) |
| WS4.7 / SONGS-8, SONGS-20 | P1.8 (`templatesFor`) and Task 20 |
| WS4.8 / SONGS-5 | Tasks 9 and 20 |
| WS4.9 / SONGS-16, SONGS-9 | Tasks 8 and 20 (`exportFileName`, P1.11); the list page export is P1.13 |
| WS4.10 / SONGS-11 [D16] | covered by rebuild in Task 20 (D16 superseded) |
| WS4.11 / SONGS-12, SONGS-13, SONGS-15 | Tasks 9 and 20 |
| WS4.12 / SONGS-14 | Tasks 19 and 20 |
| WS4.13 / SONGS-18, SONGS-19, SONGS-21 | Task 20 |
| WS4.14 / SONGS-22, SONGS-23, SONGS-25, SONGS-26, SONGS-27, SONGS-31 | P1.13 (songs list page) |
| WS4.15 / SONGS-24 | Task 21 |
| WS4.16 / SONGS-28, SONGS-29, SONGS-30, SONGS-32 | Tasks 20 and 21; SONGS-30 (Recently deleted modal) is P1.13 |

**Other IDs in these areas**

| ID | Covered by |
|---|---|
| SONGS-7, SONGS-17, SONGS-33 | P1.13 (list offline state), P1.7 (guard dialog), P1.5 (Dialog behaviour) |
| LIVE-15, LIVE-16 | P1.1, P1.2 (Button, status labels); the call sites are rebuilt in Tasks 12, 14 and 15 |
| LIVE-28, LIVE-32 | P1.21 (dev asset proxy, dev badge) |
| LIVE-35 | P1.5 (Dialog) |

**Decisions**

| Decision | Covered by |
|---|---|
| D1 | Task 12 |
| D2 | Tasks 2 and 16 |
| D3 | Tasks 2, 14 and 16 |
| D4 | Tasks 15 and 16 |
| D5 | Tasks 11, 12, 14 and 15 |
| D13 | Task 5 |
| D17 | Task 16 (`liveCommands`, contracts §10); P2b.24 (palette) |
| D19 | Task 3 |
| D20 | Task 15 (the Live warning and Stop preview); the renderer corner tag is 2b WS6.16 |
| D21 | Task 13 (warnings only, no auto-shrink) |
| Controller addition (row Cue → preview) | Task 1 |
