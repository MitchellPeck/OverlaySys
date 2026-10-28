# Redesign 2b: designers, settings, shell and library pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the graphics designer, the stage layout designer and stage output, every Settings page, the shell, and the hotcard editor, /pco, /data, /projects and the Companion module in the new look, and ship the functional fixes from fix-plan workstreams WS5–WS8 with them.

**Architecture:** Screens are rebuilt on plan 1's `@overlaysys/ui` kit (tokens, Button, NumberInput, SegmentedControl, Switch, Menu, `useConfirm`, `useToast`, SaveBar, TemplateThumbnail). All behaviour goes into small pure helpers next to the screen that uses it, with Vitest tests. Pages and editors stay thin. Settings pages share one draft/save model (`useSettingsDraft` + SaveBar + `useUnsavedGuard`) and plan 1's one page width model (`PageBody variant`, contracts §7). The designer's "Preview on PVW" goes through a new server draft registry that only the `preview` channel can show.

**Tech Stack:** Next.js operator (React 19, zustand), Vite renderer, Fastify + ws server, zod schemas in `@overlaysys/core`, GSAP 3.15 template engine, Companion module (`@companion-module/base`), Vitest (node env, no DOM), Playwright screenshots via `uxreview/lib.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md`. The names come from `docs/superpowers/plans/2026-10-28-redesign-contracts.md` (this plan owns §8 and §14, and `PageChrome`'s `docTitle` in §7). Execution order, cross-plan dependencies, file ownership and the shared-file rule: `docs/superpowers/plans/2026-10-28-redesign-execution-order.md`. The fix plan is `<scratch>/uxreview/FIX-PLAN.md`, and the findings are in `<scratch>/uxreview/findings/*.md`.
`<scratch>` = `/private/tmp/claude-501/-Users-mitchellpeck-WebstormProjects-OverlaySys/d399ff93-4d07-4c2a-8df1-56307d1cb584/scratchpad`.

## Global Constraints

- Everything below is ready for **Sunday 2026-11-01**.
- Palette and colour come only from plan 1 tokens (`colors.*`, the CSS vars in contracts §1). Add no new hard-coded colours in operator UI.
  - Red (`onair`) means program/live only.
  - Green (`ok`) means preview/next.
  - Blue (`accent`) means selection and primary actions.
  - Stage output (`packages/stage-widgets`) and template content are output graphics. They keep their own colours.
- Use the plan 1 controls everywhere: Button, IconButton, Input, Textarea, Select, NumberInput, SegmentedControl, Switch/Checkbox, FileDrop, Menu, Dialog/`useConfirm`, Toast/`useToast`, Tooltip, SaveBar, OfflineState. Use plan 1's operator helpers (contracts §7): `sendAndAwaitAck`/`requestOne`/`ackErrorText` (`lib/awaitAck.ts`), `useConnection` (`lib/useConnection.ts`), `templatesFor`/`templateRole`, `PageBody variant`.
  - No browser-default controls.
  - No `window.confirm`, `window.prompt` or `alert`.
- Save model everywhere (spec, D9):
  - an unsaved dot, Save (⌘S) and Revert through `SaveBar`;
  - `useUnsavedGuard` on every editor and settings page;
  - no autosave on settings;
  - Save is disabled offline with `disabledReason: "Reconnect to save"`.
- Text is 11–13 px UI type in sentence case. Follow the glossary (Task 22, D11):
  - Cue / Take / Clear.
  - "show" and "rundown".
  - "template" (one graphic).
  - "Designs" with the tabs "Graphics" and "Stage layouts".
  - "stage layout" and "stage monitor".
  - "Sermon notes".
  - "Speech-to-text" ("STT" only in the compact status pill).
  - "Auto-advance (STT)".
  - "Live" (the nav tab and the page title).
- Never show an id as visible text. Offer "Copy id" in a menu or tooltip only (T5).
- Hit targets are ≥ 24 px (28 px for icon buttons). Every icon-only control has an `aria-label` that names its object ("Delete Verse 1").
- Data safety:
  - Schema changes are additive and optional.
  - Existing templates, stage layouts, hotcards, settings and shows open and render unchanged. The exceptions are the D8 built-in stage layouts (Task 13) and custom bezier eases, which are broken today (Task 5).
- Don't change `packages/ws-protocol`, `apps/operator/src/lib/wsClient.ts` or `server/src/ws.ts`. Edits to shared files (`server/src/index.ts`, `templates.ts`, `channels.ts`, `pco/importPlan.ts`) follow the shared-file rule: additive, in a marked block, in the merge order of the execution-order doc.
- The Companion module stays compatible with existing button configs: add choices and actions, never rename action/feedback ids or option ids.
- Never type or paste real song lyrics. Use placeholders ("Line one of verse one").
- Logic gets a Vitest test next to the file (`pnpm vitest run <path>`). UI is verified by `pnpm --filter @overlaysys/operator typecheck`, `pnpm --filter @overlaysys/operator build`, and a screenshot of the running app. The operator runs at http://localhost:3000 and the renderer at http://localhost:3001. Use `<scratch>/uxreview/lib.mjs` (`open`, `shot`) and save to `shots/after/2b/<name>.png` at 1440×900 unless a task says otherwise.
- On the shared dev stack, use `preview` or the `stage-review` channel. Never take test graphics to `program`.
- Don't commit plan files. Each task makes one commit whose message lists its finding IDs. `[Default Dn]` work goes in its own commit.

## Review Focus

1. **"Preview on PVW" while the operator has something real cued, or Take pressed while the draft is on PVW.** Expect a confirm before a real cue is replaced, and expect a draft never to reach program or any non-preview channel. The test goes in Task 11 (`refuses draft templates on any channel but preview`, `draftPreviewDecision → confirm-replace`).
2. **A settings save that fails or happens offline.** Expect the draft to stay dirty with the error shown, and Save disabled with "Reconnect to save" while disconnected. The test goes in Task 3 (`saveFail keeps the draft dirty`, `saveBarProps offline`).
3. **Stage layouts and templates stored before this plan.** Expect them to parse and render exactly as before: a stored timer still has `showLabel: false`, and the new caption/overtime props are absent. Only the three built-ins change (D8). The test goes in Task 13 (`stored layout from before 2b parses unchanged`).
4. **Re-importing a PCO plan after the operator edited a linked song's row arrangement.** Expect the operator's edit to be kept and the library song never to be saved. The test goes in Task 27.
5. **An existing Companion button config after the module update.** Expect every old action, feedback and option id to still exist, and old option values to stay valid choices. The test goes in Task 30 (`keeps every action id from before 2b`).

---

## File Structure

### Owned by this plan (create or modify)

**Shell and shared settings infrastructure**
- `apps/operator/src/app/shell/`:
  - `connectionView.ts` (+test). Pure: what the disconnected banner says. (`OfflineState`/`offlineCopy` and `useConnection` are plan 1's, P1.6.)
  - `ConnectionBanner.tsx`: Retry and Details.
  - `PageChrome.tsx`: `docTitle`, with `docTitle.ts` (+test). (The page width model is plan 1's `PageBody variant`, P1.1.)
  - `areas.ts` (+test): the glossary labels, `showsProjectSwitcher`, and the Library "Slides" entry for plan 3 (contracts §13).
  - `SubNav.tsx`: labels at all widths.
  - `TopBar.tsx`: Live tab colour, ⌘K button, switcher scope.
  - `AppShell.tsx`: skip link.
  - `StatusBar.tsx` and `StatusPopoverButton.tsx`: the popover layout.
  - `DesktopEventToasts.tsx`: uses `toast()`.
  - `CommandPalette.tsx`, `fuzzyMatch.ts` (+test) and new `paletteEntries.ts` (+test).
  - `glossary.test.ts`: banned-copy scan of the owned dirs.
- `apps/operator/src/app/not-found.tsx` (new).
- `apps/operator/src/app/settings/`:
  - `settingsDraft.ts` (+test) and `useSettingsDraft.ts` (new): the shared save model.
  - `page.tsx`.
  - `channels/**`, plus new `channels/channelDraft.ts` (+test).
  - `stage/**`, `stt/**`, `scripture/**`, `integrations/**`, `connection/**`.
- `apps/operator/src/app/account/**`.
- `apps/operator/src/lib/{scriptureSettings.ts, scriptureClient.ts, stageSettingsClient.ts}`.

**Graphics designer**
- `apps/operator/src/app/design/edit/`:
  - `page.tsx`, split into `DesignerHeader.tsx`, `DesignerLayout.tsx`, `PreviewOnPvwButton.tsx` and `HelpPopover.tsx`;
  - `designerKeys.ts` (+test);
  - `timelineSize.ts` (+test);
  - `draftPreview.ts` (+test);
  - `templateUsage.ts` (+test).
- `packages/editor-kit/package.json` (adds `@overlaysys/ui`).
- `packages/editor-kit/src/index.ts`.
- `packages/editor-kit/src/`: `Canvas.tsx`, `PropertyInspector.tsx`, `LayerTree.tsx`, `TimelinePanel.tsx`, `FieldsPanel.tsx`, `ColorInput.tsx`, `FontInput.tsx`, `EasingPicker.tsx`, `GradientStops.tsx`, `ImageInput.tsx`, `VideoInput.tsx`, `canvasView.tsx`, `templateOps.ts`, `utils.ts`.
- New in `packages/editor-kit/src/`:
  - `numberFormat.ts` (re-exports `roundTo`/`formatNumber` from `@overlaysys/ui`), `geometryCommit.ts` (+test), `FieldRow.tsx`;
  - `FontWeightSelect.tsx` with `fontWeights.ts` (+test);
  - `timelineRuler.ts` (+test), `timelineLabels.ts` (+test).
- `packages/template-engine/src/gsap-timeline.ts`, plus new `cubicBezier.ts` and `gsap-timeline.test.ts`.
- `apps/operator/src/lib/editorStore.ts`.
- Server, new files:
  - `server/src/templateRoutes.ts` (+test): usage and draft preview.
  - `server/src/templateDrafts.ts` (+test).
  - `server/src/templateUsage.ts` (+test) — the single template-usage helper (contracts §8); plan 1's Designs list consumes it.

**Stage**
- `apps/operator/src/app/design/stage/**`.
- `packages/editor-kit/src/`: `StageCanvas.tsx`, `StageInspector.tsx`, `StagePalette.tsx`, `StageWidgetList.tsx`, `stageInspectorLogic.ts`, `stageGeometry.ts`, `stageCanvasMath.ts`.
- `packages/stage-widgets/**`, including new `captionStyle.ts` (+test) and `timerOvertime.ts` (+test).
- `packages/core/src/stageLayout.ts` (+test).
- `apps/operator/src/lib/stage*.ts`: `stageLayoutOps`, `stageEditorStore`, `stageLayoutPicker`, `stageDesigner` (except the guard helpers WS0 named), `stageMode`.
- `apps/renderer/src/**`, including new `stagePreviewTag.ts` (+test).

**Library integrations**
- `apps/operator/src/app/hotcards/edit/**`, plus new `hotcards/edit/hotcardDraft.ts` (+test).
- `apps/operator/src/app/pco/**`:
  - `page.tsx`, split into `PcoConnectForm.tsx`, `PcoPlanPicker.tsx`, `PcoItemList.tsx`, `PcoItemRow.tsx` and `PcoImportFooter.tsx`;
  - new `pcoItemGroups.ts` (+test) and `importOptions.ts` (+test).
- `apps/operator/src/app/data/**`:
  - `data/planImport.ts` (+test);
  - `data/bundleDuplicates.ts` (+test).
- `apps/operator/src/app/projects/**`, plus new `projects/fieldKey.ts` (+test) and `projects/projectsList.ts` (+test) — `/projects` moves to `LibraryList` (then P1.16 deletes `ManagementList`).
- `apps/operator/src/lib/{csv.ts, pcoClient.ts, pcoFieldRefill.ts}`.
- `server/src/pco/**`, except the header→section mapping inside `importPlan.ts` (P1.19) and plan 3's additive slides blocks in `importPlan.ts`/`routes.ts` (P3.11). New `server/src/pco/linkedArrangement.ts` (+test).
- `packages/companion-module/**`.

### Edits in shared files (one or two lines each; shared-file rule, execution-order doc)
- `server/src/index.ts`: one line, `await registerTemplateRoutes(app);` (Task 12).
- `server/src/templates.ts`: in `getTemplate`, fall back to `getDraftTemplate(id)` (Task 11; after P1.8's meta change).
- `server/src/channels.ts`: one guard that refuses a draft template on any channel except `preview` (Task 11; after P3.5's slides hooks).
- `pnpm-lock.yaml`: the workspace dependency added in Task 4 (regenerated by `pnpm install`; after P1.2).
- Shell components assigned to this plan: `apps/operator/src/app/components/{AccountMenu.tsx, CloudSignInButton.tsx, ProjectSwitcher.tsx, SyncStatusPill.tsx}` and `apps/operator/src/app/timer/page.tsx` (Tasks 22, 23).

### Consumed (plan 1; don't edit)
`@overlaysys/ui`: tokens, `kindColor`, Button, IconButton, Input, Textarea, Select, NumberInput (with `precision`), `roundTo`, `formatNumber`, SegmentedControl, Switch, Checkbox, FileDrop, `acceptsFile`, Menu, `useContextMenu`, Dialog, `useConfirm`, Toast, `useToast`, Tooltip, SaveBar, OfflineState, `offlineCopy`, LibraryList. Also `apps/operator/src/lib/thumbnails/TemplateThumbnail.tsx`, `apps/operator/src/lib/useUnsavedGuard.ts` (P1.7), `lib/awaitAck.ts` and `lib/useConnection.ts` (P1.6), `lib/templateRoles.ts` (P1.8), `PageBody variant` (P1.1), `RowSourceRef.pcoArrangement` (P1.17), and plan 1's PCO header→section import (P1.19). From plan 2a: `liveCommands` (P2a.16, contracts §10).

---

## Parallel groups and dependencies

Plan 1 milestones referenced below (cross-plan waves: execution-order doc):
- **P1-kit**: contracts §1 and §2 are merged (P1.1–P1.7; the save/connection kit is P1.6).
- **P1-thumb**: §5 is merged (P1.10).
- **P1-pco**: the header→section import change in `importPlan.ts` is merged (P1.19), and `pcoArrangement` (P1.17).

| Group | Tasks | Waits for |
|---|---|---|
| A (start now) | 2, 5, 15, 30 | nothing |
| A″ | 13 | P1.8 (`stageLayout.ts` meta merge first) |
| A′ (after P1-kit) | 1, 3, 4, 12, 22, 24, 28 | P1-kit (24's on-air commit also waits for P2a.16) |
| Designer chain | 6 → 7 → 8 → 9 → 10 → 11 | 4 (and 12 before 11) |
| Stage | 14 (after 13), 16 (after 4, 13) → 17 (after 16, 3) | as listed |
| Settings | 18, 19, 20, 21 (each after 1, 2, 3) | as listed |
| Shell | 23 (after 22) | 22 |
| Library | 25 (after 3, P1-thumb), 26 (after P1-pco), 27 (after P1-pco), 29 (after 1, 2, P1.9) | as listed |
| Companion | 30 → 31 → 32 → 34 | 34 also after 33 |
| Stage layout rules | 33 | P1.22, P3.4, P3.10 |

**Plan 3's Companion slides actions (P3.21) go after Task 32**, because Tasks 30–32 rewrite `actions.ts`, `presets.ts`, `feedbacks.ts` and `HELP.md`. Plan 3 regenerates the HELP tables with Task 32's generator.

**Plan 3's PCO "Import as Slides" (P3.19) goes after Task 26.** It adds a `"slides"` option in `pco/importOptions.ts` and its picker inside `PcoItemRow.tsx`, in marked blocks.

**Plan 1 waits on this plan in three places:** P1.14 (Designs list) uses Task 12's usage helper and links to Task 17's `/design/stage/edit?new=1`; P1.15 (Hotcards list) links to Task 25's `/hotcards/edit?new=1`; P1.16 deletes `ManagementList` after Task 29 moves `/projects` off it.

---

## Task 1: Connection banner with Retry

[SS-4 banner, SS-24 banner colour; T3] [after P1-kit, P1.6]

`useConnection` and `OfflineState` are plan 1's (P1.6, contracts §7 and §2); this task consumes them and owns only the banner.

**Files:**
- Create: `apps/operator/src/app/shell/connectionView.ts`, `connectionView.test.ts`
- Modify: `apps/operator/src/app/shell/ConnectionBanner.tsx`

**Interfaces:**
- Consumes: `useConnection(): { connected; conn; retry }` (P1.6); `OfflineState`, `offlineCopy` (P1.6).
- Produces: `connectionView(conn: WsStatus, notOpenSinceMs: number, nowMs: number): { show: boolean; title: string; detail: string }` (banner only).

- [ ] **Step 1: Write the failing test** in `connectionView.test.ts`:
  - `connectionView("open", 0, 99999).show === false`.
  - `connectionView("closed", 0, DISCONNECTED_GRACE_MS - 1).show === false`.
  - `connectionView("closed", 0, DISCONNECTED_GRACE_MS + 1)` deep-equals `{ show: true, title: "Can't reach the OverlaySys server. Takes are not being sent.", detail: "Retrying automatically." }`.
  - `"connecting"` past grace gives detail `"Reconnecting…"`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/shell/connectionView.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `connectionView` in `connectionView.ts`, reusing `shouldShowDisconnected` from `shellStatus.ts`. Then rewrite the banner:
    - background `colors.danger`, white text;
    - buttons `Button size="sm" variant="secondary"` "Retry now" (calls `useConnection().retry`) and "Details";
    - Details is a Tooltip/popover showing the server URL (`defaultServerUrl()`) and "Last connected <relative time>" (`formatRelative`, P1.11).
- [ ] **Step 4:** Run the test. Expected: PASS. Then run `pnpm --filter @overlaysys/operator typecheck`.
- [ ] **Step 5: Screenshot.** Stop the server, open http://localhost:3000/settings/channels, wait 3 s, and save `shots/after/2b/disconnected-banner.png`. Look for: the banner is the danger fill, "Retry now" is visible, and clicking it changes the detail to "Reconnecting…".
- [ ] **Step 6: Commit.** `feat(shell): disconnected banner with Retry [SS-4, SS-24]`

## Task 2: Document title

[SS-25, LM-33; T12] (the width part of SS-1/SS-12 is P1.1's `PageBody variant`; this plan's pages adopt it)

**Files:**
- Create: `apps/operator/src/app/shell/docTitle.ts`, `docTitle.test.ts`
- Modify: `apps/operator/src/app/shell/PageChrome.tsx`

**Interfaces:**
- Consumes: `PageBody({ variant: "form" | "wide" | "list" })` (P1.1, contracts §7): form 760, wide 1100, list full width, all left-aligned with padding 24 and gap 16. There is no `PageFrame`; every later task that says `PageBody variant=…` means this.
- Produces:
  - `composeDocTitle(docTitle?: string, title?: unknown): string`.
  - `PageChrome` gains `docTitle?: string`.

- [ ] **Step 1: Write the failing tests:**
  - `composeDocTitle(undefined, "Channels") === "Channels · OverlaySys"`.
  - `composeDocTitle("Edit Section Intro", <ReactNode>) === "Edit Section Intro · OverlaySys"`.
  - `composeDocTitle(undefined, undefined) === "OverlaySys"`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/shell/docTitle.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `PageChrome` sets `document.title = composeDocTitle(docTitle, title)` in its effect and restores `"OverlaySys"` on unmount.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(shell): document titles [SS-25, LM-33]`

## Task 3: Settings save model (`settingsDraft`, `useSettingsDraft`)

[D9; T1, T2; SS-6 (model), STAGE-33 (model)] [after P1-kit: P1.6, P1.7]

**Files:**
- Create: `apps/operator/src/app/settings/settingsDraft.ts`, `settingsDraft.test.ts`, `useSettingsDraft.ts`

**Interfaces:**
- Consumes: `SaveBar` props `{ dirty; saving; onSave; onRevert; disabledReason? }` (contracts §2); `useUnsavedGuard(dirty, opts)` (P1.7); `useConnection` (P1.6); `sendAndAwaitAck`, `requestOne`, `ackErrorText` (P1.6, contracts §7 — this plan creates no `awaitAck`). WebSocket-saved settings call `sendAndAwaitAck(getClient(), message, { op, id? })`; `match.id` is optional for ops without an id (e.g. `stt_spawner_save_config`).
- Produces:
  - Draft state: `type DraftState<T> = { saved: T | null; draft: T | null; saving: boolean; error: string | null }`.
  - Reducer: `draftReducer<T>(s, a)`, with actions `{type:"loaded", value}`, `{type:"edit", value}`, `{type:"saveStart"}`, `{type:"saveOk", value}`, `{type:"saveFail", error}` and `{type:"revert"}`.
  - `isDirty<T>(s, equal = deepEqual): boolean`.
  - `saveBarProps(s, { connected, equal, invalidReason? }): { dirty; saving; disabledReason? }`.
  - The hook: `useSettingsDraft<T>({ load(): Promise<T>; save(v: T): Promise<T>; equal?(a,b): boolean; validate?(v): string | null; needsServer?: boolean = true })`. It returns `{ value: T | null; set(v: T | ((p: T) => T)): void; bar: SaveBarProps; error: string | null; loading: boolean; reload(): void }` and installs `useUnsavedGuard(dirty)`.

- [ ] **Step 1: Write the failing tests** in `settingsDraft.test.ts`:
    - `loaded → edit` makes `isDirty` true.
    - `edit` back to the saved value makes `isDirty` false (deep equal, key order ignored).
    - `saveStart → saveOk(v)` sets `saved = draft = v` and `isDirty` false.
    - **`saveFail keeps the draft dirty`:** after `edit, saveStart, saveFail("boom")`, the draft is unchanged, `error === "boom"` and `isDirty` is true.
    - `revert` restores `saved`.
    - **`saveBarProps offline`:** `connected:false` gives `disabledReason === "Reconnect to save"`.
    - `invalidReason "Preset 2 is empty"` takes precedence when connected.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/settings/settingsDraft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The hook sends `edit` on `set`, and `onSave` runs `validate`, then `save`, then `saveOk`/`saveFail(ackErrorText(e))`. Success shows `toast({ tone: "ok", message: "Saved" })`, and failure shows `toast({ tone: "error", message: \`Not saved: ${ackErrorText(e)}\` })`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(settings): shared draft/save model with SaveBar and leave guard [D9]`

## Task 4: editor-kit on the UI kit: number formatting, FieldRow, FontWeightSelect

[GD-3, GD-11 (weight), GD-21, STAGE-11 (dependency), STAGE-14, STAGE-15 (weight); T8, T9] [after P1-kit]

**Files:**
- Modify: `packages/editor-kit/package.json` (add `"@overlaysys/ui": "workspace:*"`, then `pnpm install`), `packages/editor-kit/src/index.ts`
- Create: `packages/editor-kit/src/numberFormat.ts` (re-export only), `FieldRow.tsx`, `fontWeights.ts`, `fontWeights.test.ts`, `FontWeightSelect.tsx`

**Interfaces:**
- Produces:
  - `numberFormat.ts`: `export { roundTo, formatNumber } from "@overlaysys/ui";` — plan 1 owns the implementation and its tests (P1.3, contracts §2, including half-away-from-zero rounding and `0.30000000000000004 → "0.3"`). editor-kit keeps the import path so its callers don't change.
  - `<FieldRow label: string; hint?: string; children: (id: string) => ReactNode />`. It renders a `<label htmlFor={id}>` using `useId()`, with an 80 px label column at 11 px `textDim`.
  - `FONT_WEIGHTS: { value: number; label: string }[]`, Thin 100 … Black 900.
  - `fontWeightOptions(available?: number[]): typeof FONT_WEIGHTS`.
  - `<FontWeightSelect value onChange available? />` built on the kit `Select`.
  - All exported from `index.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `fontWeightOptions([400, 700]).map(o => o.label)` deep-equals `["Regular 400", "Bold 700"]`.
  - `fontWeightOptions()` has 9 entries.
- [ ] **Step 2:** Run `pnpm vitest run packages/editor-kit/src/fontWeights.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests, then `pnpm --filter @overlaysys/operator typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(editor-kit): depend on @overlaysys/ui; number formatting, FieldRow, FontWeightSelect [GD-3, GD-21, STAGE-14]`

## Task 5: Custom bezier easing plays on output

[EXTRA-1]

**Files:**
- Create: `packages/template-engine/src/cubicBezier.ts`, `packages/template-engine/src/gsap-timeline.test.ts`
- Modify: `packages/template-engine/src/gsap-timeline.ts:5-10`

**Interfaces:**
- Produces:
  - `cubicBezierEase(x1, y1, x2, y2): (t: number) => number`. This is the CSS solver: Newton–Raphson for 8 iterations with bisection as a fallback, epsilon 1e-6. It returns exactly 0 at t ≤ 0 and 1 at t ≥ 1.
  - `easingToGsap(e: EasingSpec): string | ((t: number) => number)`. It is exported for the test.

- [ ] **Step 1: Write the failing tests:**
  - `[0,0,1,1]` is linear at 0.25, 0.5 and 0.75 (±1e-3).
  - `[0.42,0,0.58,1]` gives 0.5 at 0.5 (±1e-3) and 0.1291 at 0.25 (±2e-3).
  - The overshoot curve `[0.68,-0.55,0.27,1.55]` at 0.5 is finite and in (0, 1.6), and t=1 gives 1.
  - `typeof easingToGsap([0.42,0,0.58,1]) === "function"` and `easingToGsap("power2.out") === "power2.out"`.
  - Building the GSAP timeline for a one-track template with a tuple ease gives `typeof tween.vars.ease === "function"`. Use the module's existing builder with a stub element, as `dom.test.ts` does.
- [ ] **Step 2:** Run `pnpm vitest run packages/template-engine/src/gsap-timeline.test.ts`. Expected: FAIL (string returned).
- [ ] **Step 3: Implement.** Delete the misleading comment.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Screenshot.** In the designer, give a template a bezier keyframe of 1 s. Cue it on `preview` and capture `shots/after/2b/bezier-mid.png` at t≈0.25 s. Look for a mid-animation position that differs from the `power2.out` default.
- [ ] **Step 6: Commit.** `fix(template-engine): custom bezier eases play instead of falling back [EXTRA-1]`

## Task 6: Designer keys: Space doesn't pan and play at once; Esc and pasteboard deselect

[GD-1, GD-8; T17] [after 4]

**Files:**
- Create: `apps/operator/src/app/design/edit/designerKeys.ts`, `designerKeys.test.ts`
- Modify: `apps/operator/src/app/design/edit/page.tsx:320-345`, `packages/editor-kit/src/Canvas.tsx:137-165`

**Interfaces:**
- Produces:
  - `spaceAction(i: { phase: "down" | "up"; repeat: boolean; panned: boolean; typing: boolean }): "none" | "arm" | "toggle-play"`.
  - `escAction(i: { inGroup: boolean; hasSelection: boolean }): "exit-group" | "clear-selection" | "none"`.
  - `Canvas` gains the prop `spacePannedRef?: React.MutableRefObject<boolean>`. It sets the ref to true on the first pointer move while Space is held, and the page resets it on keydown "arm".
  - `Canvas` also gains `onPasteboardClick?(): void`, fired by a pointerdown on the area outside the artboard with no drag.

- [ ] **Step 1: Write the failing tests:**
  - `{down, repeat:false}` gives "arm", and `{down, repeat:true}` gives "none".
  - `{up, panned:false}` gives "toggle-play", and `{up, panned:true}` gives "none".
  - `typing:true` gives "none" in both phases.
  - `escAction({inGroup:true})` gives "exit-group".
  - `{inGroup:false, hasSelection:true}` gives "clear-selection".
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/design/edit/designerKeys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The page toggles play on **keyup** only.
  - Canvas's Esc handler (`:163`) defers to `escAction`.
  - A pasteboard click clears the selection.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Screenshot.** Run a Playwright script: hold Space, drag the canvas 200 px, release, and read the timeline time label. Expected: `0.00` (save `shots/after/2b/designer-space-pan.png`).
- [ ] **Step 6: Commit.** `fix(design): Space pans without playing; Esc and pasteboard click deselect [GD-1, GD-8]`

## Task 7: Whole-pixel geometry and the kit NumberInput in the inspector

[GD-3, GD-10; T9] [after 6]

**Files:**
- Create: `packages/editor-kit/src/geometryCommit.ts`, `geometryCommit.test.ts`
- Modify: `packages/editor-kit/src/Canvas.tsx:350-365` (drag and resize commit), `packages/editor-kit/src/PropertyInspector.tsx:600-620, 848-870`

**Interfaces:**
- Consumes: `NumberInput` from `@overlaysys/ui` (`value`, `onCommit`, `min`, `max`, `step`, `int`, `precision`, `suffix`; P1.3); `roundTo` (P1.3, re-exported by Task 4).
- Produces: `commitRect(r: { x; y; w; h }, opts?: { minSize?: number = 1 }): { x; y; w; h }`. It rounds each value to 0 dp and clamps w/h to ≥ `minSize`.

- [ ] **Step 1: Write the failing test:**
  - `commitRect({x: 10.4999, y: 460.00000000000006, w: 99.6, h: 0.2})` deep-equals `{x:10, y:460, w:100, h:1}`.
  - Negative x is kept: `commitRect({x:-3.6,…}).x === -4`.
- [ ] **Step 2:** Run `pnpm vitest run packages/editor-kit/src/geometryCommit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Canvas drag and resize commits pass through `commitRect`.
  - `NumberRow` is replaced by the kit `NumberInput`:
    - `int` for x/y/w/h, the corner radii and font size;
    - `step 0.01 precision 2` for opacity, scale and letter-spacing (no manual `roundTo` around `value`/`onCommit`).
    - The radius inputs at `:609-615` become four `NumberInput int min=0`.
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshot.** Drag a layer by 37.3 screen px at 0.4 zoom and capture `shots/after/2b/designer-int-geometry.png`. Look for X/Y/W/H inspector values that are all integers.
- [ ] **Step 6: Commit.** `fix(design): whole-pixel geometry and kit number inputs [GD-3, GD-10]`

## Task 8: Designer chrome and layout in the new look (layers / canvas / inspector / timeline)

[GD-5 (sizing), GD-19, GD-20, GD-25 (Default D5), GD-24 (verify guard dialog)] [after 7]

**Files:**
- Create: `apps/operator/src/app/design/edit/DesignerHeader.tsx`, `DesignerLayout.tsx`, `HelpPopover.tsx`, `timelineSize.ts`, `timelineSize.test.ts`
- Modify: `apps/operator/src/app/design/edit/page.tsx`, which keeps the routing, load, ack-save and keyboard wiring and moves the markup out; `packages/editor-kit/src/canvasView.tsx` and `LayerTree.tsx` (selection colour)

**Interfaces:**
- Consumes: SaveBar, Button, IconButton, Tooltip, `PageChrome({ docTitle })` (Task 2), `useUnsavedGuard`.
- Produces:
  - `defaultTimelineHeight(trackCount: number, viewportH: number): number` = `clamp(trackCount*24 + 56, 140, floor(0.45*viewportH))`.
  - `clampTimelineHeight(h, viewportH)` with the same bounds.
  - `TIMELINE_HEIGHT_KEY = "overlaysys:designer:timelineHeight"`.
  - `<DesignerHeader name size dirty saving canUndo canRedo onUndo onRedo onSave onRevert onRename previewSlot: ReactNode onDelete />`.

Layout, per the `edit-screens.html` "Graphics designer" mockup:
- Header row (40 px):
  - the name as an inline-editable title (hover border), then muted `1920×1080`;
  - ↶ ↷ as IconButtons with the aria-labels "Undo (⌘Z)" and "Redo (⇧⌘Z)";
  - `previewSlot` (Task 11);
  - `SaveBar` inline;
  - a "⋯" Menu with Duplicate, Export and Delete (Delete wired in Task 12).
- No id is shown.
- Grid columns: `240px minmax(0,1fr) 300px`, with the inspector at **320 px at ≥ 1440 px**.
- Rows: `40px minmax(0,1fr) <timeline px>`, with a 6 px drag handle (`role="separator"`, `aria-orientation="horizontal"`) above the timeline. The height persists to localStorage.
- Panel headers use one style: 11 px / 600 uppercase `textMuted`.
- The canvas hint and the Layers hint move into a "?" `HelpPopover` in the header. Nothing is shown inline below 1280 px.
- Selection outlines and the selected layer row use `colors.accent`, not green [D5].

- [ ] **Step 1: Write the failing tests:**
  - `defaultTimelineHeight(2, 800) === 140`.
  - `defaultTimelineHeight(8, 800) === 248`.
  - `defaultTimelineHeight(20, 800) === 360`.
  - `clampTimelineHeight(50, 900) === 140`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/design/edit/timelineSize.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the split and the layout. Keep the existing save/ack/echo logic unchanged and only move it. The `[D5]` selection colour change goes in a separate commit.
- [ ] **Step 4:** Run the test, the typecheck and `pnpm --filter @overlaysys/operator build`. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `designer-1280.png` at 1280×800 with two tracks: the canvas area height is ≥ 50 % of the viewport, and no header button wraps (every header button is ≤ 28 px tall).
  - `designer-1440.png`: the inspector is 320 px wide.
  - `designer-guard.png`: make an edit, click "Shows" in the nav, and the plan 1 guard dialog appears.
- [ ] **Step 6: Commit.** `feat(design): designer in the new chrome with a resizable timeline [GD-5, GD-19, GD-20]`, then `fix(design): selection uses the accent colour [GD-25; Default D5]`

## Task 9: Inspector rebuild: no overflow, consistent sections, multi-line text, Fields panel

[GD-2, GD-7, GD-9, GD-10, GD-11, GD-12 (Default D11), GD-21, GD-22, GD-23, GD-27] [after 8]

**Files:**
- Modify: `packages/editor-kit/src/PropertyInspector.tsx`, `FieldsPanel.tsx`, `ColorInput.tsx`, `FontInput.tsx`, `VideoInput.tsx`, `templateOps.ts` (placement of new layers), `apps/operator/src/app/design/edit/page.tsx` (font embedding dedupe)
- Test: `packages/editor-kit/src/templateOps.test.ts` (extend)

**Interfaces:**
- Consumes: `FieldRow`, `FontWeightSelect`, `SegmentedControl`, `NumberInput`, `Textarea`, IconButton.
- Produces:
  - `placementForNewLayer(view: { x; y; w; h }, size: { w; h }): { x; y }`. The layer lands centred in the visible artboard area, with integer values.
  - `dedupeFontFaces(fonts: { family: string; src: string }[]): typeof fonts`. Keep the first entry per family, case-insensitive.

Decisions:
- The inspector container gets `overflowX: hidden`, and every grid child gets `minWidth: 0`.
- Colour rows: the swatch and the hex text sit on line one, and opacity is a `NumberInput int min 0 max 100 suffix "%"` on line two.
- Sections follow the mockup order: "Layer", "Content", "Text", "Transform", "Appearance", "Clip". "Clip by" moves inside "Clip".
- The Transform section is a 2-column grid of X/Y/W/H/Rotation/Opacity.
- Align is a `SegmentedControl` with the lucide AlignLeft/AlignCenter/AlignRight icons. Vertical align uses the AlignStartVertical/Center/End icons.
- Weight uses `FontWeightSelect` with the font's known weights.
- Copy: "Center", "Default channel", "Duration", "Vertical align", "Loop", "Value".
- A literal text layer's content (`:124`) is an auto-growing `Textarea`: Enter adds a newline, and ⌘Enter or blur commits. Do the same for the text defaults in FieldsPanel.
- The Fields panel has the column captions "Key · Label · Type", the standard input border, and `IconButton aria-label={"Delete field " + label}` with a Trash2 icon.
- The eye, lock and × targets in `LayerTree.tsx` are 24 px.
- Play has `aria-label="Play (Space)"`.
- Empty image layers show a checkerboard placeholder.
- The inspector has a permanent "Template" tab beside "Layer" (GD-8 settings reachability). It holds a "Used for" `Select` (Auto / Graphic / Lyric / Scripture / Title) bound to `TemplateSchema.role` (P1.8 schema; D12 "set in Template settings"); "Auto" removes the key, and the hint shows what `templateRole` infers from the name.
- `VideoInput.tsx` (request from plan 2a, SHOWS-24 icon, SHOWS-11 rest): replace the 📁 glyph with lucide `FolderOpen` and use the caller's `resolveUrl` for the preview `src`.

- [ ] **Step 1: Write the failing tests** (in `templateOps.test.ts`):
  - `placementForNewLayer({x:0,y:0,w:960,h:540},{w:400,h:100})` deep-equals `{x:280,y:220}`.
  - With a fractional view `{x:10.5,…}`, the result is integers.
  - `dedupeFontFaces([{family:"Work Sans",src:"a"},{family:"work sans",src:"b"},{family:"Inter",src:"c"}])` has length 2, and its first src is "a".
- [ ] **Step 2:** Run `pnpm vitest run packages/editor-kit/src/templateOps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `designer-inspector-text-1280.png`: measure `scrollWidth <= clientWidth` on the inspector, check the Fields × is inside the viewport, and check the Transform section is ≤ 140 px tall.
  - `designer-multiline.png`: save "Align test", a newline, then "second line". It shows on two lines in the canvas and on the `preview` output at :3001.
- [ ] **Step 6: Commit.** `feat(design): inspector rebuilt on kit controls; multi-line text; no overflow; template role [GD-2, GD-7, GD-9..12, GD-21..23, GD-27, SHOWS-24 (icon); D12]`

## Task 10: Timeline: ruler ticks, grouped tracks, labels, missing-out warning

[GD-5 (keyframe row), GD-6, GD-13, GD-14 (warning only; D21 stays a)] [after 9]

**Files:**
- Create: `packages/editor-kit/src/timelineRuler.ts`, `timelineRuler.test.ts`, `timelineLabels.ts`, `timelineLabels.test.ts`
- Modify: `packages/editor-kit/src/TimelinePanel.tsx`

**Interfaces:**
- Produces:
  - `rulerTicks(durationSec: number, widthPx: number): { minor: number[]; labels: { t: number; text: string }[] }`. The step table by duration:

    | Duration | Minor tick | Label |
    |---|---|---|
    | < 2 s | 0.1 s | 0.25 s |
    | < 10 s | 0.5 s | 1 s |
    | otherwise | 1 s | 5 s |

    If labels would be closer than 48 px, double the label step. Label text is `"0.25s"`, `"1s"` and so on (no trailing zeros).
  - `TRACK_PROPERTY_LABELS: Record<Track["property"], { label: string; unit: string }>`:
    - x: "X", "px"
    - y: "Y", "px"
    - rotation: "Rotation", "°"
    - scaleX: "Scale X", "×"
    - scaleY: "Scale Y", "×"
    - opacity: "Opacity", ""
    - w: "Width", "px"
    - h: "Height", "px"
    - wipe: "Wipe", ""
  - `layersMissingOut(t: Template): { layerId: string; name: string }[]`. These are the layers with ≥ 1 track in `timelines.in` and none in `timelines.out`, in layer order.
  - `missingOutMessage(name) = \`${name} has no out animation: it will cut\``.

Decisions:
- Tracks are grouped under a collapsible layer header row (the layer name and a chevron).
- The track area is padded by half a diamond (5 px) on each side.
- The keyframe inspector is a single row: `t` NumberInput (s, 2 dp), then value with unit, then the easing Select. The bezier curve editor opens in a popover from an "Edit curve" IconButton.
- The out tab shows one warning line per `layersMissingOut` entry in `colors.warn`.

- [ ] **Step 1: Write the failing tests:**
  - `rulerTicks(1.5, 600).labels.map(l=>l.text)` deep-equals `["0s","0.25s","0.5s","0.75s","1s","1.25s","1.5s"]`.
  - `rulerTicks(1.5,600).minor.length === 16`.
  - `rulerTicks(6, 120)` doubles to 2 s labels.
  - `layersMissingOut` on a fixture where Title has in and out tracks, and Subtitle has only in tracks, returns `[{layerId:"subtitle", name:"Subtitle"}]`.
  - `TRACK_PROPERTY_LABELS.rotation.unit === "°"`.
- [ ] **Step 2:** Run `pnpm vitest run packages/editor-kit/src/timelineRuler.test.ts packages/editor-kit/src/timelineLabels.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshot** `designer-timeline-1280.png` (1280×800, two layers): the ruler has 0.25 s labels, there are layer group headers, and the keyframe inspector is one row.
- [ ] **Step 6: Commit.** `feat(design): readable timeline ruler, grouped tracks, missing-out warning [GD-6, GD-13, GD-14]`

## Task 11: "Preview on PVW" for the unsaved draft (preview channel only)

[spec: Graphics designer; anti-goal: never on air by accident] [after 8, 12; merge after P1.8 (`templates.ts`) and P3.5 (`channels.ts`)]

**Files:**
- Create: `server/src/templateDrafts.ts`, `templateDrafts.test.ts`, `apps/operator/src/app/design/edit/draftPreview.ts`, `draftPreview.test.ts`, `PreviewOnPvwButton.tsx`
- Modify:
  - `server/src/templateRoutes.ts` (from Task 12; add the draft routes)
  - `server/src/templates.ts` (`getTemplate` fallback, one line)
  - `server/src/channels.ts` (one guard)
  - `apps/operator/src/app/design/edit/page.tsx` (pass the `previewSlot`)

**Interfaces:**
- Server, in `templateDrafts.ts`:
  - `DRAFT_PREFIX = "__draft__"`.
  - `draftTemplateId(id: string): string`.
  - `isDraftTemplateId(id: string): boolean`.
  - `setDraftTemplate(t: Template): Template`. It stores `{ ...t, id: draftTemplateId(t.id) }` and keeps at most 10 drafts, evicting the oldest.
  - `getDraftTemplate(id): Template | null`.
  - `dropDraftTemplate(sourceId): void`.
- Routes:
  - `POST /api/templates/draft-preview` with body `{ template: Template; data: Record<string,string> }`. It validates with `TemplateSchema`, calls `setDraftTemplate`, then `broadcast({ type: "template", template: draft })`, then `channels.take("preview", draftId, data)`, and returns `{ ok: true, draftId }`. The channel is hard-coded and there is no channel parameter.
  - `DELETE /api/templates/draft-preview/:id`. If `preview`'s current templateId is that draft id, it clears `preview`. Then it drops the draft and returns `{ ok: true }`.
- `templates.getTemplate(id)` gets `?? (isDraftTemplateId(id) ? getDraftTemplate(id) : null)`.
- The `channels.ts` guard: any take/cue/PVW→PGM that would put a draft id on a channel other than `"preview"` is refused with `console.warn("[channels] refused draft template on", channel)`, and the channel is unchanged. It sits in a marked block (`// [P2b.11] draft guard`) at the top of `take()` and `takePvwToPgm()`, before P3.5's slides-session block.
- Client, in `draftPreview.ts`:
  - `draftPreviewDecision(i: { previewTemplateId: string | null; previewName: string | null; sourceId: string }): "start" | "confirm-replace"`. It returns "start" when preview is empty or already shows this source's draft.
  - `DRAFT_PREVIEW_THROTTLE_MS = 300`.

UI:
- The button is "Preview on PVW" (secondary). It is hidden in cloud mode. It is disabled with the reason "Reconnect to preview" while offline.
- While active it reads "Stop preview" with a green dot.
- Draft edits re-POST, throttled to 300 ms.
- Stop, unmount and route change send DELETE.
- On "confirm-replace", `confirm({ title: "Replace what's on preview?", message: \`Preview has "${previewName}" cued. Replace it with this unsaved draft?\`, confirmLabel: "Replace" })`.

- [ ] **Step 1: Write the failing tests:**
  - `templateDrafts.test.ts`:
    - `setDraftTemplate({id:"lt",…}).id === "__draft__lt"`.
    - `getDraftTemplate("__draft__lt")` returns it.
    - After 11 sets, the first is evicted.
    - `isDraftTemplateId("lt") === false`.
  - Extend `server/src/channels.test.ts`, test **`refuses draft templates on any channel but preview`**:
    - `take("program","__draft__lt",{})` leaves program unchanged.
    - `take("preview","__draft__lt",{})` sets preview.
    - `takePvwToPgm("preview","program")` with a draft on preview leaves program unchanged.
  - `templateRoutes.test.ts` (Fastify `inject`): POST with a valid template returns 200, and `getTemplate("__draft__<id>")` resolves. A POST body containing `channel:"program"` still cues `preview`.
  - `draftPreview.test.ts`:
    - empty preview gives "start";
    - preview holding `"__draft__lt"` for source "lt" gives "start";
    - preview holding `"lower-third"` gives **"confirm-replace"**.
- [ ] **Step 2:** Run `pnpm vitest run server/src/templateDrafts.test.ts server/src/channels.test.ts server/src/templateRoutes.test.ts apps/operator/src/app/design/edit/draftPreview.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshot** `designer-preview-on-pvw.png`: edit a text layer without saving and press "Preview on PVW". The PVW monitor on Live and http://localhost:3001/?channel=preview show the edit. Pressing Take on Live leaves PGM unchanged.
- [ ] **Step 6: Commit.** `feat(design): Preview on PVW shows the unsaved draft on preview only`

## Task 12: Template usage on delete; built-in protection

[GD-4; T18] [after P1-kit] — the single owner of template usage (contracts §8). P1.14's Designs list consumes the client helpers; plan 1 creates no usage file.

**Files:**
- Create: `server/src/templateUsage.ts`, `templateUsage.test.ts`, `server/src/templateRoutes.ts`, `templateRoutes.test.ts`, `apps/operator/src/app/design/edit/templateUsage.ts`, `templateUsage.test.ts`
- Modify: `server/src/index.ts` (one line, `await registerTemplateRoutes(app);` after `registerSongLibraryRoutes`), `apps/operator/src/app/design/edit/DesignerHeader.tsx` (the Delete menu item)

**Interfaces:**
- Server:
  - `PROTECTED_TEMPLATE_IDS = ["lyric-default"]`.
  - `type TemplateUsage = { shows: { id: string; name: string }[]; hotcards: { id: string; name: string }[]; songs: { id: string; title: string }[]; scriptureDefault: boolean; protected: boolean }`.
  - `templateUsage(id, { shows, hotcards, songs, scripture }): TemplateUsage`. It is pure. It covers:
    - graphic rows `templateId`;
    - song rows `lyricTemplateId` and intro/outro template ids, and the show's `ShowSong` `lyricTemplateId`/`introTemplateId`/`outroTemplateId` overrides;
    - scripture rows' template ids;
    - hotcards `templateId`;
    - song library defaults;
    - the scripture settings intro/body template ids.
  - Route: `GET /api/templates/:id/usage` → `TemplateUsage`.
- Client (`apps/operator/src/app/design/edit/templateUsage.ts`):
  - `fetchTemplateUsage(id): Promise<TemplateUsage | null>` — null in cloud mode or on failure (same base-URL helper as `songs/libraryClient.ts`).
  - `templateDeleteConfirm(name, u: TemplateUsage | null): { blocked: boolean; title: string; message: string; confirmLabel: string }` — `null` gives the plain "This can't be undone." copy.
- Plan 1's Designs list (`design/page.tsx`, P1.14) imports these two for its Delete menu item.

Copy:
- Blocked: title `Can't delete "Lyric — Default"`, message "This is the built-in lyric template. Duplicate it to make your own version.", confirmLabel "OK".
- Used: title `Delete "<name>"?`. The message reads "Used in 3 shows (A, B, C) and 1 hotcard. Those items will show "missing template"." Name the first 3 of each, then "and N more". Then " This can't be undone.", and confirmLabel "Delete".
- Unused: "This can't be undone."

- [ ] **Step 1: Write the failing tests:**
  - `templateUsage.test.ts`: two shows (one graphic row using "lt", one song row with `lyricTemplateId:"lyric-default"`) and a hotcard on "lt".
    - `templateUsage("lt")` returns 1 show, 1 hotcard, `protected:false`.
    - `templateUsage("lyric-default").protected === true`.
    - A `ShowSong` lyric override on "lt" counts that show.
    - Tombstoned shows are ignored.
  - `templateRoutes.test.ts`: the GET returns that shape.
  - Client: `templateDeleteConfirm("Lower Third", {shows:[a,b,c,d],…}).message` contains `"A, B, C and 1 more"`, a protected usage gives `blocked === true`, and `templateDeleteConfirm("X", null).message === "This can't be undone."`.
- [ ] **Step 2:** Run `pnpm vitest run server/src/templateUsage.test.ts server/src/templateRoutes.test.ts apps/operator/src/app/design/edit/templateUsage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The designer's Delete goes through `useConfirm` with this copy. A blocked delete shows only "OK", and the server `delete_template` path is untouched.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshot** `designer-delete-used.png`: designer ⋯, then Delete on "Lower Third", shows the users listed.
- [ ] **Step 6: Commit.** `feat(design): delete says where a template is used; built-in lyric template protected [GD-4]`

## Task 13: Stage layout schema additions and D8 built-ins readable at 10 m

[STAGE-1, STAGE-2, STAGE-3, STAGE-4 (bar width), STAGE-6, STAGE-7, STAGE-10; Default D8] [rebase after P1.8, which adds `StageLayoutMetaSchema.updatedAt` to this file]

**Files:**
- Modify: `packages/core/src/stageLayout.ts`, `packages/core/src/stageLayout.test.ts`

**Interfaces:**
- Produces (all optional, so stored layouts parse unchanged):
  - `StageWidgetStyleSchema`: `captionSize?: number` (positive), `captionColor?: string`.
  - timer props: `overtimeStyle: z.enum(["text","fill","flash"]).optional()`. The renderer treats undefined as `"text"` for stored layouts. Built-ins and new widgets set `"fill"`.
  - sermonNotes props: `collapseWhenEmpty?: boolean`.
  - videoRemaining props: `warnColor?: string`, `overColor?: string`.
  - `NEW_WIDGET_DEFAULTS: Partial<Record<StageWidgetKind, { rect?: Partial<StageRect>; style?: Partial<StageWidgetStyle>; props?: object }>>`. It holds the timer `{ rect:{w:600,h:300}, style:{fontSize:160, autoFit:false}, props:{ showLabel:true, overtimeStyle:"fill" } }`, the message bar style, and currentSlide `{ rect:{w:1200,h:400}, style:{fontSize:72} }`. Task 16 uses it.
  - The schema default for `timer.props.showLabel` stays `false`.

D8 built-ins (1920×1080; every text widget fontSize ≥ 48):

| Layout | Widget | Rect | Style |
|---|---|---|---|
| Speaker | rowTitle | x24 y24 w1248 h96 | fs56, label "NOW" |
| Speaker | current | x24 y136 w1248 h300 | fs64, label "LIVE" |
| Speaker | next | x24 y452 w1248 h150 | fs48, label "NEXT" |
| Speaker | notes | x24 y618 w1248 h334 | fs48, label "NOTES", `collapseWhenEmpty:true` |
| Speaker | timer | x1296 y24 w600 h300 | fs200, autoFit false, `showLabel:true`, `overtimeStyle:"fill"` |
| Speaker | clock | x1296 y340 w600 h140 | fs96, align center |
| Speaker | video | x1296 y496 w600 h140 | fs72, label "VIDEO" |
| Speaker | cue | x1296 y652 w600 h300 | fs48, label "CUE" |
| Speaker | message | x24 y968 w1872 h88 | fs52 |
| Lyrics | next | w1100 | fs48 |
| Lyrics | timer | x1148 y760 w360 h200 | fs96, `overtimeStyle:"fill"` |
| Lyrics | clock | x1528 y760 w368 h200 | fs72 |
| Scripture | current | x24 y24 w1300 h820 | fs64 |
| Scripture | next | x24 y860 w1300 h100 | fs48 |
| Scripture | timer | x1348 y24 w548 h180 | fs96, `overtimeStyle:"fill"` |
| Scripture | clock | x1348 y220 w548 h120 | fs72 |
| Scripture | notes | x1348 y356 w548 h604 | fs48, `collapseWhenEmpty:true` |
| Scripture | message | x24 y976 w1872 h80 | fs52 (full width, STAGE-4) |

The Lyrics widgets not listed keep their current values.

- [ ] **Step 1: Write the failing tests** (in `stageLayout.test.ts`):
  - Speaker `timer.style.fontSize >= 160`.
  - **No built-in text widget has fontSize < 48.**
  - No two widgets overlap in any built-in, and all rects are within the layout size.
  - The Scripture message `w === 1872`.
  - Lyrics and Scripture each contain a `timer` and a `clock`.
  - **`stored layout from before 2b parses unchanged`:** parse a JSON fixture of a custom layout with a timer that has no `showLabel`/`overtimeStyle` and a style with no caption props. Then `showLabel === false`, `overtimeStyle === undefined`, `captionSize === undefined`, and the re-serialised JSON has no new keys.
- [ ] **Step 2:** Run `pnpm vitest run packages/core/src/stageLayout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The schema additions go in one commit, and the built-in changes `[Default D8]` in a second.
- [ ] **Step 4:** Run the test and `pnpm --filter @overlaysys/core typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** both. `feat(stage): caption, overtime and notes-collapse props on stage widgets`, then `feat(stage)!: built-in layouts readable at 10 m [STAGE-1..3, 6, 7, 10; Default D8]`. The second message notes for the release notes: "every stage channel using a built-in layout changes at the next render".

## Task 14: Stage widgets on output: captions, overtime, fit floor, content-kind captions, video and flash

[STAGE-4, STAGE-5, STAGE-8, STAGE-9, STAGE-10 (render)] [after 13]

**Files:**
- Create: `packages/stage-widgets/src/captionStyle.ts`, `captionStyle.test.ts`, `timerOvertime.ts`, `timerOvertime.test.ts`
- Modify: `packages/stage-widgets/src/widgets.tsx`, `fitText.ts`, `fitText.test.ts`, `useFitText.ts`, `stageTime.ts`, `stageTime.test.ts`, `index.ts`

**Interfaces:**
- Produces:
  - `captionFontSize(bodyPx: number, captionSize?: number): number` = `captionSize ?? Math.max(28, Math.round(0.35 * bodyPx))`.
  - `defaultCaption(kind: StageWidgetKind, currentKind?: "song" | "scripture" | "graphic" | "slides" | "video"): string | undefined`. For currentSlide it returns "Lyrics", "Scripture", "Graphic", "Slides" or "Video". `style.label` wins whenever it is set.
  - `overtimeView(style: "text" | "fill" | "flash" | undefined, over: boolean, nowMs: number): { color?: string; background?: string; pulse: boolean }`. "fill" gives `overColor` as the background and white digits. "flash" is the same with `pulse: true`, at a 1 Hz pulse.
  - `fitFontSize(…, { minPx = 48 })` returns `{ px: number; wrap: boolean; grow: number }`. Below `minPx` it returns `px = minPx`, `wrap = true`, and `grow` ∈ [1, 2], the height multiplier for the message bar, which grows upward.
  - `formatRemaining` stays the one formatter: videoRemaining and timer both use it.

Decisions:
- An empty notes widget with `collapseWhenEmpty` renders nothing: no border, no "—".
- videoRemaining uses `warnColor` and `overColor`, and when paused shows the lucide Pause glyph and dims the digits to opacity 0.5.
- The message flash pulses the whole widget background, not just the text.
- When `grow > 1` the operator sees "Message too long for this layout". Pass `wrap`/`grow` back through the existing stage feed `send` channel only if one exists. Otherwise the stage settings page computes it with `fitFontSize`. **Don't add a protocol message.**

- [ ] **Step 1: Write the failing tests:**
  - `captionFontSize(200) === 70`, `captionFontSize(48) === 28`, `captionFontSize(200, 40) === 40`.
  - `defaultCaption("currentSlide","scripture") === "Scripture"`.
  - `overtimeView("fill", true, 0).background` is set, and `overtimeView(undefined, true, 0).background === undefined` (stored layouts look the same).
  - `fitFontSize` for a 300-character message in a 1872×88 box returns `px === 48`, `wrap === true` and `grow > 1`, and `grow <= 2`.
  - `formatRemaining(65) === "1:05"`.
- [ ] **Step 2:** Run `pnpm vitest run packages/stage-widgets/src`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshots.** Use `node measure.mjs stage-review <name>` at 1920×1080 with the Speaker layout:
  - `out-speaker-timer-normal`: timer digits are ≥ 160 px.
  - `out-speaker-timer-over`: a red fill.
  - `out-speaker-longmsg`: message text ≥ 48 px, wrapped.
  - `out-scripture` with a lower third live: the caption reads "Graphic".
- [ ] **Step 6: Commit.** `feat(stage-widgets): readable captions, overtime fill, message floor, content-kind captions [STAGE-4, 5, 8, 9]`

## Task 15: Renderer "PREVIEW" corner tag while a layout is previewed

[STAGE-20 (tag); Default D20]

**Files:**
- Create: `apps/renderer/src/stagePreviewTag.ts`, `stagePreviewTag.test.ts`
- Modify: `apps/renderer/src/Renderer.tsx` (stage branch near `:346`), `apps/renderer/src/wsClient.ts` (surface `stage_layout_previews`)

**Interfaces:**
- Consumes: the existing server broadcast `{ type: "stage_layout_previews", previews: { channel: string; layoutId: string }[] }`. It is sent on connect and on change (`server/src/ws.ts:211, 256`).
- Produces: `isPreviewingChannel(previews, channel): boolean`.

Tag: absolutely positioned top-left at 16 px, with "PREVIEW" in 28 px / 700, white on `rgba(0,0,0,0.6)`, and a 6 px radius. It renders only on stage channels.

- [ ] **Step 1: Write the failing test:** `isPreviewingChannel([{channel:"stage1",layoutId:"x"}],"stage1") === true`, a different channel gives false, and `[]` gives false.
- [ ] **Step 2:** Run `pnpm vitest run apps/renderer/src/stagePreviewTag.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and `pnpm --filter @overlaysys/renderer typecheck`. Expected: PASS.
- [ ] **Step 5: Screenshot.** Turn on preview in the stage editor for `stage-review` and capture `out-preview-tag` at :3001. The tag is visible. Turn preview off: the tag disappears within 1 s.
- [ ] **Step 6: Commit.** `feat(renderer): PREVIEW tag on a stage monitor while a layout is previewed [STAGE-20; Default D20]`

## Task 16: Stage editor controls on the kit; one-step commits; new widgets cascade

[STAGE-11, STAGE-12, STAGE-14, STAGE-15, STAGE-16] [after 4, 13]

**Files:**
- Modify: `packages/editor-kit/src/StageInspector.tsx`, `StagePalette.tsx`, `StageWidgetList.tsx`, `stageInspectorLogic.ts`, `stageInspectorLogic.test.ts`, `apps/operator/src/lib/stageLayoutOps.ts`, `stageLayoutOps.test.ts`

**Interfaces:**
- Consumes: `NEW_WIDGET_DEFAULTS` (Task 13); `editCoalescer`; kit Button, Input, Select, SegmentedControl, NumberInput; `FieldRow`; `FontWeightSelect`.
- Produces: `addWidget(layout, kind, viewport?): { layout; id }`.
  - It places the new widget at the first free slot: scan a 40 px grid, left-to-right and top-to-bottom, for a rect of the default size with no overlap.
  - If there is none, it cascades +40/+40 from the last added widget, clamped inside the layout.
  - Per-kind defaults come from `NEW_WIDGET_DEFAULTS`.

Decisions:
- Inspector sections are "Position & size", "Text" and "Behaviour".
- Labels: "Warn", "Overtime", "Under (s)".
- Anchor has the hint "Where the current point sits, from the top".
- Label and Text fields commit on blur/Enter through `editCoalescer`, so one typing burst is one undo step. `NumberField` becomes `NumberInput int`.
- Widget list rows are `button`s with a focus ring. The custom label is the primary name and the kind is muted. The eye and lock show on hover, focus or selection.
- No element keeps the browser default background `rgb(239,239,239)`.

- [ ] **Step 1: Write the failing tests:**
  - `stageLayoutOps.test.ts`:
    - adding 3 timers to an empty 1920×1080 layout gives 3 non-overlapping rects of 600×300;
    - adding to a full layout cascades +40/+40 and stays inside the layout;
    - a new timer has `props.showLabel === true` and `style.fontSize === 160`.
  - `stageInspectorLogic.test.ts`: `coalescedLabelEdits(["S","SE","SER","SERMON"])` produces one undo entry. Use the existing coalescer API with a fixed clock.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/lib/stageLayoutOps.test.ts packages/editor-kit/src/stageInspectorLogic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshots** `stage-all-widgets.png` and `stage-insp-timer.png`. Measure that no element has the computed background `rgb(239, 239, 239)`. Tab through the widget list: every row shows a focus ring.
- [ ] **Step 6: Commit.** `feat(stage-editor): kit controls, one-step commits, cascading new widgets [STAGE-11, 12, 14, 15, 16]`

## Task 17: Stage layout designer page: chrome, read-only built-ins, New "Start from", preview switch

[STAGE-13, STAGE-17, STAGE-18, STAGE-19, STAGE-20 (switch + confirm), STAGE-21 (verify guard), STAGE-22, STAGE-23] [after 16, 3]

**Files:**
- Modify: `apps/operator/src/app/design/stage/edit/page.tsx` (split into `StageEditorHeader.tsx`, `StagePreviewSwitch.tsx`), `packages/editor-kit/src/StageCanvas.tsx:380-395`, `apps/operator/src/lib/stageDesigner.ts` (`sampleKindFor`), `apps/operator/src/lib/stageDesigner.test.ts`

**Interfaces:**
- Produces:
  - `sampleKindFor(layout): "song" | "scripture" | "notes"`. It returns "scripture" if the largest text widget is currentSlide with `showReference`, "notes" if it is sermonNotes, and "song" otherwise.
  - `STAGE_START_FROM = ["blank", "speaker", "lyrics", "scripture"] as const`.
  - `newLayoutFrom(start, name): StageLayout`. The id is a slug of the name plus a 4-char suffix.
  - `previewNeedsConfirm(i: { showLive: boolean; channelInUse: boolean }): boolean`.

Decisions:
- The header has the title as the editable name (no id), the SaveBar, and a "⋯" with Duplicate and Delete.
- The palette folds into a "+ Add" Menu.
- The inspector can collapse (a chevron and a 24 px rail).
- Built-ins show one banner, "Built-in layout. Duplicate to edit.", with a primary "Duplicate to edit". The "+ Add" menu is hidden and the inspector controls are disabled.
- The "Start from" dialog is reached at `/design/stage/edit?new=1` (contracts §8). Plan 1's "New stage layout" action (P1.14) navigates there, so P1.14 merges after this task. It shows a 4-option SegmentedControl and a name Input with `required`.
- Every widget gets a 1 px dashed `colors.borderStrong` outline and a kind label chip at the top-left. The hover outline is `colors.accent`.
- The preview switch is `Switch` labelled `Show on ${channelName}`, off by default. When `previewNeedsConfirm`, show `confirm({ title: "Show this draft on the stage monitor?", message: \`${channelName} is in use during a live show. The pastor will see this draft layout until you turn it off.\`, confirmLabel: "Show draft" })`.

- [ ] **Step 1: Write the failing tests** in `stageDesigner.test.ts`:
  - `sampleKindFor(SCRIPTURE_LAYOUT) === "scripture"`.
  - `sampleKindFor(SPEAKER_LAYOUT) === "notes"`. The notes widget is the largest text widget after D8.
  - `sampleKindFor(LYRICS_LAYOUT) === "song"`.
  - `newLayoutFrom("blank","Pastor").widgets.length === 0`.
  - `newLayoutFrom("speaker","Pastor")` has the Speaker widgets and `builtIn` undefined.
  - `previewNeedsConfirm({showLive:true, channelInUse:true}) === true`, and it is false otherwise.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/lib/stageDesigner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `stage-editor-speaker-1440.png`: the canvas is ≥ 50 % of the viewport width.
  - `stage-editor-1024.png`: header labels don't wrap.
  - `stage-builtin-banner.png`.
  - `stage-guard.png`: edit, click Channels, and the guard dialog appears.
- [ ] **Step 6: Commit.** `feat(stage-editor): new chrome, read-only built-ins, Start from, labelled preview switch [STAGE-13, 17..20, 22, 23]`

## Task 18: Settings › Channels: honest dirty state, compact cards, Kind-first create, explicit save

[STAGE-28, STAGE-29, STAGE-30, STAGE-31, STAGE-32, SS-9 (channels), SS-10 (channels), SS-11 (channels), SS-16 (options), SS-18; D9; spec "Stage screens choose their layout dynamically" (rules editor)] [after 1, 2, 3, P1.22]

**Files:**
- Create: `apps/operator/src/app/settings/channels/channelDraft.ts`, `channelDraft.test.ts`, `ChannelCard.tsx`, `NewChannelDialog.tsx`
- Modify: `apps/operator/src/app/settings/channels/page.tsx`, `LanStageLinks.tsx`

**Interfaces:**
- Consumes: `sendAndAwaitAck(getClient(), { type: "save_channel", … }, { op: "save_channel", id })` (P1.6), `useUnsavedGuard`, SaveBar, `PageBody variant="wide"` (P1.1), `useConnection` (P1.6).
- Produces:
  - `channelConfigEqual(a: ChannelConfig, b: ChannelConfig): boolean`. It compares normalised name, kind, follows, layoutId, renderMode, mirror and window prefs. Undefined optional fields and default values compare equal, and key order is ignored.
  - `sortChannels(cs): ChannelConfig[]`: program, then preview, then the rest by name.
  - `newChannelDefaults(kind: ChannelKind): Partial<ChannelConfig>`.
  - `setLayoutRule(cfg: ChannelConfig, kind: StageRuleKind, layoutId: string | null): ChannelConfig` — `null` removes the rule; the last removal deletes the `layoutRules` key so an untouched config stays byte-identical (contracts §16). `channelConfigEqual` compares `layoutRules` too (absent ≡ `{}`). Stage gives `{ follows: DEFAULT_STAGE_FOLLOWS, layoutId: "speaker" }`, and graphics gives `{ renderMode: "transparent", mirror: undefined }`.

Decisions:
- One page-level SaveBar saves every dirty card, sending `save_channel` and awaiting the ack for each. After each ack, that card's saved baseline resets to the incoming config. Cards show a dirty dot next to the name.
- Card layout is one row: name, Kind pill, "Shows content from", Default layout or Render mode, Mirror, then ⋯ (Open on another device, Delete).
- Stage cards replace the single Layout picker with "Default layout" plus a collapsible "Layout by item type" block: one `Select` per `StageRuleKind` (Song, Scripture, Slides, Graphic, Video), first option "Use default". Hint: "A rundown item can override this in its Stage screens section; Live can switch it until the next item." "Open on another device" expands the `LanStageLinks` inline.
- The network footnote appears once at the top.
- The create dialog puts **Kind** first: a SegmentedControl with "Graphics output" and "Stage monitor". Stage shows "Shows content from" and "Layout". Graphics shows "Render mode" and "Mirror". One "Create" saves.
- Column labels are "Kind", "Shows content from" and "Layout". Option labels are capitalised.
- Links use `colors.accent`.
- Delete goes through a `useConfirm` danger confirm.

- [ ] **Step 1: Write the failing tests:**
  - `channelConfigEqual({id:"a",name:"A",kind:"graphics"}, {kind:"graphics",name:"A",id:"a",mirror:undefined}) === true`.
  - Different `layoutId` gives false.
  - `sortChannels` puts program and preview first.
  - `newChannelDefaults("stage").layoutId === "speaker"`.
  - `setLayoutRule(cfg, "song", "lyrics").layoutRules` deep-equals `{ song: "lyrics" }`; removing it again gives a config with no `layoutRules` key.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/settings/channels/channelDraft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS. `rg "accent2|accent-2" apps/operator/src/app/settings/channels` returns nothing.
- [ ] **Step 5: Screenshots.**
  - `settings-channels-1440.png`: save the Lyrics card 4 times, and no "unsaved" dot remains. With 6 channels the page is ≤ 900 px tall. No × wraps.
  - `settings-channels-new-stage.png`: a stage monitor is created with one Create.
- [ ] **Step 6: Commit.** `feat(settings): channels with honest save state, compact cards and Kind-first create [STAGE-28..32, SS-18]`

## Task 19: Settings › Stage monitor: SaveBar, guard, presets panel

[STAGE-33 (Default D9), STAGE-34, STAGE-35, STAGE-36, STAGE-37, SS-6 (stage), SS-9 (stage link), SS-12 (stage intro)] [after 1, 2, 3]

**Files:**
- Create: `apps/operator/src/app/settings/stage/presetsDraft.ts`, `presetsDraft.test.ts`
- Modify: `apps/operator/src/app/settings/stage/page.tsx`, `apps/operator/src/lib/stageSettingsClient.ts` (types only, if needed)

**Interfaces:**
- Consumes: `useSettingsDraft<StageSettings>({ load: getStageSettings, save: putStageSettings, validate: presetsInvalidReason })`, `PageBody variant="form"`.
- Produces:
  - `presetsInvalidReason(presets: string[]): string | null`. It returns "Preset N is empty" for the first blank one (1-based).
  - `movePreset(presets, i, dir: -1 | 1): string[]`.

Decisions:
- The intro reads "Messages and countdowns shown on stage monitors." with a link "Edit stage layouts" to `/design?tab=stage`.
- The "Message presets" panel has the hint "Tap one on Live to show it on every stage monitor." "Add preset" sits under the list. The new row gets focus with the placeholder "e.g. Wrap up". Empty rows are flagged inline, not dropped. Rows have ChevronUp, ChevronDown and a Trash2 IconButton (`aria-label` "Delete preset <text>").
- The "Item countdown" panel has the hint "Counts down each rundown item's length on stage monitors." and two Switches.
- `PageChrome docTitle "Stage monitor settings"`.

- [ ] **Step 1: Write the failing tests:**
  - `presetsInvalidReason(["Wrap up",""]) === "Preset 2 is empty"`.
  - `movePreset(["a","b","c"],0,1)` deep-equals `["b","a","c"]`.
  - Moving the first preset up is a no-op.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/settings/stage/presetsDraft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `settings-stage-1440.png`: the SaveBar is visible after an edit, and "Saved" clears on the next edit.
  - Edit, click Channels: the guard appears.
- [ ] **Step 6: Commit.** `feat(settings): stage monitor settings use the explicit save model [STAGE-33..37; Default D9]`

## Task 20: Settings › Scripture and Speech-to-text: one save model, honest loading, titles

[SS-4 (save offline), SS-5, SS-6 (scripture, stt; Default D9), SS-8 (duplicate pill), SS-11 (stt), SS-12 (scripture), SS-16, SS-26] [after 1, 2, 3]

**Files:**
- Modify:
  - `apps/operator/src/app/settings/scripture/page.tsx`
  - `apps/operator/src/app/settings/stt/page.tsx`: extract `SttConfigForm.tsx` and `SttPresence.tsx`
  - `apps/operator/src/lib/scriptureSettings.ts`, `scriptureClient.ts`
  - `apps/operator/src/app/shell/StatusBar.tsx`: hide the STT pill when `pathname === "/settings/stt"`
- Create: `apps/operator/src/app/settings/stt/sttDraft.ts`, `sttDraft.test.ts`

**Interfaces:**
- Consumes: `useSettingsDraft`, `sendAndAwaitAck(getClient(), msg, { op: "stt_spawner_save_config" })` (P1.6; the server already acks it; if it doesn't, use `requestOne` to resolve on the next `stt_spawner_config` echo whose value equals the sent one), `PageBody` (scripture `form`, stt `wide`).
- Produces:
  - `sttConfigEqual(a, b): boolean`.
  - `presenceView(p: SttPresence | undefined): "loading" | "present" | "missing"`. Undefined gives "loading": never default to "Missing".

Decisions:
- Scripture: the API key, translation, defaults and "Default intro" share one SaveBar. The translation no longer autosaves. Panels sit 16 px apart, and "Default intro" uses the panel heading style.
- STT: "Save configuration" moves into the SaveBar. Presence shows skeleton rows while "loading". Destructive buttons use `variant="danger"`. The model delete is an IconButton with `aria-label` "Delete model <name>".
- Titles: "Speech-to-text" and "Scripture". The labels are "Requirements" and "Personal access token".

- [ ] **Step 1: Write the failing tests:**
  - `presenceView(undefined) === "loading"`.
  - `presenceView({binary:true, model:true}) === "present"`. Match the fields to the real `SttPresence` type.
  - `sttConfigEqual` ignores key order.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/settings/stt/sttDraft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `settings-scripture-1440.png` and `settings-stt-1440.png`: one SaveBar each.
  - rAF-sample /settings/stt for 2 s after load: no frame contains "Missing" before presence arrives.
  - On /settings/stt the top-bar STT pill is hidden.
- [ ] **Step 6: Commit.** `feat(settings): scripture and speech-to-text share the explicit save model [SS-5, SS-6, SS-8, SS-26; Default D9]`

## Task 21: Settings › Integrations, Connection, and /account

[SS-9 (account), SS-10, SS-13 (account), SS-14, SS-15, SS-22, SS-21 (quick fix), LM-3 (Integrations Disconnect, finish)] [after 1, 2, 3]

**Files:**
- Modify: `apps/operator/src/app/settings/integrations/page.tsx`, `apps/operator/src/app/settings/connection/page.tsx`, `apps/operator/src/app/account/page.tsx`, `apps/operator/src/app/settings/page.tsx` (redirect target unchanged)
- Create: `apps/operator/src/app/settings/integrations/integrationStatus.ts`, `integrationStatus.test.ts`

**Interfaces:**
- Produces: `integrationStatus(i: { configured: boolean; ok: boolean | null }): { tone: "muted" | "ok" | "warn"; label: string }`:
  - not configured gives `{muted, "Not set up"}`;
  - configured and ok gives `{ok, "Connected"}`;
  - configured and not ok gives `{warn, "Set up, not responding"}`;
  - ok null gives `{muted, "Checking…"}`.

Decisions:
- Integrations:
  - The PCO card links to `/pco` ("Connect" or "Manage").
  - The card shows "Disconnect" (`danger`, with confirm) for PAT connections.
  - The Scripture card is removed, because it is configured on its own page.
- Connection: if it has editable fields, `PageBody variant="form"` plus `useSettingsDraft`.
- Account:
  - When signed out, one panel with "Sign in".
  - User and workspace ids sit behind a "Details" disclosure with "Copy id" buttons.
  - The version and build come from `server/src/version.ts` through the existing `/health` or `/api/v1/health` field.
  - `PageBody variant="form"`.

- [ ] **Step 1: Write the failing tests** for the four `integrationStatus` cases.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/settings/integrations/integrationStatus.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshots** `account-1440.png` and `settings-integrations-1440.png`. Measure the first-content x on every Settings page at 1440: one value (±1 px) for the form pages (scripture, stage, integrations, connection, account).
- [ ] **Step 6: Commit.** `feat(settings): integrations status, account details and one form column [SS-9, 10, 13..15, 21, 22]`

## Task 22: Shell navigation: glossary, labels at all widths, project switcher scope, Live tab colour

[SS-5 (nav), SS-16 (nav), SS-17, SS-24 (tab; Default D5), GD-19 (sub-nav), STAGE-17 (sub-nav), SHOWS-22 (switcher), LM-25 (switcher); D11] [after P1-kit]

**Files:**
- Modify: `apps/operator/src/app/shell/areas.ts`, `areas.test.ts`, `SubNav.tsx`, `TopBar.tsx`
- Create: `apps/operator/src/app/shell/glossary.test.ts`

**Interfaces:**
- Produces:
  - `showsProjectSwitcher(pathname: string): boolean`. It is false on `/shows/edit`, `/songs/edit`, `/design/edit`, `/design/stage/edit`, `/hotcards/edit`, `/settings/channels`, `/settings/stt`, `/settings/connection` and `/account`, and true elsewhere.
  - `AREAS` labels: Live destination `"Live"`, Library `"Shows"`, `"Songs"`, `"Slides"`, `"Designs"`, `"Hotcards"`, `"Planning Center"` (contracts §13). The Slides entry is `{ route: "/slides", label: "Slides", icon: Presentation, desktopOnly: true }`, added here by the owner of `areas.ts` for plan 3 (P3.14 builds the page and doesn't edit this file). The Settings labels are unchanged.
  - `BANNED_COPY: { pattern: RegExp; use: string }[]`, exported from `glossary.test.ts`'s sibling module `shell/glossary.ts`.

Decisions:
- The sub-nav always renders labels:
  - P1.1 already deletes the `globals.css` collapse rules (`.shell-subnav-label`, `.shell-status-label`); drop the now-unused `shell-subnav-label` class from the label span;
  - width 184 px.
- Editor routes keep labels too, as the spec requires. This supersedes WS7.11's icon collapse.
- `ProjectSwitcher` is rendered only when `showsProjectSwitcher(pathname)`, with the visible label "Current project".
- The Live tab uses the accent fill when selected, and shows a 6 px `onair` dot only when PGM has content. `PGM has content` comes from `useStore` program state through the existing `onAir.ts` helper.
- A "⌘K" ghost button sits in the top bar and opens the palette (Task 24).
- `BANNED_COPY` covers `/Cue → PVW|Cue Preview|Start Program|Take → Program|TAKE \(PVW/`, `/STT Spawner/`, `/Trust Mode/`, `/Pastor notes/`, `/\bFire hotcard\b/`, and `/Channel hint/`.

- [ ] **Step 1: Write the failing tests:**
  - `areas.test.ts`:
    - `AREAS.live.destinations[0].label === "Live"`;
    - the Library labels are, in order, `["Shows", "Songs", "Slides", "Designs", "Hotcards", "Planning Center"]`;
    - `showsProjectSwitcher("/design/edit") === false`;
    - `("/shows") === true`;
    - `("/settings/scripture") === true`.
  - `glossary.test.ts`: walk the files under `apps/operator/src/app/{shell,settings,account,design/edit,design/stage,hotcards/edit,pco,data,projects}` and `packages/companion-module/src`. Assert no `BANNED_COPY` pattern matches a string literal or JSX text. Skip comments and test files.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/shell/areas.test.ts apps/operator/src/app/shell/glossary.test.ts`. Expected: FAIL (the label "Show"; the banned strings that are still present).
- [ ] **Step 3: Implement** the label and nav changes. `glossary.test.ts` passes only after Tasks 18–21, 25–26 and 30–32 fix their copy. Mark it `it.todo` for directories whose task hasn't merged, and flip each to `it` in that task's commit. Each owning task's Step 4 then includes this test.
- [ ] **Step 4:** Run the tests. Expected: PASS for the merged directories.
- [ ] **Step 5: Screenshots.**
  - `shell-1280.png`: the sub-nav labels are visible, and the top bar `scrollWidth <= clientWidth`.
  - `shell-live-idle.png` and `shell-live-onair.png`: the tab is accent when idle, with a red dot only when on air.
  - `/design/edit` has no project switcher.
- [ ] **Step 6: Commit.** `feat(shell): glossary labels, sub-nav labels at all widths, switcher scope [SS-5, SS-16, SS-17]`, then `fix(shell): Live tab is not red unless something is on air [SS-24; Default D5]`

## Task 23: Not-found page, skip link, account menu, status popovers, desktop toasts

[SS-19 (skip link), SS-20, SS-27, SS-28, SS-29 (migrate), LM-34] [after 22]

**Files:**
- Create: `apps/operator/src/app/not-found.tsx`, `apps/operator/src/app/shell/statusPopover.ts`, `statusPopover.test.ts`
- Modify: `apps/operator/src/app/shell/AppShell.tsx`, `StatusPopoverButton.tsx`, `StatusBar.tsx`, `DesktopEventToasts.tsx`, `apps/operator/src/app/components/AccountMenu.tsx`, `apps/operator/src/app/timer/page.tsx` (redirect toast) — both assigned to this plan (execution-order doc)
- Delete: `apps/operator/src/app/components/CloudSignInButton.tsx` (requested; its users move to AccountMenu)

**Interfaces:**
- Produces: `statusPopoverModel(kind: "server" | "stt" | "sync", s): { title: string; lines: string[]; actions: { label: string; id: string }[] }`. One shared layout: a title row, detail lines and an action row.

Decisions:
- Not-found: `PageBody variant="form"`, h1 "That page doesn't exist", body "Check the address, or go back to where you were.", and the buttons "Go to Live" (primary, `/`) and "Library" (`/shows`). Cloud mode hides "Go to Live".
- Skip link: the first focusable element in `AppShell`, "Skip to content". It is visually hidden until focused and targets `#main` on the content slot.
- The account menu is rebuilt on `Menu` (`role="menu"`).
- `DesktopEventToasts` calls `toast()`.
- `/timer` redirects to `/` and toasts "Timers are now on the Live page".

- [ ] **Step 1: Write the failing test:**
  - `statusPopoverModel("server", {conn:"closed"}).actions[0].label === "Retry now"`.
  - The `"stt"` model with an unknown state has the title "Speech-to-text" and no "Missing" line.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/shell/statusPopover.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test, the typecheck and the build. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `nonexistent-1440.png`: open `/nonexistent`.
  - Press Tab once on `/shows`: focus is on "Skip to content".
- [ ] **Step 6: Commit.** `feat(shell): not-found page, skip link, one popover layout, menu-based account menu [SS-19, 20, 27..29, LM-34]`

## Task 24: Command palette: ranking, library items, guarded on-air verbs

[SS-7; Default D17 (b) and (c) with confirm] [after P1-kit; the on-air commit after P2a.16]

**Files:**
- Create: `apps/operator/src/app/shell/paletteEntries.ts`, `paletteEntries.test.ts`
- Modify: `apps/operator/src/app/shell/fuzzyMatch.ts`, `fuzzyMatch.test.ts`, `CommandPalette.tsx`

**Interfaces:**
- Produces:
  - `fuzzyScore(query: string, text: string): number`. Prefix scores 3, word-start 2, subsequence 1, and no match 0. An empty query scores 1. `fuzzyMatch` is kept as `fuzzyScore(...) > 0`.
  - `SYNONYMS: Record<string, string[]>`: `{ stt: ["speech-to-text"], pvw: ["preview"], pgm: ["program"], lyrics: ["songs"], graphics: ["designs","templates"] }`.
  - `type PaletteEntry = { id: string; label: string; group: "Go to" | "Shows" | "Songs" | "Designs" | "Hotcards" | "On air" | "App"; keywords?: string[]; href?: string; run?(): void; confirm?: { title: string; message: string; confirmLabel: string } }`.
  - `buildPaletteEntries(i: { destinations; shows: ShowMeta[]; songs: SongMeta[]; templates: TemplateMeta[]; stageLayouts: StageLayoutMeta[]; hotcards: HotcardMeta[]; projectId: string; cloud: boolean; extras: PaletteEntry[] }): PaletteEntry[]`.
  - `toPaletteEntry(cmd: PaletteCommand, send: (m: ClientMessage) => void): PaletteEntry` — maps plan 2a's `liveCommands` (contracts §10) to `{ id, label, group: "On air", keywords, confirm, run: () => cmd.messages().forEach(send) }`.
  - `rankEntries(query, entries): PaletteEntry[]`. Ordering is score desc, then group order, then label.

On-air entries (desktop only) are **not defined here**: `CommandPalette` passes `extras = cloud ? [] : liveCommands(state).map((c) => toPaletteEntry(c, send))`. Plan 2a's `liveCommands` (P2a.16) supplies "Take preview to program", "Clear program", "Clear preview", "Clear all outputs", "Cue hotcard <name>" and "Take hotcard <name>" (current project only), each with its `confirm`.

Footer: "↑↓ to move · ↵ to open · esc to close".

- [ ] **Step 1: Write the failing tests:**
  - `rankEntries("stt", entries)[0].label === "Settings · Speech-to-text"`.
  - `fuzzyScore("so","Songs") === 3`, `fuzzyScore("ng","Planning Center") === 1`, `fuzzyScore("pc","Planning Center") === 2`.
  - `toPaletteEntry` keeps `confirm` and its `run` sends `cmd.messages()` in order (fake `send`).
  - Every "On air" entry built from a fixture `liveCommands` list has `confirm` set.
  - With `cloud:true` there are no "On air" entries.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/shell/paletteEntries.test.ts apps/operator/src/app/shell/fuzzyMatch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The palette runs `confirm` through `useConfirm` before `run`, and never takes silently.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshot** `palette-stt.png`: press ⌘K and type "stt". Speech-to-text is first, and the footer is visible.
- [ ] **Step 6: Commit.** `feat(shell): command palette ranks results and finds library items [SS-7]`, then `feat(shell): palette on-air verbs behind a confirm [Default D17]`

## Task 25: Hotcard editor rebuild: guard, header, template preview, project field, create flow

[LM-5, LM-6 (Default D12 picker), LM-25 (header), LM-26 (editor field), LM-31] [after 3, P1-thumb]

**Files:**
- Create: `apps/operator/src/app/hotcards/edit/hotcardDraft.ts`, `hotcardDraft.test.ts`, `HotcardNewStep.tsx`
- Modify: `apps/operator/src/app/hotcards/edit/page.tsx`

**Interfaces:**
- Consumes: `TemplateThumbnail({ templateId, data, width })` (contracts §5); `useUnsavedGuard(dirty, { resetKey: id })` (P1.7); SaveBar; `sendAndAwaitAck(getClient(), { type: "save_hotcard", … }, { op: "save_hotcard", id })` (P1.6); `templatesFor` (P1.8); the existing `hotkeyConflictWarning` and `hotkeyOwners` (`lib/hotcardKeys`); `hotcardRoute`.
- Produces:
  - `hotcardEqual(a, b): boolean`.
  - `templatesForHotcard(metas: TemplateMeta[], lastUsedId?: string): { suggested: TemplateMeta[]; others: TemplateMeta[]; defaultId?: string }` — a thin wrapper over `templatesFor(metas, "graphic", lastUsedId ? [lastUsedId] : [])` (P1.8), so lyric and scripture templates land in `others`. `defaultId` is `lastUsedId` if present, else the first suggested.
  - `LAST_HOTCARD_TEMPLATE_KEY = "overlaysys:hotcards:lastTemplate"`.

Decisions:
- Plan 1's "New hotcard" (P1.15) navigates to `/hotcards/edit?new=1` (contracts §8), so P1.15 merges after this task. `HotcardNewStep` asks for the name (`required`), the template (Select grouped "Suggested" / "Other templates") and the F-key (F1–F12 or None, with the conflict warning). "Create" saves and replaces the URL with `?id=`.
- Header:
  - the name Input is 280–480 px with a border on hover;
  - no id;
  - the shortcut label is platform-correct ("⌘S" on Mac, "Ctrl+S" otherwise, from `navigator.platform`);
  - the SaveBar;
  - "⋯" holds Duplicate, "Copy id" and Delete.
- Form: one inline field layout with a 110 px label column:
  - "Template";
  - "F-key";
  - "Default output", with the helper "Cue always goes to Preview; Take goes here (Program if unset)." (the existing D7a);
  - "Project", a Select. Changing it toasts `Moved to "<project>"` with an "Undo" action;
  - "Notes", with the placeholder "Optional note for operators".
- A "Fields" section header comes before the field inputs.
- On the right, a 16:9 `TemplateThumbnail` of the card's template with the current data, at 480 px wide.

- [ ] **Step 1: Write the failing tests:**
  - `templatesForHotcard([{id:"lyric-default",name:"Lyric — Default"},{id:"lt",name:"Lower Third"}]).suggested.map(t=>t.id)` deep-equals `["lt"]`.
  - With `lastUsedId:"lt"`, `defaultId === "lt"`.
  - `hotcardEqual` ignores key order and treats undefined `hotkey` equal to absent.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/hotcards/edit/hotcardDraft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test, the typecheck and the glossary test for `hotcards/edit`. Expected: PASS.
- [ ] **Step 5: Screenshots.**
  - `hotcard-editor-new-1440.png`: the new step.
  - `hotcard-editor-1440.png`: the preview is visible.
  - `hotcard-editor-navaway.png`: edit, click Shows, and the guard dialog appears.
- [ ] **Step 6: Commit.** `feat(hotcards): editor with leave guard, template preview, project field and create step [LM-5, 6, 25, 26, 31]`

## Task 26: /pco page rebuild

[LM-10, LM-11, LM-19, LM-20 (Default D12)] [after P1-pco, P1-kit]

**Files:**
- Create: `apps/operator/src/app/pco/PcoConnectForm.tsx`, `PcoPlanPicker.tsx`, `PcoItemList.tsx`, `PcoItemRow.tsx`, `PcoImportFooter.tsx`, `pcoItemGroups.ts`, `pcoItemGroups.test.ts`, `importOptions.ts`, `importOptions.test.ts`
- Modify: `apps/operator/src/app/pco/page.tsx` (becomes composition plus state only), `apps/operator/src/lib/pcoClient.ts` (types only)

**Interfaces:**
- Consumes: plan 1's header→section request/response fields (P1-pco). Header items are sent exactly as plan 1's importer expects.
- Produces:
  - `groupItemsUnderHeaders(items: PcoPlanItem[]): { header: PcoPlanItem | null; items: PcoPlanItem[] }[]`. Items before the first header go in a `header: null` group.
  - `type ImportAs = "graphic" | "song" | "skip"`.
  - `importOptions(item): { value: ImportAs; label: string }[]`. "Song" is offered only when `item.song` is set, "Graphic" always, and "Skip" always. **P3.19 later widens `ImportAs` with `"slides"` and adds the option and its `<ImportAsSlides>` mount in `PcoItemRow.tsx`, in marked blocks**: keep the options as one array and the per-kind extra controls in one `switch` so those edits stay additive.
  - `importSummary(cfgs): { label: string; count: number }`, for example "Import 7 items (2 songs)". It handles singular and plural ("1 item", "1 song").
  - `humaniseItemType(t: string): string`, mapping "song" → "Song", "item" → "Item", "media" → "Media".

Decisions:
- The connect form is a `<form>` (Enter submits) capped at 420 px. It has numbered steps, "1. Create a personal access token" with a link above the fields, then "2. Paste the Application ID and Secret". OAuth is hidden in cloud mode.
- The connected header reads "Connected to Planning Center" with a "Disconnect" (danger + confirm).
- Plan states are "Loading plans…" and "No upcoming plans". `onPickServiceType` clears `error`.
- Items are grouped under their headers. A header renders as a section heading row with no checkbox, and the muted note "Becomes a section".
- Each item row has the include checkbox, the title, the humanised type pill, the "Import as" Select and the template Select. The template Select is grouped Suggested/Other and its first option is "Default (Scripture settings)" for scripture-like items.
- A sticky footer holds the `importSummary` and the primary "Import". Errors show the item title, never the id.

- [ ] **Step 1: Write the failing tests:**
  - `groupItemsUnderHeaders([i1, H1, i2, i3, H2])` deep-equals `[{header:null, items:[i1]}, {header:H1, items:[i2,i3]}, {header:H2, items:[]}]`.
  - `importOptions({song:undefined}).map(o=>o.value)` deep-equals `["graphic","skip"]`.
  - `importSummary` of 1 item is `"Import 1 item"`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/pco`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests and the typecheck. Expected: PASS.
- [ ] **Step 5: Screenshots** with mocked PCO data from `server/src/pco/__fixtures__`, or a recorded plan:
  - `pco-connect-1440.png`.
  - `pco-plan-1440.png`: the items are grouped under headers and the footer is sticky.
- [ ] **Step 6: Commit.** `feat(pco): plan import page grouped by sections with clear states [LM-10, 11, 19, 20]`

## Task 27: Linked PCO songs follow that week's sequence

[EXTRA-2] [after P1-pco (P1.17, P1.19); touches only the song-link code in `importPlan.ts`; merge order P1.19 → this task → P3.11]

**Files:**
- Create: `server/src/pco/linkedArrangement.ts`, `linkedArrangement.test.ts`
- Modify:
  - `server/src/pco/importPlan.ts`. Edit only the two link branches (today `:331-344`) and the song-row build in the row loop. Don't touch header/section code.
  - `server/src/pco/importPlan.test.ts`.

**Interfaces:**
- Consumes: `effectiveLyricsArrangement(item)` and `buildSongRow` (core); `RowSourceRef.pcoArrangement?: string[]` (P1.17, contracts §4).
- Produces:
  - `arrangementFromSequence(sections: Section[], sequence: string[] | undefined): string[] | null`. It matches labels case- and space-insensitively, keeps repeats, skips unmatched entries, and returns **null** when nothing matches. There is no fallback to all sections.
  - `linkedRowArrangement(song: Song, sequence: string[] | undefined): string[] | undefined`. It returns undefined when the result is null or equals `song.defaultArrangement`.
  - `mergeReimportedArrangement(existing: { arrangement?: string[]; sourceRef?: { pcoArrangement?: string[] } } | undefined, next: string[] | undefined): { arrangement?: string[]; pcoArrangement?: string[] }`. It overwrites only when `existing.arrangement` is unset or deep-equals `existing.sourceRef.pcoArrangement`.

- [ ] **Step 1: Write the failing tests:**
  - `linkedArrangement.test.ts`:
    - sections V1/C/V2/B (ids `v1,c1,v2,b1`) with sequence `["Verse 1","Chorus","Chorus","Bridge"]` gives `["v1","c1","c1","b1"]`;
    - `["Tag"]` gives `null`;
    - `mergeReimportedArrangement({arrangement:["v1","b1"], sourceRef:{pcoArrangement:["v1","c1"]}}, ["v2"])` keeps `["v1","b1"]`.
  - In `importPlan.test.ts`, for a linked song (explicit `songAction:"link"` and the auto CCLI match):
    - the row's `arrangement` deep-equals `["v1","c1","c1","b1"]`;
    - `saveSong` is **not called** for the linked song;
    - its `defaultArrangement` and `updatedAt` are unchanged;
    - with no matching labels, `arrangement` is undefined;
    - **re-import after the operator edited the row's arrangement keeps the operator's edit.**
- [ ] **Step 2:** Run `pnpm vitest run server/src/pco/linkedArrangement.test.ts server/src/pco/importPlan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Record `songSequenceByItem` in the link branches, which still `continue` before any save. Apply it when building the song row, and when updating an existing row on re-import.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `fix(pco): linked songs follow that week's arrangement without touching the library song [EXTRA-2]`

## Task 28: /data page: file pickers, tabs, bundle import plan, CSV clarity

[LM-7 (import side), LM-8, LM-9, LM-21, LM-22, LM-23, LM-24, SS-13 (data), SS-16 (data tabs)] [after 2, P1-kit]

**Files:**
- Create: `apps/operator/src/app/data/planImport.ts`, `planImport.test.ts`
- Modify: `apps/operator/src/app/data/page.tsx`, `ImportPreview.tsx`, `ExportBundle.tsx`, `CsvRundownImport.tsx`, `bundleDuplicates.ts`, `bundleDuplicates.test.ts`, `apps/operator/src/lib/csv.ts`, `csv.test.ts`

**Interfaces:**
- Produces:
  - (Consumes plan 1's `FileDrop({ accept: string; onFile; hint?; file?; onClear? })` and `acceptsFile(name, mime, accept: string)` from `@overlaysys/ui`, P1.3 — no local file picker.)
  - `type ImportDecision = "import" | "replace" | "copy" | "skip"`.
  - `planImport(rows: { kind; id; name; conflict?: { name: string; updatedAt?: string }; likelyDuplicate?: boolean; project?: string }[], defaults: { currentProject: string }): { rows: (… & { decision: ImportDecision; targetProject: string })[]; summary: string }`:
    - conflicts default to "replace";
    - likely duplicates default to "skip";
    - a missing source project falls back to `currentProject`;
    - the summary reads "Import 2, replace 2, skip 1".
  - `csv.ts`: `parseCsvText` returns errors as `{ line: number; message: string }`, with 1-based spreadsheet line numbers that count the header as line 1. Blank lines are ignored. The header is validated once. Unknown columns are dropped and reported, and `keepUnknown?: boolean` keeps them.
  - `EXAMPLE_CSV: string`, the content of a downloadable example ("title,subtitle,template,length").

Decisions:
- Plan 1's `FileDrop` is used for both importers (`accept` = the extensions each importer accepts today, as one comma list; CSV `".csv,text/csv"`). The CSV hint reads "Creates a show in <project>". The bundle panel title is "Import bundle".
- Export uses a `SegmentedControl` with the tabs "Shows · N selected", "Songs · N selected", "Designs · N selected" and "Hotcards · N selected". Each tab has Select all, project labels and no ids. The disabled helper reads "Pick at least one item". After the download, toast "Downloaded <file>".
- `ExportBundle.tsx` writes `project` into the bundle.
- Import preview rows have a Project column, "Put into: <current>". Conflict rows show "Replaces: <name> · edited <date>". The bulk buttons ("Replace all", "Skip all", "Import all as copies") also cover likely duplicates. The primary button reads the `summary`, and a confirm appears when anything is replaced.

- [ ] **Step 1: Write the failing tests:**
  - `csv.test.ts`:
    - a file with a blank line 3 and a bad template on line 5 reports `{line:5}`;
    - a missing `title` header gives one error `{line:1, message:"Missing column: title"}`;
    - the unknown column "colour" is dropped and reported once.
  - `planImport.test.ts`:
    - a conflict defaults to "replace";
    - a likely duplicate defaults to "skip";
    - a missing project gives `currentProject`;
    - the summary is `"Import 1, replace 1, skip 1"`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/lib/csv.test.ts apps/operator/src/app/data`. Expected: FAIL.
- [ ] **Step 3: Implement.** `/data` uses `PageBody variant="wide"`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Screenshots** `data-1440.png`, `data-import-preview.png` (a bundle with 1 conflict and 1 duplicate) and `data-csv-bad.png`.
- [ ] **Step 6: Commit.** `feat(data): file pickers, import plan with projects and conflicts, readable CSV errors [LM-7..9, 21..24]`

## Task 29: /projects: LibraryList, rename rules, counts, custom fields, current pill, Unassigned

[LM-7 (Unassigned list), LM-27, LM-28, LM-29, LM-32; SS-2, SS-23 (projects)] [after 1, 2, P1.9] — `/projects` moves off `ManagementList` onto `LibraryList` (contracts §3); P1.16 then deletes `ManagementList` and `EntityList`.

**Files:**
- Create: `apps/operator/src/app/projects/fieldKey.ts`, `fieldKey.test.ts`, `projectsList.ts`, `projectsList.test.ts`
- Modify: `apps/operator/src/app/projects/page.tsx` (no `ManagementList` import afterwards), `CustomFieldSchemaModal.tsx`

**Interfaces:**
- Produces:
  - `deriveFieldKey(label: string, existing: string[]): string`. It is lowercase snake_case of ASCII letters and digits. A collision gets a suffix of `_2`, `_3` and so on. An empty label gives `"field"`.
  - `projectNameError(name: string, others: string[]): string | null`. Whitespace-only gives "Enter a name". A duplicate (case-insensitive, trimmed) gives `A project named "<name>" already exists`.
  - `unassignedItems(shows, hotcards, projectIds): { shows; hotcards }`. These are the items whose `projectId` isn't a live project.
  - `projectsList.ts`: `projectSorts: SortSpec<ProjectRow>[]` (`name-asc` default, `current-first`), `projectSecondary(row): string` ("3 shows · 2 hotcards", never the slug), `projectMenuItems(row, actions): MenuItem[]` (Make current, Rename…, Custom fields…, Copy id, separator, Delete… with `disabled` reason "Move or delete its shows and hotcards first" when not empty).

Decisions:
- The page is `<LibraryList<ProjectRow>>` (`storageKey: "projects"`, `primaryAction` "New project" with `prompt({ required: true, validate: (v) => projectNameError(v, names) })`, `kind` none, column Items).
- On mount, send `list_shows` and `list_hotcards` so the counts are right.
- Disconnected with nothing loaded shows `<OfflineState noun="projects" onRetry={retry}>`. Disconnected with data loaded shows the `variant="stale"` notice above the list.
- Custom fields are edited label first, with the key derived (shown muted, editable on "Edit key"). The table has the column headers "Label · Key · Type", validation on blur, and the types "Text" / "Number".
- The current project gets a "Current" pill. Others get a "Make current" ghost button. No id is shown.
- An "Unassigned" list appears only when non-empty: "N items aren't in any project" with "Move to <current>".
- `PageBody variant="list"` for the list; the custom-fields modal stays a `Dialog`.

- [ ] **Step 1: Write the failing tests:**
  - `projectSecondary({ shows: 3, hotcards: 2, … }) === "3 shows · 2 hotcards"` and never contains the project id.
  - the Delete item is disabled with a reason for a project that still has items.
  - `deriveFieldKey("Speaker name", []) === "speaker_name"`.
  - `deriveFieldKey("Speaker name", ["speaker_name"]) === "speaker_name_2"`.
  - `deriveFieldKey("  ", []) === "field"`.
  - `projectNameError("  ", []) === "Enter a name"`.
  - `projectNameError("test", ["Test"]) === 'A project named "test" already exists'`.
  - `unassignedItems` finds a show with `projectId: "gone"`.
- [ ] **Step 2:** Run `pnpm vitest run apps/operator/src/app/projects`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Screenshot** `projects-1280.png`: the counts are non-zero for the demo project, no id is visible, the "⋯" menu is visible without hover, and `rg "ManagementList" apps/operator/src/app/projects` returns nothing.
- [ ] **Step 6: Commit.** `feat(projects): projects on LibraryList with rename rules, live counts, label-first custom fields, Unassigned [LM-7, 27..29, 32; SS-2, SS-23]`

## Task 30: Companion rows and channels: index presets, readable pickers, default channel

[LM-12, LM-13, LM-14, LM-15; T5]

**Files:**
- Modify: `packages/companion-module/src/presets.ts:372-398`, `actions.ts:756-783, 1049-1074, 1116-1119, 1214, 1223`, `feedbacks.ts:624-640`
- Create: `packages/companion-module/src/__tests__/presets.test.ts`, `__tests__/compat.test.ts`, `__tests__/fixtures/action-ids-before-2b.json`. Generate the fixture from the current definitions **before** editing.

**Interfaces:**
- Produces:
  - `DEFAULT_CHANNEL_CHOICE = { id: "", label: "Default (row / song channel)" }`.
  - `rowChoices(state): { id: string; label: string }[]`, using `rowDisplayLabel(state, row)` with the prefix `${i+1}. `.
- Row presets 1–8:
  - `actionId: "take_row_by_index"`, `options: { rowIndex: n, channel: "" }`;
  - feedbacks `row_at_index_is_active` (red bg) and `row_at_index_is_cursor` (green bg).
- The data input gets `multiline: true` with the tooltip "One key=value per line. Keys are the template's field keys."

- [ ] **Step 1: Write the failing tests:**
  - `presets.test.ts`:
    - for every preset, each action option value is a valid choice of that option's dropdown;
    - no preset has an empty `rowId`;
    - Row 3 uses `rowIndex: 3`.
  - `actions.test.ts` (extend): every dropdown whose `default` is `""` has a choice with `id: ""`, and row choice labels contain no UUID (`/[0-9a-f]{8}-[0-9a-f]{4}/`).
  - **`compat.test.ts` › `keeps every action id from before 2b`:** every id in the fixture is still defined, along with every option id per action and every feedback id.
- [ ] **Step 2:** Run `pnpm vitest run packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests and `pnpm --filter @overlaysys/companion-module build`. Expected: PASS.
- [ ] **Step 5: Commit.** `fix(companion): row presets by index, readable row pickers, default channel choice [LM-12..15]`

## Task 31: Companion hotcards: Take and Cue, preset category

[LM-16; Default D7] [after 30]

**Files:**
- Modify: `packages/companion-module/src/actions.ts` (`fire_hotcard` label, new `cue_hotcard`), `presets.ts`, `feedbacks.ts` (none if `hotcard_on_air` is enough)
- Test: `packages/companion-module/src/__tests__/actions.test.ts`, `presets.test.ts`

**Interfaces:**
- Produces:
  - The `fire_hotcard` id is kept, with the name "Hotcard: take". The routing is unchanged (`hotcardRoute(hint, "take")`).
  - The new action `cue_hotcard` is "Hotcard: cue". It sends `{ type: "cue", channel: "preview", templateId, data }`.
  - A cache miss logs `this.log("warn", \`Hotcard ${id} isn't loaded yet; try again in a moment\`)`.
  - The preset category "Hotcards" has one button per hotcard in the current project. Each press runs `fire_hotcard`, with the feedback `hotcard_on_air` at bgcolor `0xe5484d`.

- [ ] **Step 1: Write the failing tests:**
  - `cue_hotcard` produces a cue to `"preview"`, even when the card's default output is "stage1".
  - `fire_hotcard` with no explicit channel goes to the card's default output, else "program".
  - A cache miss emits no message and one warn.
  - The "Hotcards" presets exist for 2 cached cards.
- [ ] **Step 2:** Run `pnpm vitest run packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(companion): Hotcard take and cue with a Hotcards preset category [LM-16; Default D7]`

## Task 32: Companion HELP.md generated from definitions; naming

[LM-17, LM-18 (Default D11)] [after 31]

**Files:**
- Create: `packages/companion-module/scripts/gen-help.ts`, `packages/companion-module/src/helpTables.ts`, `__tests__/help.test.ts`
- Modify: `packages/companion-module/companion/HELP.md`, `actions.ts`, `feedbacks.ts`, `variables.ts` (names only, never ids), `packages/companion-module/package.json` (script `"gen:help"`)

**Interfaces:**
- Produces:
  - `renderHelpTables(defs: { actions; feedbacks; variables }): string`. It renders markdown between the `<!-- generated:start -->` and `<!-- generated:end -->` markers.
  - `pnpm --filter @overlaysys/companion-module gen:help` rewrites HELP.md.

Naming rule: "<Area>: <verb> <object>" in sentence case. For example:
- "Rundown: take row"
- "Song: next slide"
- "Sermon notes: next point"
- "Speech-to-text: start listening"
- "Auto-advance (STT): on/off"

Booleans are "yes/no", and "−" (U+2212) is used for minus throughout. Ids don't change.

HELP.md opens with "Quick start (volunteers)", five steps (install, connect, drag the "Rundown" presets, Take, Clear), before the developer sections.

- [ ] **Step 1: Write the failing tests:**
  - `help.test.ts`: `renderHelpTables(currentDefs)` equals the generated block in HELP.md (the drift test).
  - Every action/feedback name matches `/^[A-Z][a-z-]*( [a-z(]|\b)/` and contains `": "`.
  - No name matches `BANNED_COPY` (import the patterns from Task 22's `shell/glossary.ts`, or copy the list if cross-package import isn't possible).
- [ ] **Step 2:** Run `pnpm vitest run packages/companion-module/src/__tests__/help.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `gen:help`.
- [ ] **Step 4:** Run the whole module's tests. Expected: PASS.
- [ ] **Step 5: Commit.** `docs(companion): generated HELP tables with a drift test; sentence-case names [LM-17, LM-18; Default D11]`

## Task 33: Stage screens resolve their layout on the server; manual switch

[spec "Stage screens choose their layout dynamically" — server] [after P1.22, P3.4 (`ws.ts`/protocol merge order), P3.10 (`stageFeedHub.ts` merge order)]

This task is the one exception to "don't change `packages/ws-protocol` or `server/src/ws.ts`": it adds one client message, one server message and one `case` in marked blocks (`// [P2b.33] stage layout`), after plan 3's blocks.

**Files:**
- Create: `server/src/stageLayoutOverride.ts`, `stageLayoutOverride.test.ts`
- Modify (shared, marked blocks): `server/src/stageFeedHub.ts`, `server/src/ws.ts`, `packages/ws-protocol/src/index.ts`; `server/src/stageLayouts.ts` (rename its id→layout loader `resolveStageLayout` to `loadStageLayout`, so it never collides with core's pure `resolveStageLayout`; update its callers)

**Interfaces (contracts §16):**
- Protocol: client `{ type: "set_stage_layout"; channel: string; layoutId: string | null }` (null = back to automatic); server `{ type: "stage_layout_status"; screens: StageLayoutStatus[] }`, sent on connect and whenever any screen's layout or reason changes.
- `stageLayoutOverride.ts`: `setManualStageLayout(channel, layoutId | null): void`; `getManualStageLayout(channel): string | null`; `noteFollowedRow(channel, liveRowId: string | null): boolean` — clears that channel's manual override when the followed output's `liveRow` id differs from the last one seen (slide/section changes within the same row don't count) and returns whether it cleared; `stageLayoutStatuses(): Promise<StageLayoutStatus[]>`. State is in memory (a restart returns every screen to automatic).
- `stageFeedHub` picks each stage channel's layout with core `resolveStageLayout({ manual, rowOverride: liveRow?.stageLayouts?.[channel], rules: cfg.layoutRules, default: cfg.layoutId, liveRowKind: liveRow?.kind })`, then `loadStageLayout(id)`. A designer preview (`stage_layout_preview`) still wins over all of it, as today.
- An unknown or deleted layout id falls back to the default layout and logs once.

- [ ] **Step 1: Write the failing tests:**
  - `stageLayoutOverride.test.ts`: set then read; `noteFollowedRow` with the same row id keeps the manual layout; a different row id clears it; `null` → `"x"` counts as a new row.
  - `stageFeedHub.test.ts` (extend): a stage channel with rules `{ song: "lyrics" }` and default `speaker` uses `lyrics` while a song row is live on its followed channel and `speaker` with nothing live; a row with `stageLayouts: { stage1: "scripture" }` wins over the rule; a manual switch wins over both and is cleared when a new row is taken; slide advances within the row keep it.
  - protocol: both messages decode; `layoutId: null` is accepted.
- [ ] **Step 2:** Run `pnpm vitest run server/src/stageLayoutOverride.test.ts server/src/stageFeedHub.test.ts packages/ws-protocol`. Expected: FAIL.
- [ ] **Step 3: Implement.** `set_stage_layout` validates the channel is a stage channel, updates the override, invalidates that channel's feed, and broadcasts `stage_layout_status`.
- [ ] **Step 4:** Run the tests, `pnpm vitest run server/src` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Screenshot** `out-stage-dynamic`: with rules on `stage-review`, take a song (Lyrics layout), then a scripture row (Scripture layout), at :3001.
- [ ] **Step 6: Commit.** `feat(stage): stage screens pick their layout by manual > item > type rule > default`

## Task 34: Companion "Set stage layout" and the current-layout variable

[spec "Stage screens choose their layout dynamically" — Companion] [after 32, 33]

**Files:**
- Modify (owned): `packages/companion-module/src/actions.ts`, `variables.ts`, `presets.ts` (none if no preset is wanted), `companion/HELP.md` (via `gen:help`)
- Test: `packages/companion-module/src/__tests__/stageLayout.test.ts`

**Interfaces (contracts §14, §16):**
- Action `set_stage_layout` "Stage screen: set layout" — options `channel` (stage channels), `layoutId` (layouts, plus `{ id: "", label: "Automatic (rules)" }`) → `{ type: "set_stage_layout", channel, layoutId: layoutId || null }`.
- Variables `<c>_stage_layout` (layout name) and `<c>_stage_layout_reason` ("manual", "item", "rule: song", "default") per stage channel, from `stage_layout_status`.

- [ ] **Step 1: Write the failing tests:** "Automatic sends layoutId null"; variables update from a `stage_layout_status` message; the compat fixture from Task 30 still passes (no id renamed); the naming test from Task 32 passes.
- [ ] **Step 2:** Run `pnpm vitest run packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `gen:help`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(companion): set a stage screen's layout; current layout variables`

---

## Contract changes

Resolved in contracts §2 (NumberInput `precision`, `OfflineState` with this plan's `variant` and copy, `FileDrop`), §4 (`RowSourceRef.pcoArrangement`, added by P1.17), §7 (`awaitAck`/`useConnection`/`OfflineState` owned by P1.6; `PageBody variant` replaces `PageFrame`; `docTitle` stays here), §8 (template usage owned here and consumed by P1.14; `?new=1` routes; role selector), §10 (palette on-air verbs come from P2a's `liveCommands`), §13 ("Designs"; the Slides nav entry added by Task 22), §14 (Companion ids reserved for plan 3), §16 (stage layout rules: Tasks 18, 33, 34) and §15 (log). Edits in shared files (`server/src/index.ts`, `templates.ts`, `channels.ts`, `pco/importPlan.ts`) and the shell components / `timer/page.tsx` assignment: execution-order doc.

---

## Appendix: Fix-plan coverage (WS5, WS6, WS7, WS8 and the theme IDs they carry)

| ID | Covered by |
|---|---|
| GD-1 | Task 6 |
| GD-2 | Task 9 |
| GD-3 | Tasks 4, 7 |
| GD-4 | Task 12 |
| GD-5 | Tasks 8 (resizable), 10 (keyframe row) |
| GD-6 | Task 10 |
| GD-7 | Task 9 |
| GD-8 | Tasks 6 (Esc, pasteboard), 9 (Template tab) |
| GD-9, GD-10, GD-11, GD-12 | Task 9 (GD-10 also Task 7) |
| GD-13, GD-14 | Task 10 (GD-14 warning only; auto-fade stays D21 a) |
| GD-15, GD-16, GD-17, GD-18, GD-28, GD-29, GD-30 | P1.14, Designs list (LibraryList: duplicate, sort, secondary line, gallery, tabs, export name); thumbnails come from P1.14's grid view. 2b supplies the usage helper (Task 12); the editor-header id (GD-17) is gone in Task 8 |
| GD-19 | Task 8 (header), Task 22 (sub-nav) |
| GD-20 | Task 8 |
| GD-21 | Tasks 4, 9 |
| GD-22, GD-23 | Task 9 |
| GD-24 | P1.7 (`useUnsavedGuard` on the app dialog); verified in Task 8 |
| GD-25 | Task 8 [D5] |
| GD-26 | Deferred: D22 (multi-edit is a feature) |
| GD-27 | Task 9 |
| EXTRA-1 | Task 5 |
| STAGE-1, 2, 3, 6, 7, 10 | Task 13 [D8]; render in Task 14 |
| STAGE-4 | Tasks 13 (bar width), 14 (floor, wrap, operator warning) |
| STAGE-5, STAGE-8, STAGE-9 | Task 14 |
| STAGE-11, 12, 14, 15, 16 | Task 16 |
| STAGE-13, 17, 18, 19, 22, 23 | Task 17 (STAGE-17 sub-nav also Task 22) |
| STAGE-20 | Tasks 15 (tag, D20), 17 (switch, confirm) |
| STAGE-21 | P1.7 guard dialog; verified in Task 17 |
| STAGE-24, 25, 26, 27 | P1.14, Designs list, stage tab; STAGE-26 live stage-layout thumbnails deferred: D22 (needs a static stage-widgets render) |
| STAGE-28, 29, 30, 31, 32 | Task 18 |
| STAGE-33, 34, 35, 36, 37 | Task 19 |
| SS-1 | P1.1 (`PageBody variant`); adopted in Tasks 18–21, 23, 28, 29 |
| SS-2 | P1.9 + P1.12–P1.15 (list rows); Task 29 (`/projects`); P1.16 removes the old rows |
| SS-3 | P1.1 (`globals.css`) |
| SS-23 | P1.12–P1.15 (no ids in list subtitles); Task 29 (`/projects`) |
| SS-30 | P1.21 (dev asset proxy) |
| SS-4 | P1.6 (`useConnection`, `OfflineState`); Tasks 1, 3 (save offline), 20, 29 |
| SS-5 | Tasks 20, 22 |
| SS-6 | Tasks 19, 20 [D9] |
| SS-7 | Task 24 [D17] |
| SS-8 | Task 20 (duplicate pill); focus ring is P1.1 |
| SS-9 | Tasks 18, 19, 21 |
| SS-10, SS-11 | Tasks 18, 20, 21 |
| SS-12 | P1.1 (`PageBody`); Tasks 19, 20 |
| SS-13 | Tasks 21, 28 |
| SS-14, SS-15, SS-22 | Task 21 |
| SS-16 | Tasks 18, 20, 22, 28 |
| SS-17 | Tasks 22, 25 |
| SS-18 | Task 18 |
| SS-19, SS-20 | Task 23 |
| SS-21 | Task 21 (quick fix); the IA regroup stays D18 (later) |
| SS-24 | Tasks 1, 22 [D5] |
| SS-25 | Task 2 |
| SS-26 | Task 20 |
| SS-27, SS-28, SS-29 | Task 23 |
| LM-1, LM-2 | Done on main (a586aef, dc809b3, 35f0911, 3b668f3, fbab9b6); Task 25 keeps them in the rebuilt editor |
| LM-3 | Done on main (0715442, b27dbc2); Task 21 finishes the Integrations Disconnect; Task 26 keeps the /pco Disconnect |
| LM-4 | P1.9, P1.15 (LibraryList rows on /hotcards) |
| LM-5, LM-6, LM-25, LM-31 | Task 25 (LM-25 switcher also Task 22) |
| LM-7 | Tasks 28 (import project), 29 (Unassigned) |
| LM-8, LM-9, LM-21, LM-22, LM-23, LM-24 | Task 28 |
| LM-10, LM-11, LM-19, LM-20 | Task 26 |
| LM-12, LM-13, LM-14, LM-15 | Task 30 |
| LM-16 | Task 31 [D7] |
| LM-17, LM-18 | Task 32 |
| LM-26 | Task 25 (editor field); list menu "Move to <project>" in P1.15 |
| LM-27, LM-28, LM-29, LM-32 | Task 29 |
| LM-30 | P1.15 (/hotcards empty state) |
| LM-33 | Task 2 |
| LM-34 | Task 23 |
| EXTRA-2 | Task 27 |
| WS5.12, WS5.13 (list tasks) | P1.14, as above |
| D12 role selector | Task 9 (Template tab "Used for") |
| WS7.11 "sub-nav collapses to icons on editor routes" | Superseded by the spec ("labels at all widths"); Task 22 |
