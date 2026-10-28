# Redesign 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the charcoal visual system, the full `packages/ui` control set, the shared `LibraryList` on every library page, `TemplateThumbnail`, and native show sections (schema, helpers, PCO headers → sections, one-time backed-up migration), so plans 2a, 2b and 3 can build on them.

**Architecture:** Tokens live once in `globals.css` and are mirrored by name in `packages/ui/src/tokens.ts`. Every control is a `packages/ui` component whose decisions sit in a pure sibling module (`*Model.ts`, `*Queue.ts`), because Vitest runs in node without a DOM. App-wide services (dialogs, toasts) are module-level stores rendered by one host each in `app/layout.tsx`, so call sites need no per-page `{dialog}` node. Sections are additive fields on `Show`/rows with pure helpers in `packages/core/src/sections.ts`; every helper keeps `Show.rows` in display order, so Live's "next row" and Companion's row indexes stay correct without changes.

**Tech Stack:** TypeScript, React 19, Next 15 (operator), zod 3.25, Fastify server, Vitest 4 (node env), lucide-react icons, Playwright screenshots via `uxreview/lib.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md` (stage 1 of "Delivery"). **Contracts:** `docs/superpowers/plans/2026-10-28-redesign-contracts.md` §1–§5, §7 and §11 (this plan creates them; names are used exactly). **Execution order and file ownership:** `docs/superpowers/plans/2026-10-28-redesign-execution-order.md` (task ids `P1.n`, `P2a.n`, `P2b.n`, `P3.n`).

## Global Constraints

- Palette is neutral charcoal; starting tokens from the spec: background `#1b1b1d`, panel `#202022`, raised `#242426`, control `#3a3a3e`, border `#333336`, text `#e8e8ea`; muted text must be ≥ 4.5:1 on every surface and `apps/operator/src/app/shell/contrast.test.ts` must keep passing.
- Colour carries meaning only: red = on air / program, green = preview / next, blue `#4f7cff` = selection and primary actions. Kind colours: graphic `#60a5fa`, song `#f5b942`, slides `#34d399`, scripture `#f472b6`, video `#a78bfa`, section `#8e8e94`.
- Density: 11–13 px UI text; compact controls (button heights 24 px `sm`, 28 px `md`); hit targets ≥ 24 px, icon buttons 28 px.
- No browser-default controls; no `window.confirm`/`window.prompt` anywhere in files this plan owns; no hover-only actions.
- Copy is sentence case and follows the FIX-PLAN D11 glossary as amended by contracts §13: "New show", "New song", "New template", "New hotcard", "Designs" page with tabs "Graphics" and "Stage layouts", verbs Cue / Take / Clear.
- Never show an internal id as visible text; ids go in a "Copy id" menu item only.
- Icons are lucide (`lucide-react`), never emoji or text glyphs (no "×", "✓", "⋯" characters as icons).
- Schema changes are additive; existing show, song, template, hotcard and stage layout JSON must parse unchanged; migrations are idempotent and keep a backup (`<file>.pre-sections.bak`).
- Never type or paste real song lyrics; use placeholders ("Line one of verse one").
- Vitest is node-only: logic goes in pure modules with `*.test.ts` next to them. UI is verified by `pnpm typecheck`, `pnpm build` and a named screenshot.
- Screenshots: run `node <script>.mjs` from `/private/tmp/claude-501/-Users-mitchellpeck-WebstormProjects-OverlaySys/d399ff93-4d07-4c2a-8df1-56307d1cb584/scratchpad/uxreview/` using `open()`/`shot()` from `lib.mjs`. Save to `shots/after/redesign-1/<name>.png`. The shared operator on :3000 runs from the main checkout; to check a worktree, start its operator with `PORT=3002 pnpm --filter @overlaysys/operator dev` and point the script at :3002. Use Preview, never Program, on the shared stack.
- One commit per task, message names the FIX-PLAN IDs, ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before each commit: `pnpm vitest run <touched tests>`, `pnpm typecheck`; before the last commit of each phase also `pnpm test` and `pnpm build`.

## Review Focus

1. **Rows pointing at a section that doesn't exist** (hand-edited JSON, a cloud merge, a section deleted on another machine): the rows must still show, as "no section", and never disappear. Test `groupRowsBySection > rows with an unknown sectionId fall into the no-section group` in Task 18.
2. **A playable PCO item mistaken for a header** ("Offertory" can be either): only items Planning Center itself reports as `itemType: "header"` may become sections; with no PCO connection and no cache, nothing changes on disk. Tests `migrateHeaderRows > leaves PCO graphic rows whose item is not a known header` (Task 20) and `startHeaderMigration > no client and no cache writes no show file` (Task 20).
3. **Re-import after the operator re-sectioned a PCO row**: a row the operator moved into their own section stays there; only rows still in a PCO section (or none) follow the plan. Test `importPlan > keeps a row the operator moved into a manual section` in Task 19.
4. **Library pages while disconnected**: never "No songs yet"; show "Not connected to the server" and disable create with a reason. Test `listBodyState > error wins over empty` in Task 9; screenshot `list-offline` in Task 13.
5. **Stale or corrupt list preferences in localStorage** (a sort id from an older build, invalid JSON, a removed filter option): fall back to defaults without throwing. Test `loadListPrefs > unknown sort id and bad JSON fall back to defaults` in Task 9.

---

## File Structure

Owned by this plan (create C / modify M / delete D). Rows marked † are outside the ownership list in the brief and are claimed here as additive, foundation-only edits; shared files follow the rule in the execution-order doc.

**packages/ui** (all owned)
- M `package.json` — add `"lucide-react": "^1.60.0"` (and `pnpm-lock.yaml`†).
- M `src/tokens.ts`, `src/tokens.test.ts` — charcoal names, `kindColor`, `ItemKind`, control heights.
- M `src/Button.tsx`, `src/IconButton.tsx`, `src/Input.tsx`, `src/Textarea.tsx`, `src/Select.tsx`, `src/Modal.tsx`, `src/modalKeys.ts`, `src/modalKeys.test.ts`, `src/index.ts`.
- C `src/buttonStyles.ts` (+`.test.ts`) — pure variant/size → style.
- C `src/DeleteButton.tsx`, `src/Tooltip.tsx`, `src/KindBar.tsx`.
- C `src/NumberInput.tsx`, `src/numberDraft.ts` (+test) — draft parse/clamp/round, `roundTo`, `formatNumber`.
- C `src/SegmentedControl.tsx`, `src/Switch.tsx` (exports `Switch`, `Checkbox`), `src/roving.ts` (+test).
- C `src/FileDrop.tsx`, `src/fileAccept.ts` (+test).
- C `src/Menu.tsx` (`Menu`, `useContextMenu`), `src/menuModel.ts` (+test) — keyboard and placement.
- C `src/Dialog.tsx` (`Dialog`, `DialogHost`, `useConfirm`, `usePrompt`, `confirm`, `prompt`, `chooseAction`, `alertDialog`), `src/dialogStore.ts` (+test).
- C `src/Toast.tsx` (`ToastHost`, `useToast`, `toast`), `src/toastQueue.ts` (+test).
- C `src/SaveBar.tsx`, `src/saveBarState.ts` (+test).
- C `src/OfflineState.tsx`, `src/offlineCopy.ts` (+test).
- C `src/LibraryList.tsx`, `src/libraryListModel.ts` (+test).
- D `src/EntityList.tsx` (Task 16).
- (`src/numberDraft.ts` also gains `precision` support and is re-exported by `packages/editor-kit/src/numberFormat.ts`, P2b.4.)

**apps/operator**
- M `src/app/globals.css`, `src/app/layout.tsx`; C `src/app/palette.test.ts`.
- M `src/app/components/PageShell.tsx` (`variant`); D `src/app/components/ManagementList.tsx` (Task 16, after P2b.29 moves `/projects` to `LibraryList`).
- M `src/lib/dialog.tsx`, `src/lib/useUnsavedGuard.ts`; C `src/lib/unsavedGuardFlow.ts` (+test).
- C `src/lib/awaitAck.ts` (+test), `src/lib/useConnection.ts`, `src/lib/templateRoles.ts` (+test), `src/lib/listFormat.ts` (+test), `src/lib/exportName.ts` (+test).
- C `src/lib/thumbnails/TemplateThumbnail.tsx`, `src/lib/thumbnails/sampleData.ts` (+test), `src/lib/thumbnails/thumbKey.ts` (+test), `src/lib/thumbnails/useTemplateBody.ts`.
- M `src/app/shows/page.tsx`, `src/app/songs/page.tsx`, `src/app/hotcards/page.tsx`, `src/app/design/page.tsx`.
- M† `src/app/songs/librarySearch.ts` (+test) — songs list sort/filter helpers used only by `/songs`.
- C† `src/app/design/NewTemplateDialog.tsx`. (Template usage client, route and server helper are P2b.12's, contracts §8.)
- M† `src/lib/store.ts` — `ShowMeta` type gains optional fields only.

**packages/core**
- M `src/show.ts` (+`show.test.ts`), C `src/sections.ts` (+test), M `src/index.ts` (export line).
- C `src/stageLayoutRules.ts` (+test), M† `src/channelConfig.ts` (`layoutRules`, Task 22).
- M `src/song.ts` — `createdAt` only.
- C `src/pco/headerSections.ts` (+test), M `src/pco/index.ts` (export line).
- M† `src/template.ts` — `role` field and `TemplateMeta` (`role`, `updatedAt`) only.
- M† `src/stageLayout.ts` — `StageLayoutMetaSchema.updatedAt` only.

**packages/ws-protocol**
- M† `src/index.ts` — `show_list` and `template_list` item objects gain optional fields only.

**server**
- M `src/shows.ts` — list meta fields, duplicate keeps sections/date, migration hook.
- M `src/pco/importPlan.ts` (+`importPlan.test.ts`) — headers → sections only.
- C `src/pco/headerMigration.ts` (+test).
- M† `src/templates.ts` (meta `role`/`updatedAt`), `src/songs.ts` (stamp `createdAt` for new ids), `src/songLibraryRoute.ts` (+test: `createdAt`, `lastUsed`).
- M† `src/index.ts` — one line: start the header migration after `reloadShows()` (shared file, marked block).

**build config** (Task 21)
- M† `apps/renderer/vite.config.ts` (dev `/assets` proxy), `apps/operator/next.config.mjs` (dev `/assets` rewrite, dev indicator position).

---

## Phase A — tokens and controls

These unblock all screen work in plans 2a, 2b and 3. Tasks 2–7 each add export lines to `packages/ui/src/index.ts`; resolve those trivial conflicts by keeping all lines.

### Task 1: Charcoal palette, kind colours, globals and page frame

**Depends on:** nothing. **Unblocks:** everything visual (2a, 2b, 3).

**Files:**
- Modify: `packages/ui/src/tokens.ts`, `packages/ui/src/tokens.test.ts`
- Modify: `apps/operator/src/app/globals.css`
- Create: `apps/operator/src/app/palette.test.ts`, `apps/operator/src/app/components/pageBody.ts`, `pageBody.test.ts`
- Modify: `apps/operator/src/app/components/PageShell.tsx`

**Interfaces:**
- Produces (CSS vars, all `#rrggbb` literals unless noted): `--bg #1b1b1d`, `--surface #202022`, `--surface-2 #242426`, `--surface-3 #2c2c2f`, `--control #3a3a3e`, `--border #333336`, `--border-strong #45454a`, `--text #e8e8ea`, `--text-dim #aaaab0` (tuned from `#a0a0a6` so it is also AA on `--control`, 4.90:1), `--text-muted #98989e` (tuned from `#8e8e94`, which is 4.27:1 on `--surface-3`; this is 4.85:1), `--brand #4f7cff`, `--brand-hover #6a90ff`, `--brand-subtle rgba(79,124,255,0.18)`, `--brand-text #7b9dff` (5.38:1 on surface-3), `--brand-fill #3a66f0` (white 4.84:1), `--onair #e5484d`, `--onair-fill #d13b40` (white 4.76:1), `--ok #30a46c`, `--ok-fill #24855a` (white 4.59:1), `--ok-subtle rgba(48,164,108,0.18)`, `--warn #f5b942`, `--danger #e5484d`, `--danger-text #f2777b` (5.10:1 on surface-3), `--kind-graphic #60a5fa`, `--kind-song #f5b942`, `--kind-slides #34d399`, `--kind-scripture #f472b6`, `--kind-video #a78bfa`, `--kind-section #8e8e94`. Aliases stay: `--accent: var(--brand)`, `--panel`, `--panel-2`, `--accent-2`, `--green`, `--red`. `--grad-brand: linear-gradient(135deg, #4f7cff, #30a46c)`.
- Produces (`tokens.ts`): `colors` gains `control`, `okFill`, `dangerText`; keeps every existing key. `type ItemKind = "graphic" | "song" | "slides" | "scripture" | "video" | "section"`; `kindColor: Record<ItemKind, string>` (values `"var(--kind-<kind>)"`); `control` sizes gain `height`: `sm 24`, `md 28`, `lg 32` (`padX` 8/10/12, `fontSize` 12/13/13); `radius` becomes `{ sm: 4, md: 6, lg: 8, xl: 12, pill: 999 }`.
- Produces (`PageShell.tsx`, contracts §7): `PageBody` gains `variant?: "form" | "wide" | "list"` — `form` = content max 760 px, `wide` = max 1100 px, `list` = full width; every variant is left-aligned (no auto margins), padding 24, a flex column with `gap: 16`; an explicit `maxWidth` still wins; default (no variant) keeps today's behaviour. This is the one page width model: plan 2b's settings, /data, /projects, /account and not-found pages use it (no `PageFrame`).

- [ ] **Step 1: Write the failing tests**

`apps/operator/src/app/palette.test.ts` reads `globals.css` with the same `cssVar`/`contrast` helpers as `shell/contrast.test.ts` (copy them; don't import from `shell/`):

```ts
it("uses the charcoal surfaces from the spec", () => {
  expect([cssVar("bg"), cssVar("surface"), cssVar("surface-2"), cssVar("control"), cssVar("border")])
    .toEqual(["#1b1b1d", "#202022", "#242426", "#3a3a3e", "#333336"]);
});
it("--text and --text-dim are AA on --control", () => {
  for (const fg of ["text", "text-dim"]) expect(contrast(cssVar(fg), cssVar("control"))).toBeGreaterThanOrEqual(4.5);
});
it("--danger-text is AA on every surface", () => { /* bg, surface, surface-2, surface-3 ≥ 4.5 */ });
it("white is AA on --ok-fill", () => expect(contrast("#ffffff", cssVar("ok-fill"))).toBeGreaterThanOrEqual(4.5));
it("defines every kind colour", () => {
  expect(["graphic","song","slides","scripture","video","section"].map((k) => cssVar(`kind-${k}`)))
    .toEqual(["#60a5fa","#f5b942","#34d399","#f472b6","#a78bfa","#8e8e94"]);
});
it("has no hover-only row actions", () => expect(css).not.toMatch(/\.row-actions\s*\{[^}]*opacity:\s*0/));
it("keeps sub-nav labels at every width", () => expect(css).not.toMatch(/\.shell-subnav-label\s*\{\s*display:\s*none/));
```

`tokens.test.ts`: replace "flips legacy accent to the indigo brand" with "legacy accent is the brand" (`colors.accent === colors.brand`); replace the radius test with `expect(radius.md).toBe(6)`; add `kindColor` has exactly the six `ItemKind` keys, each `var(--kind-…)`; `control.sm.height === 24 && control.md.height === 28`.

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run apps/operator/src/app/palette.test.ts apps/operator/src/app/components/pageBody.test.ts packages/ui/src/tokens.test.ts` → FAIL on surface values and `kindColor` undefined.

- [ ] **Step 3: Implement**
  - `globals.css` `:root`: the values in Interfaces. `html, body { font-size: 13px }`.
  - Add `input[type=checkbox], input[type=radio], input[type=range] { accent-color: var(--brand); }`.
  - Input focus: `box-shadow: 0 0 0 2px var(--brand)` (replaces the 3 px subtle ring).
  - Delete the `.row-actions` opacity rules.
  - Media query `max-width: 1365px`: keep the gap/title tightening; remove `.shell-subnav { width: 52px … }`, `.shell-subnav-label { display: none }` and `.shell-status-label { display: none }`. Sub-nav is `width: 160px` at every width.
  - `PageShell.tsx` `variant` as specified, built on a pure `pageBodyStyle(variant)` in `apps/operator/src/app/components/pageBody.ts`, tested in `pageBody.test.ts`: `pageBodyStyle("form").maxWidth === 760`, `pageBodyStyle("wide").maxWidth === 1100`, `pageBodyStyle("list").maxWidth === undefined`, `marginLeft` is never `"auto"`, `padding === 24`, `gap === 16`.
  - `tokens.ts` as specified.

- [ ] **Step 4: Run tests** — the two files above plus `apps/operator/src/app/shell/contrast.test.ts` → PASS.

- [ ] **Step 5: Screenshot check** — `after/redesign-1/palette-live-1440` (Live at 1440×900) and `after/redesign-1/subnav-1024` (/settings at 1024×768). Look for: charcoal greys, no navy; sub-nav labels visible at 1024; measure `document.querySelector("header").scrollWidth <= clientWidth` at 1024 and 1280.

- [ ] **Step 6: Commit** — `feat(ui): charcoal palette, kind colours, page body variants [SS-3, SS-8, SS-19, SHOWS-24, LIVE-15, SS-1, SS-12]`

---

### Task 2: Buttons, fields, tooltip and kind bar

**Depends on:** Task 1 (token names; may start in parallel against the Interfaces above). **Unblocks:** Tasks 3–6, 9; every screen in 2a/2b/3.

**Files:**
- Modify: `packages/ui/package.json` (lucide-react), `pnpm-lock.yaml`, `packages/ui/src/Button.tsx`, `IconButton.tsx`, `Input.tsx`, `Textarea.tsx`, `Select.tsx`, `index.ts`
- Create: `packages/ui/src/buttonStyles.ts`, `buttonStyles.test.ts`, `DeleteButton.tsx`, `Tooltip.tsx`, `KindBar.tsx`

**Interfaces:**
- Produces: `type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "onair" | "destructive" | "success"` (the last two kept as deprecated aliases: `destructive` → `danger` filled style for confirm buttons, `success` → `secondary`). `Button` props: `variant?`, `size?: "sm" | "md"` (`lg` still accepted), `block?`, `icon?: ReactNode` (leading lucide icon), native props.
- Produces: `variantStyle(variant: ButtonVariant, disabled: boolean): CSSProperties` and `sizeStyle(size: ControlSize): CSSProperties` in `buttonStyles.ts`.
- Produces: `IconButton` — `aria-label` required at the type level (`"aria-label": string`), `size?: number` default 28, `tone?: "default" | "danger"`.
- Produces: `DeleteButton({ name: string; onClick; disabled?; size? })` — IconButton with lucide `Trash2`, `aria-label` and `title` = `Delete ${name}`, `textDim` at rest, `dangerText` on hover/focus.
- Produces: `Tooltip({ content: ReactNode; children: ReactElement; side?: "top" | "bottom" })` — shows after 400 ms hover or immediately on keyboard focus, hides on Esc/blur/leave; portal to `document.body`; sets `aria-describedby` on the child.
- Produces: `KindBar({ kind: ItemKind })` — `<span aria-hidden>` 3 px wide, `align-self: stretch`, `border-radius: 2`, background `kindColor[kind]`.
- `Input`/`Textarea`/`Select`: same props as today; background `--surface-2`, 1 px `--border`, radius `md`, height = `control[size].height` (Input/Select); `Select` uses `appearance: none` with a lucide-style chevron as a CSS background (data-URI SVG, colour `#aaaab0`).

- [ ] **Step 1: Write the failing test** `buttonStyles.test.ts`:

```ts
it("never wraps", () => expect(variantStyle("primary", false).whiteSpace).toBe("nowrap"));
it("primary is the brand fill with white text", () =>
  expect(variantStyle("primary", false)).toMatchObject({ background: colors.brandFill, color: "#fff" }));
it("onair uses the on-air fill", () => expect(variantStyle("onair", false).background).toBe(colors.onairFill));
it("a disabled filled button renders as secondary in muted text at full opacity", () => {
  for (const v of ["primary", "onair", "danger", "destructive"] as const) {
    expect(variantStyle(v, true)).toMatchObject({ background: colors.surface2, color: colors.textMuted, opacity: 1 });
  }
});
it("danger is an outline in danger text", () =>
  expect(variantStyle("danger", false)).toMatchObject({ background: "transparent", color: colors.dangerText }));
it("sizes are 24 and 28 px tall", () => {
  expect(sizeStyle("sm").height).toBe(24); expect(sizeStyle("md").height).toBe(28);
});
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/buttonStyles.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `buttonStyles.ts`, then rebuild `Button.tsx` on it (`display: inline-flex; align-items: center; gap: 6`); the other components as in Interfaces. Export all new names from `index.ts`. Run `pnpm install` to update the lockfile.
- [ ] **Step 4: Run** the test → PASS; `pnpm typecheck` → PASS (fix any `IconButton` call site missing `aria-label` in files this plan owns; for files owned by other plans, `aria-label` is required by type — if typecheck fails there, make the prop `aria-label?: string` with a dev-only `console.warn` instead and note it for 2a/2b).
- [ ] **Step 5: Screenshot** `after/redesign-1/buttons-onair-disabled` — Live at 1280×800 with nothing cued: the PVW Take is grey, not red; "Save (⌘S)" in the template editor header is one 28 px line at 1024×768.
- [ ] **Step 6: Commit** — `feat(ui): restyled buttons and fields, DeleteButton, Tooltip, KindBar [LIVE-15, LIVE-16, SS-10, SS-11]`

---

### Task 3: Value controls — NumberInput, SegmentedControl, Switch/Checkbox, FileDrop

**Depends on:** Task 2. **Unblocks:** 2b designers/settings (NumberInput, SegmentedControl), 2a song editor, 3 deck licensing (Switch), 2a/2b import modals (FileDrop).

**Files:**
- Create: `packages/ui/src/NumberInput.tsx`, `numberDraft.ts`, `numberDraft.test.ts`, `SegmentedControl.tsx`, `Switch.tsx`, `roving.ts`, `roving.test.ts`, `FileDrop.tsx`, `fileAccept.ts`, `fileAccept.test.ts`; Modify `index.ts`

**Interfaces:**
- Produces: `NumberInput({ value: number; onCommit(v: number): void; min?: number; max?: number; step?: number; int?: boolean; precision?: number; suffix?: string; "aria-label"?: string; id?: string; size?: "sm" | "md"; disabled?: boolean })`. `precision` fixes the decimal places for display and commit (contracts §2; requested by plan 2b for GD-3/STAGE-14). Shows `formatNumber(value, decimals)`; keeps a text draft; commits on blur/Enter; Esc reverts the draft; ↑/↓ adds ±`step` (Shift ×10) and commits; an unparseable draft reverts on blur; `suffix` renders inside the right edge in `textMuted`.
- Produces (`numberDraft.ts`): `roundTo(v: number, dp: number): number`; `formatNumber(v: number, dp: number): string` (no trailing zeros); `decimalsFor(step?: number, int?: boolean, precision?: number): number` (precision wins; int → 0; step 0.1 → 1; step 0.25 → 2; default 2); `roundTo` rounds half away from zero (`Math.sign(v) * Math.round(Math.abs(v) * 10**dp) / 10**dp`); `parseDraft(text: string, o: { min?; max?; int?; step? }): number | null` (accepts `,` as decimal point, trims, clamps, rounds to `decimalsFor`); `stepValue(v, dir: 1 | -1, o & { big?: boolean }): number`.
- Produces: `SegmentedControl<T extends string>({ value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange(v: T): void; size?: "sm" | "md"; "aria-label"?: string })` — `role="radiogroup"`, each segment `role="radio"`, selected = `brandFill` background white text, others `surface2`; roving tabindex; ←/→/Home/End move and select.
- Produces (`roving.ts`): `nextRovingIndex(count: number, index: number, key: string): number | null` (null = key not handled; wraps).
- Produces: `Switch({ checked: boolean; onChange(b: boolean): void; label?: ReactNode; disabled?; "aria-label"? })` — `role="switch"`, `aria-checked`, 28×16 track, label clickable. `Checkbox` — same props, styled box with lucide `Check`.
- Produces: `FileDrop({ accept: string; onFile(f: File): void; hint?: ReactNode; buttonLabel?: string /* default "Choose file…" */; file?: File | null; onClear?(): void })` — hidden `<input type=file>`, dashed zone, a chip with the filename and a 28 px clear IconButton (`aria-label="Remove <name>"`); a rejected drop shows inline "That file type isn't supported here."
- Produces (`fileAccept.ts`): `acceptsFile(name: string, mime: string, accept: string): boolean` (comma list of `.ext`, `type/*`, `type/sub`; empty accept = true; case-insensitive).

- [ ] **Step 1: Write the failing tests**

```ts
// numberDraft.test.ts
expect(roundTo(460.00000000000006, 2)).toBe(460);
expect(roundTo(1169.9115, 2)).toBe(1169.91);
expect(roundTo(-0.5, 0)).toBe(-1);
expect(formatNumber(0.30000000000000004, 2)).toBe("0.3");
expect(decimalsFor(0.1, false, 3)).toBe(3);
expect(formatNumber(12.5, 2)).toBe("12.5");
expect(parseDraft(" 3,5 ", { step: 0.5 })).toBe(3.5);
expect(parseDraft("abc", {})).toBeNull();
expect(parseDraft("250", { max: 100 })).toBe(100);
expect(parseDraft("2.6", { int: true })).toBe(3);
expect(stepValue(1, 1, { step: 0.1 })).toBe(1.1);       // not 1.1000000000000001
expect(stepValue(5, -1, { step: 1, min: 0, big: true })).toBe(0);
// roving.test.ts
expect(nextRovingIndex(3, 2, "ArrowRight")).toBe(0);
expect(nextRovingIndex(3, 0, "ArrowLeft")).toBe(2);
expect(nextRovingIndex(3, 1, "End")).toBe(2);
expect(nextRovingIndex(3, 1, "a")).toBeNull();
// fileAccept.test.ts
expect(acceptsFile("Song.CHO", "", ".txt,.cho")).toBe(true);
expect(acceptsFile("a.png", "image/png", "image/*")).toBe(true);
expect(acceptsFile("a.pdf", "application/pdf", ".txt,.cho")).toBe(false);
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/numberDraft.test.ts packages/ui/src/roving.test.ts packages/ui/src/fileAccept.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three pure modules, then the four components on them.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Screenshot** — temporarily render the four controls on /settings/connection in a worktree-only scratch block (do not commit it), shot `after/redesign-1/value-controls`: segmented selection is blue, switch shows focus ring, NumberInput with suffix "px".
- [ ] **Step 6: Commit** — `feat(ui): NumberInput, SegmentedControl, Switch, Checkbox, FileDrop [STAGE-11, GD-11, GD-29, STAGE-20, LM-9, SS-13, GD-3]`

---

### Task 4: Menu and useContextMenu

**Depends on:** Task 2 (Tooltip). **Unblocks:** Task 9; 2a rundown row menus; 2b designer layer menus.

**Files:**
- Create: `packages/ui/src/Menu.tsx`, `menuModel.ts`, `menuModel.test.ts`; Modify `index.ts`

**Interfaces:**
- Produces (contract §2): `type MenuItem = { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean | string; shortcut?: string; onSelect(): void } | { separator: true }`; `Menu({ items, anchor: { x: number; y: number } | HTMLElement, onClose(): void })`; `useContextMenu(): { open(e: React.MouseEvent | HTMLElement, items: MenuItem[]): void; menu: ReactNode }`.
- Produces (`menuModel.ts`): `nextMenuIndex(items: MenuItem[], active: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): number` (skips separators and disabled, wraps; −1 when none enabled); `isEnabled(item: MenuItem): boolean`; `placeMenu(anchor: { x: number; y: number; w?: number; h?: number }, size: { w: number; h: number }, viewport: { w: number; h: number }, margin = 8): { x: number; y: number }` (below-right of a point / below-left of an element; flips up/left when it would overflow; clamps inside the margin).
- Behaviour: portal to body, `role="menu"`, items `role="menuitem"`, 28 px rows, 12 px text, shortcut right-aligned in `textMuted`, `danger` items in `dangerText`; a `disabled` string shows as a Tooltip on the item. Opening focuses the first enabled item; Esc, Tab, outside click, scroll and window blur close it and return focus to the opener; Enter/Space select; `open(e)` calls `e.preventDefault()` for mouse events; ContextMenu key / Shift+F10 on a focused element open at its rect.

- [ ] **Step 1: Write the failing test**

```ts
const items: MenuItem[] = [
  { id: "a", label: "Open", onSelect() {} }, { separator: true },
  { id: "b", label: "Rename", disabled: "Not connected", onSelect() {} },
  { id: "c", label: "Delete", danger: true, onSelect() {} },
];
expect(nextMenuIndex(items, 0, "ArrowDown")).toBe(3);
expect(nextMenuIndex(items, 3, "ArrowDown")).toBe(0);
expect(nextMenuIndex(items, 0, "End")).toBe(3);
expect(nextMenuIndex([{ separator: true }], -1, "ArrowDown")).toBe(-1);
expect(placeMenu({ x: 1400, y: 880 }, { w: 200, h: 160 }, { w: 1440, h: 900 })).toEqual({ x: 1200, y: 720 });
expect(placeMenu({ x: 10, y: 10 }, { w: 200, h: 160 }, { w: 1440, h: 900 })).toEqual({ x: 10, y: 10 });
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/menuModel.test.ts` → FAIL.
- [ ] **Step 3: Implement** `menuModel.ts`, then `Menu.tsx`.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(ui): context menu with keyboard and viewport flip (D10 superseded)`

---

### Task 5: Dialogs and toasts (replaces window.confirm)

**Depends on:** Task 2. **Unblocks:** Tasks 6, 7, 12–15; every confirm/prompt in 2a/2b/3.

**Files:**
- Create: `packages/ui/src/Dialog.tsx`, `dialogStore.ts`, `dialogStore.test.ts`, `Toast.tsx`, `toastQueue.ts`, `toastQueue.test.ts`
- Modify: `packages/ui/src/Modal.tsx`, `modalKeys.ts`, `modalKeys.test.ts`, `index.ts`
- Modify: `apps/operator/src/app/layout.tsx`, `apps/operator/src/lib/dialog.tsx`

**Interfaces:**
- Produces (contract §2): `Dialog` (the styled shell — re-export of the restyled `Modal` under this name; `Modal` stays exported), `useConfirm(): (o: ConfirmOptions) => Promise<boolean>` with `type ConfirmOptions = { title: string; message: ReactNode; confirmLabel: string; cancelLabel?: string /* "Cancel" */; danger?: boolean }`.
- Produces (additive): `confirm(o: ConfirmOptions): Promise<boolean>`; `prompt(o: PromptOptions): Promise<string | null>` and `usePrompt()`, `type PromptOptions = { title: string; message?: ReactNode; defaultValue?: string; placeholder?: string; confirmLabel: string; required?: boolean; validate?(v: string): string | null }` (resolves the trimmed value); `chooseAction(o: { title: string; message: ReactNode; actions: { id: string; label: string; variant?: ButtonVariant }[]; cancelId: string }): Promise<string>` (Esc/backdrop resolve `cancelId`); `alertDialog(o: { title: string; message: ReactNode; okLabel?: string }): Promise<void>`; `<DialogHost />`.
- Produces (`dialogStore.ts`, pure): `createDialogStore()` → `{ open<R>(spec: DialogSpec, fallback: R): Promise<R>; current(): ActiveDialog | null; resolve(value: unknown): void; subscribe(fn): () => void }` — FIFO, one visible at a time; `resolve` settles the current one and shows the next.
- Produces (contract §2): `useToast(): (o: ToastOptions) => void` and `toast(o: ToastOptions): void`, `type ToastOptions = { message: string; tone?: "info" | "ok" | "warn" | "error"; action?: { label: string; onClick(): void }; durationMs?: number }`; `<ToastHost />` — bottom-centre, `aria-live="polite"` (`assertive` for error), stack of at most 3, dismiss IconButton `aria-label="Dismiss"`.
- Produces (`toastQueue.ts`, pure): `createToastQueue(now: () => number)` → `{ push(o): string /* id */; dismiss(id): void; expire(): void; list(): ToastEntry[] }`; durations default 4000 ms, 8000 ms for `error` and for toasts with an `action`; an identical `message`+`tone` within 1000 ms is deduped (returns the existing id); cap 3, oldest dropped.
- Produces (`modalKeys.ts`): `shouldConfirmOnEnter(tagName: string, isContentEditable: boolean, o?: { danger?: boolean; focusedIsConfirm?: boolean }): boolean` — when `danger`, true only if `focusedIsConfirm`.
- `Modal.tsx`: body `white-space: normal; overflow-wrap: anywhere`; confirms focus Cancel on open with a forced visible focus ring (`data-focus-visible` attribute styled in globals). Keys still stop at the dialog (Esc in a dialog must never reach Live's Esc).
- `layout.tsx`: render `<DialogHost />` and `<ToastHost />` once, inside `<body>` after `<CloudBoot>`.
- `lib/dialog.tsx`: `useDialog()` keeps its return shape `{ confirm, alert, prompt, dialog }` for every existing call site, but delegates to the global functions; `dialog` is always `null`; `destructive` maps to `danger`; `prompt` passes `required`/`validate` through.

- [ ] **Step 1: Write the failing tests**

```ts
// dialogStore.test.ts
it("shows one dialog at a time, FIFO", async () => {
  const s = createDialogStore();
  const a = s.open({ kind: "confirm", title: "A" } as DialogSpec, false);
  const b = s.open({ kind: "confirm", title: "B" } as DialogSpec, false);
  expect(s.current()?.spec.title).toBe("A");
  s.resolve(true); await expect(a).resolves.toBe(true);
  expect(s.current()?.spec.title).toBe("B");
  s.resolve(undefined); await expect(b).resolves.toBe(false); // undefined → fallback
});
// toastQueue.test.ts
it("dedupes an identical message within 1 s", () => { /* push twice at t=0 and t=900 → 1 entry; t=1100 → 2 */ });
it("keeps at most 3, dropping the oldest", () => { /* push 4 distinct → list ids are 2,3,4 */ });
it("expires info after 4 s and error after 8 s", () => { /* advance fake now; expire() */ });
// modalKeys.test.ts (added cases)
expect(shouldConfirmOnEnter("INPUT", false, { danger: true, focusedIsConfirm: false })).toBe(false);
expect(shouldConfirmOnEnter("BUTTON", false, { danger: true, focusedIsConfirm: true })).toBe(false); // native click already fires
expect(shouldConfirmOnEnter("DIV", false, { danger: true, focusedIsConfirm: true })).toBe(true);
expect(shouldConfirmOnEnter("INPUT", false)).toBe(true);
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/dialogStore.test.ts packages/ui/src/toastQueue.test.ts packages/ui/src/modalKeys.test.ts` → FAIL.
- [ ] **Step 3: Implement** stores, `Dialog.tsx` (renders the current spec with `Modal`: confirm → Cancel ghost + confirm `primary`/`destructive`; prompt → `Input` with inline error under it, confirm disabled while `required` and empty or `validate` returns text, error text default "Enter a name"; choose → one Button per action), `Toast.tsx`, `Modal`/`modalKeys` changes, `layout.tsx`, `lib/dialog.tsx`.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS; `grep -rn "window.confirm\|window.prompt" apps/operator/src/lib/dialog.tsx packages/ui/src` → no matches.
- [ ] **Step 5: Screenshot** `after/redesign-1/confirm-wrap` — on Live, open the show picker and pick another show while one is loaded (the "switch show" confirm): long message wraps, Cancel has a visible focus ring; `after/redesign-1/prompt-required` — /songs "New song" with an empty name: Create disabled, "Enter a name" visible.
- [ ] **Step 6: Commit** — `feat(ui): app dialogs and toasts replace native confirm [LIVE-18, LIVE-35, SONGS-33, SHOWS-16, SONGS-26, LM-27, SS-29]`

---

### Task 6: Save and connection kit — SaveBar, awaitAck, useConnection, OfflineState

**Depends on:** Tasks 2, 5. **Unblocks:** 2a show/song editors, 2b designers/settings/hotcard editor (save model everywhere), Tasks 12–15. This is the single owner of `awaitAck`, `useConnection` and `OfflineState` (contracts §7); P2a.6 is moved here and P2b.1/P2b.3 consume these instead of creating their own.

**Files:**
- Create: `packages/ui/src/SaveBar.tsx`, `saveBarState.ts`, `saveBarState.test.ts`, `OfflineState.tsx`, `offlineCopy.ts`, `offlineCopy.test.ts`; Modify `index.ts`
- Create: `apps/operator/src/lib/awaitAck.ts`, `awaitAck.test.ts`, `apps/operator/src/lib/useConnection.ts`

**Interfaces:**
- Produces (contract §2): `SaveBar({ dirty: boolean; saving: boolean; onSave(): void; onRevert(): void; disabledReason?: string })` — an inline cluster for a page header: status text, "Revert" (ghost, asks `confirm({ title: "Revert changes?", message: "Your unsaved edits will be lost.", confirmLabel: "Revert", danger: true })`), "Save" (primary) with `Kbd` "⌘S" (Ctrl+S off-mac). While mounted it binds ⌘/Ctrl+S (`preventDefault`) to `onSave` when save is enabled.
- Produces (`saveBarState.ts`): `saveBarState(i: { dirty: boolean; saving: boolean; disabledReason?: string; justSaved: boolean }): { status: "unsaved" | "saving" | "saved" | "clean"; statusText: string; saveEnabled: boolean; revertEnabled: boolean; saveTitle: string }`. Copy: unsaved "Unsaved changes" (with an 8 px `warn` dot), saving "Saving…", saved "Saved" (lucide `Check`, shown 2 s after saving → clean), clean "" ; `saveTitle` = `disabledReason` when set, "No changes to save" when clean, else "Save (⌘S)".
- Produces (contracts §2): `OfflineState({ noun?: string; variant?: "empty" | "stale"; onRetry(): void; compact?: boolean; children?: ReactNode })` — title and body from `offlineCopy`, Button "Retry" (secondary, lucide `RefreshCw`); `stale` renders a slim notice above `children`.
- Produces (`offlineCopy.ts`): `offlineCopy(noun?: string, variant: "empty" | "stale" = "empty"): { title: string; body: string }` — empty with a noun → `{ title: "Can't load <noun>", body: "Not connected to the server." }`; empty without → `{ title: "Not connected to the server", body: "Retrying automatically." }`; stale → `{ title: "Not connected to the server", body: "Showing what was last loaded." }`.
- Produces (`awaitAck.ts`): `type AckClient = { send(m: ClientMessage): void; on(l: (m: ServerMessage) => void): () => void; onStatus(l: (s: WsStatus) => void): () => void; getStatus(): WsStatus }`; `class AckError extends Error { code: "not_connected" | "timeout" | "disconnected" | "server_error" }`; `sendAndAwaitAck(client: AckClient, message: ClientMessage, match: { op: string; id?: string }, o?: { timeoutMs?: number /* 8000 */ }): Promise<void>` (no `id` = the first ack for `op`; also rejects `server_error` on `{ type: "error" }` with code `handler_error` / `bad_message` / `not_found` for that op); `requestOne<T>(client: AckClient, message: ClientMessage, pick: (m: ServerMessage) => T | undefined, o?: { timeoutMs?: number /* 5000 */ }): Promise<T>`; `ackErrorText(e: unknown): string`. Error messages: not_connected "Not connected to the server.", timeout "The server didn't confirm in time.", disconnected "Disconnected before the server confirmed.", server_error = the server's message. Callers pass `getClient()` (it satisfies `AckClient`) and toast `` `Not saved: ${ackErrorText(e)}` `` on failure.
- Produces (`useConnection.ts`): `useConnection(): { connected: boolean; conn: WsStatus; retry(): void }` — `connected = isCloudMode() || conn === "open"`, `retry` = `reconnectNow()`.

- [ ] **Step 1: Write the failing tests**

```ts
// saveBarState.test.ts
expect(saveBarState({ dirty: true, saving: false, justSaved: false })).toMatchObject({ status: "unsaved", saveEnabled: true, revertEnabled: true });
expect(saveBarState({ dirty: true, saving: false, justSaved: false, disabledReason: "Reconnect to save" }))
  .toMatchObject({ saveEnabled: false, saveTitle: "Reconnect to save", revertEnabled: true });
expect(saveBarState({ dirty: false, saving: false, justSaved: true }).statusText).toBe("Saved");
expect(saveBarState({ dirty: false, saving: false, justSaved: false })).toMatchObject({ saveEnabled: false, saveTitle: "No changes to save" });
// awaitAck.test.ts — fake client with manual emit()
it("resolves on the matching ack", ...);          // emit {type:"ack",op:"save_show",id:"s1"}
it("ignores an ack for another id", ...);
it("rejects at once with not_connected when closed", ...); // getStatus() === "closed", send not called
it("rejects with disconnected when status leaves open", ...);
it("rejects with timeout", ...);                   // vi.useFakeTimers, advance 8000
it("requestOne returns the picked payload", ...);  // pick show by id from {type:"show"}
it("an ack match without id resolves on the first ack for that op", ...);
// offlineCopy.test.ts
expect(offlineCopy("songs", "empty")).toEqual({ title: "Can't load songs", body: "Not connected to the server." });
expect(offlineCopy(undefined, "stale")).toEqual({ title: "Not connected to the server", body: "Showing what was last loaded." });
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/saveBarState.test.ts packages/ui/src/offlineCopy.test.ts apps/operator/src/lib/awaitAck.test.ts` → FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(ui): SaveBar, ack-awaiting saves, connection hook and offline state [SHOWS-2, SHOWS-28, SONGS-16, SS-6, STAGE-29, STAGE-33, SS-4]`

---

### Task 7: Unsaved-changes guard on the app dialog

**Depends on:** Task 5. **Unblocks:** 2a/2b editors (Save and leave).

**Files:**
- Modify: `apps/operator/src/lib/useUnsavedGuard.ts`
- Create: `apps/operator/src/lib/unsavedGuardFlow.ts`, `unsavedGuardFlow.test.ts`
- (Do not modify `lib/stageDesigner.ts`; reuse its guard helpers as they are.)

**Interfaces:**
- Consumes: `chooseAction` (Task 5); `shouldConfirmLinkNavigation`, `sentinelPopAction`, `shouldDisarmSentinel` from `lib/stageDesigner.ts`.
- Produces: `useUnsavedGuard(dirty: boolean, opts?: UnsavedGuardOptions): void` — same signature; `UnsavedGuardOptions` gains `onSave?: () => Promise<boolean>`. `DEFAULT_UNSAVED_PROMPT` becomes "You have unsaved changes." (message body); dialog title "Leave without saving?".
- Produces (`unsavedGuardFlow.ts`): `guardActions(canSave: boolean): { id: "stay" | "discard" | "save"; label: string; variant: ButtonVariant }[]` → `[Stay (secondary), Discard changes (danger), Save and leave (primary, only when canSave)]`; `afterChoice(choice: "stay" | "discard" | "save", saved: boolean | null, origin: "link" | "pop"): { navigate: boolean; historySteps: number }` — link + discard → `{ navigate: true, historySteps: 0 }`; pop + discard → `{ navigate: true, historySteps: -2 }` (the popped sentinel was re-pushed); save with `saved === false` → stay; stay → `{ navigate: false, historySteps: 0 }`.
- Behaviour: link clicks while dirty are always `preventDefault`ed, then `chooseAction`; on navigate, a bypass ref is set and `router.push(href)` (from `next/navigation`) runs. Popstate: call `sentinelPopAction` with `confirm: () => false` (it re-pushes), then ask; on navigate, clear the armed href and `history.go(-2)`. `beforeunload` stays native.

- [ ] **Step 1: Write the failing test**

```ts
expect(guardActions(false).map((a) => a.id)).toEqual(["stay", "discard"]);
expect(guardActions(true).map((a) => a.label)).toEqual(["Stay", "Discard changes", "Save and leave"]);
expect(afterChoice("discard", null, "pop")).toEqual({ navigate: true, historySteps: -2 });
expect(afterChoice("discard", null, "link")).toEqual({ navigate: true, historySteps: 0 });
expect(afterChoice("save", false, "link")).toEqual({ navigate: false, historySteps: 0 });
expect(afterChoice("save", true, "pop")).toEqual({ navigate: true, historySteps: -2 });
expect(afterChoice("stay", null, "pop")).toEqual({ navigate: false, historySteps: 0 });
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/unsavedGuardFlow.test.ts` → FAIL.
- [ ] **Step 3: Implement** the flow module and rewire the hook; `pnpm vitest run apps/operator/src/lib/stageDesigner.test.ts` must still pass unchanged.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS; `grep -n "window.confirm" apps/operator/src/lib/useUnsavedGuard.ts` → none.
- [ ] **Step 5: Screenshot** `after/redesign-1/guard-dialog` — dirty song editor, click "Shows" in the nav: the styled dialog shows Stay / Discard changes; Stay keeps the edit; Discard navigates. Repeat with browser Back (Playwright `page.goBack()`): dialog appears, Discard lands on the previous page.
- [ ] **Step 6: Commit** — `feat(operator): unsaved-changes guard uses the app dialog [SONGS-17, GD-24, STAGE-21]`

---

## Phase B — library list

### Task 8: List metadata, song createdAt and template roles

**Depends on:** nothing (no UI). Run day 1 in parallel with Task 1. **Unblocks:** Tasks 12–15; 2a template pickers (`templatesFor`), 2b hotcard create (WS8.5), 3 (deck `createdAt` follows the same stamping rule).

**Files:**
- Modify: `packages/core/src/song.ts` (`createdAt` only), `packages/core/src/template.ts` (`role`, `TemplateMeta`), `packages/core/src/stageLayout.ts` (meta `updatedAt`), `packages/ws-protocol/src/index.ts` (`show_list`, `template_list` items)
- Modify: `server/src/shows.ts` (`listShowMetas`), `server/src/templates.ts` (`listTemplateMetas`), `server/src/songs.ts` (`saveSong`), `server/src/songLibraryRoute.ts`, `server/src/songLibraryRoute.test.ts`, `server/src/registries.test.ts`
- Modify: `apps/operator/src/lib/store.ts` (`ShowMeta` type only)
- Create: `apps/operator/src/lib/templateRoles.ts`, `templateRoles.test.ts`

**Interfaces:**
- Produces: `Song.createdAt?: string` (ISO). `SongMeta = Pick<Song, "id" | "title" | "ccliNumber" | "author"> & Partial<Pick<Song, "updatedAt" | "createdAt">>`.
- Produces: server `saveSong(song)` sets `createdAt` = existing record's `createdAt` → incoming `song.createdAt` → `now` **only when the id is not already in the registry (live or tombstoned)**; an existing song without `createdAt` is never stamped (so an old song edited today doesn't become "added today"; the list falls back to `updatedAt`).
- Produces: `buildSongLibrary` rows gain `createdAt?: string` and `lastUsed?: string` (`YYYY-MM-DD`: latest `resolveShowDate` among live shows using the song with a date ≤ today; absent otherwise). `LibraryRow` in `librarySearch.ts` gains the same two fields (Task 13 edits that file).
- Produces: `TemplateSchema.role?: "graphic" | "lyric" | "scripture" | "title"`; `TemplateMeta = Pick<Template, "id" | "name" | "size" | "defaultChannel" | "role" | "updatedAt">`; `listTemplateMetas` passes `role` and `updatedAt` through; `template_list` items accept `role?` and `updatedAt?`.
- Produces: `StageLayoutMetaSchema.updatedAt: z.string().optional()`, filled by `stageLayoutMeta(l)`.
- Produces: `show_list` items gain `updatedAt?: string`, `totalLengthSec?: number` (sum of row `lengthSec`, omitted when no row has one); `listShowMetas` returns them; operator `ShowMeta` gains `scheduledFor?`, `updatedAt?`, `totalLengthSec?`.
- Produces (`templateRoles.ts`): `type TemplateUse = "graphic" | "lyric" | "scripture" | "title"`; `templateRole(meta: Pick<TemplateMeta, "name" | "role">): TemplateUse | "other"` — explicit `role` wins; else `/^old\b/i` → other, `/lyric/i` → lyric, `/scripture|verse/i` → scripture, `/intro|title|outro/i` → title, else graphic; `templatesFor<T extends Pick<TemplateMeta, "id" | "name" | "role">>(metas: T[], use: TemplateUse, recentIds?: string[]): { suggested: T[]; others: T[] }` — `suggested` lists `recentIds` in that order first, then the rest by name; `others` by name; nothing is dropped (contracts §7; generic and `recentIds` merged in from P2a.6). The single owner of template-role inference: plan 2a's pickers, plan 2b's hotcard picker and plan 3's deck pickers import these.

- [ ] **Step 1: Write the failing tests**

```ts
// templateRoles.test.ts — demo names from the findings
const m = (name: string, role?: TemplateMeta["role"]) => ({ id: name, name, size: { w: 1920, h: 1080 }, role });
expect(templateRole(m("Lyric — Default"))).toBe("lyric");
expect(templateRole(m("Scripture"))).toBe("scripture");
expect(templateRole(m("Song Intro"))).toBe("title");
expect(templateRole(m("OLD Lower Third"))).toBe("other");
expect(templateRole(m("Lower Third"))).toBe("graphic");
expect(templateRole(m("Lyric — Default", "graphic"))).toBe("graphic");
const all = ["Lyric — Default", "Scripture", "Lower Third", "OLD Lower Third"].map((n) => m(n));
const r = templatesFor(all, "lyric");
expect(r.suggested.map((t) => t.name)).toEqual(["Lyric — Default"]);
expect(r.suggested.length + r.others.length).toBe(4);
expect(templatesFor(all.concat(m("Lyric — Alt")), "lyric", ["Lyric — Alt"]).suggested.map((t) => t.name)).toEqual(["Lyric — Alt", "Lyric — Default"]);
// songLibraryRoute.test.ts (added)
it("passes createdAt through and reports lastUsed as the latest past show date", ...);
// registries.test.ts (added)
it("saveSong stamps createdAt for a new id only", ...);        // new → set; existing without createdAt → still absent; existing with → unchanged
it("listShowMetas includes updatedAt and totalLengthSec", ...); // rows 120 + 30 → 150; no lengths → undefined
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/templateRoles.test.ts server/src/songLibraryRoute.test.ts server/src/registries.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schema, protocol, server and type changes as specified (all optional fields; no existing field changes).
- [ ] **Step 4: Run** → PASS; `pnpm vitest run packages/core packages/ws-protocol` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(core): list metadata for sorting, song createdAt, template roles [SHOWS-4, SHOWS-21, SONGS-8, LM-6, LM-11; Default D12]`

---

### Task 9: LibraryList

**Depends on:** Tasks 1–5 (Menu, Tooltip, SegmentedControl, Input, Button, KindBar). **Unblocks:** Tasks 12–16; plan 3 decks page; whichever plan converts `/projects`.

**Files:**
- Create: `packages/ui/src/LibraryList.tsx`, `libraryListModel.ts`, `libraryListModel.test.ts`; Modify `index.ts`

**Interfaces:**
- Consumes: `MenuItem`, `useContextMenu` (Task 4); `KindBar`, `ItemKind` (Tasks 1–2); `SegmentedControl` (Task 3).
- Produces: `LibraryList<T>(props: LibraryListProps<T>)` and the types `SortSpec<T>`, `FilterSpec<T>`, `Column<T>`, `LibraryListProps<T>` exactly as contract §3, including `headerActions?: ReactNode`.
- Produces (`libraryListModel.ts`, pure):
  - `normalizeSearch(s: string): string` (NFKD, strip diacritics, lowercase, non-alphanumerics → space, trim).
  - `computeVisible<T>(i: { items: T[]; query: string; searchText(t: T): string; sorts: SortSpec<T>[]; sortId: string; filters?: FilterSpec<T>[]; filterValues: Record<string, string> }): T[]` — every query term must appear in the normalised haystack; filter value `""` or `"all"` means no filter; stable sort.
  - `type ListPrefs = { sort: string; filters: Record<string, string>; view: "list" | "grid" }`; `loadListPrefs(storage: Pick<Storage, "getItem"> | null, key: string, d: { sortIds: string[]; defaultSort: string; filters?: FilterSpec<unknown>[]; gridAvailable: boolean }): ListPrefs` (storage key `overlaysys.list.<key>`; unknown sort id → default; unknown filter id or option → dropped; `grid` without grid → `list`; bad JSON / throwing storage → defaults); `saveListPrefs(storage, key, prefs): void` (swallows errors).
  - `moveSelection(ids: string[], current: string | null, delta: 1 | -1): string | null` (clamps; null current → first/last).
  - `shouldFocusSearch(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; targetTag: string; targetEditable: boolean }): boolean` — single printable character, no modifier, target not an input/textarea/select/editable.
  - `listBodyState(i: { loading?: boolean; error?: string | null; total: number; visible: number }): "loading" | "error" | "empty" | "no-match" | "list"` — precedence error > loading > empty > no-match > list.
- Layout decisions: header row (gap 8, height 36): search `Input` with lucide `Search` (flex 1, max 360, placeholder "Search"), one `Select` per filter (label as first option "All <label>"), sort button "Sort: <label>" opening a Menu of sorts (checked item with lucide `Check`), list/grid `SegmentedControl` with lucide `List`/`LayoutGrid` (only when `views.grid`), spacer, `headerActions`, primary `Button` (lucide `Plus` + label; disabled with Tooltip `disabledReason`). List: CSS grid rows, 44 px tall (2 lines: 13 px primary, 11 px `textMuted` secondary, both ellipsised with `title` set to their text when they are strings), columns `[3px KindBar?] minmax(220px, 1fr) <column widths…> 32px`; a 24 px column-label header row (11 px `textMuted`). Row: hover `surface2`, selected `surface3` with a 2 px `brand` inset left edge; "⋯" is a visible `IconButton` (lucide `MoreHorizontal`, `aria-label="More actions for <primary text>"`). Grid: `repeat(auto-fill, minmax(<minCardWidth ?? 220>px, 1fr))`, gap 12, the page's `renderCard` inside a focusable card with the same selection/menu behaviour and the name under it. Container `role="listbox"`, rows `role="option"` with `aria-selected`. Keyboard: ↑/↓ (and ←/→ in grid) move selection, Enter opens, ContextMenu/Shift+F10 open the menu, typing a printable key focuses search with that character. Empty: title (13 px semibold), body (12 px `textDim`), action Button. No-match: "No results for “<query>”" + ghost "Clear search". Error: `error` text with lucide `WifiOff` and no primary action enabled. Loading: three 44 px skeleton rows.

- [ ] **Step 1: Write the failing tests**

```ts
const items = [{ id: "1", name: "Élan", n: 2 }, { id: "2", name: "apple pie", n: 1 }, { id: "3", name: "Banana", n: 3 }];
const sorts = [{ id: "name-asc", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
               { id: "n-desc", label: "Count", compare: (a, b) => b.n - a.n }];
const base = { items, query: "", searchText: (t: (typeof items)[number]) => t.name, sorts, sortId: "name-asc", filterValues: {} };
const d = { sortIds: ["name-asc"], defaultSort: "name-asc", gridAvailable: false };
it("matches every term, accent- and case-insensitive", () =>
  expect(computeVisible({ ...base, query: "ELAN" }).map((t) => t.id)).toEqual(["1"]));
it("sorts by the chosen spec", () => expect(computeVisible({ ...base, sortId: "n-desc" }).map((t) => t.id)).toEqual(["3", "1", "2"]));
it("treats filter value 'all' as no filter", ...);
it("loadListPrefs: unknown sort id and bad JSON fall back to defaults", () => {
  const s = { getItem: () => '{"sort":"gone","view":"grid","filters":{"x":"y"}}' };
  expect(loadListPrefs(s, "songs", d))
    .toEqual({ sort: "name-asc", filters: {}, view: "list" });
  expect(loadListPrefs({ getItem: () => "{nope" }, "songs", d).sort).toBe("name-asc");
  expect(loadListPrefs({ getItem: () => { throw new Error("denied"); } }, "songs", d).view).toBe("list");
});
it("moveSelection clamps", () => { expect(moveSelection(["a","b"], "b", 1)).toBe("b"); expect(moveSelection(["a","b"], null, -1)).toBe("b"); });
it("shouldFocusSearch ignores modifiers and inputs", () => {
  expect(shouldFocusSearch({ key: "a", ctrlKey: false, metaKey: false, altKey: false, targetTag: "DIV", targetEditable: false })).toBe(true);
  expect(shouldFocusSearch({ key: "a", ctrlKey: false, metaKey: true, altKey: false, targetTag: "DIV", targetEditable: false })).toBe(false);
  expect(shouldFocusSearch({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: false, targetTag: "DIV", targetEditable: false })).toBe(false);
  expect(shouldFocusSearch({ key: "a", ctrlKey: false, metaKey: false, altKey: false, targetTag: "INPUT", targetEditable: false })).toBe(false);
});
it("listBodyState: error wins over empty", () => expect(listBodyState({ error: "Not connected", total: 0, visible: 0 })).toBe("error"));
it("listBodyState: no-match when items exist but none visible", () => expect(listBodyState({ total: 3, visible: 0 })).toBe("no-match"));
```

- [ ] **Step 2: Run** `pnpm vitest run packages/ui/src/libraryListModel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model, then `LibraryList.tsx` on it (prefs load in an effect after mount to stay SSR-safe; save on change).
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(ui): shared LibraryList with search, sort, filter, menu and grid [SS-2, LM-4, D10 superseded]`

---

### Task 10: TemplateThumbnail

**Depends on:** Task 1 (tokens). Parallel with Tasks 2–9. **Unblocks:** Task 14 grid; 2a Live thumbnail strip, show-editor preview and song editor slides; 2b hotcard preview (WS8.5); 3 deck editor and slides strip.

**Files:**
- Create: `apps/operator/src/lib/thumbnails/TemplateThumbnail.tsx`, `sampleData.ts`, `sampleData.test.ts`, `thumbKey.ts`, `thumbKey.test.ts`, `useTemplateBody.ts`

**Interfaces:**
- Produces (contract §5): `TemplateThumbnail({ templateId: string; data: Record<string, string>; width: number })` — plus optional `label?: string` (accessible name; default "<template name> preview"). Box is `width × round(width * h / w)`; background `#000`; inner stage at template size scaled by `width / size.w` (`transform-origin: 0 0`, `pointer-events: none`, `aria-hidden`); outer `role="img"`. Mounts with `mountTemplate(el, tpl, data, { mode: "live" })` then `scrub("out", 0)` (the design pose = the IN's final frame); mounts lazily when it first intersects (`IntersectionObserver`, `rootMargin: "200px"`) and stays mounted; same template + new data → `m.update(data)` then `scrub("out", 0)`; template `updatedAt` change → destroy and remount; `destroy()` on unmount. Loading: `surface3` box; missing template: `surface2` box with "Missing template" (11 px `textMuted`). Wrapped in `React.memo` comparing `thumbKey(...)` and `width`.
- Produces: `useTemplateBody(templateId: string): { template: Template | null; status: "loading" | "ready" | "missing" }` — reads `templateCache`; if absent sends `get_template` once per id (module-level in-flight set) or `getTemplateCloud` in cloud mode; "missing" when the id is not in `templates` metas after the list has loaded.
- Produces: `sampleData(template: Pick<Template, "fields">): Record<string, string>` — field `default` when non-empty, else by type: text → the field's `label`, time → `"10:00"`, number → `"0"`, color → `"#ffffff"`, image/video → `""`.
- Produces: `thumbKey(templateId: string, data: Record<string, string>, updatedAt?: string): string` — FNV-1a 32-bit hex over `templateId`, `updatedAt ?? ""` and the data entries sorted by key.

- [ ] **Step 1: Write the failing tests**

```ts
expect(sampleData({ fields: [
  { key: "title", label: "Title", type: "text" },
  { key: "sub", label: "Subtitle", type: "text", default: "Placeholder subtitle" },
  { key: "clock", label: "Clock", type: "time" }, { key: "bg", label: "Background", type: "image" },
] })).toEqual({ title: "Title", sub: "Placeholder subtitle", clock: "10:00", bg: "" });
expect(thumbKey("t", { a: "1", b: "2" })).toBe(thumbKey("t", { b: "2", a: "1" }));
expect(thumbKey("t", { a: "1" })).not.toBe(thumbKey("t", { a: "2" }));
expect(thumbKey("t", { a: "1" }, "2026-10-01")).not.toBe(thumbKey("t", { a: "1" }, "2026-10-02"));
expect(thumbKey("t", {})).toMatch(/^[0-9a-f]{8}$/);
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/thumbnails` → FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(operator): TemplateThumbnail renders a template's final frame at small scale`

---

### Task 11: List formatting and export file names

**Depends on:** nothing. Parallel with everything in Phase A. **Unblocks:** Tasks 12–15.

**Files:**
- Create: `apps/operator/src/lib/listFormat.ts`, `listFormat.test.ts`, `apps/operator/src/lib/exportName.ts`, `exportName.test.ts`

**Interfaces:**
- Produces: `formatServiceDate(ymd: string, now: Date): string` → `"Sun 1 Nov"` (current year) or `"Sun 1 Nov 2025"`; `formatDuration(sec: number): string` → `"42:30"`, `"1:02:05"`; `formatRelative(iso: string | undefined, now: Date): string` → `"just now"` (< 1 min), `"5 min ago"`, `"3 h ago"`, `"yesterday"`, `"4 days ago"` (< 7), else `formatServiceDate` of that day; `""` for undefined/invalid; `plural(n: number, one: string, many?: string): string` → `"1 item"`, `"9 items"`.
- Produces: `exportFileName(kind: "show" | "song" | "template" | "hotcard", item: { name?: string; title?: string; ccliNumber?: string; id: string }): string` — show `"<name>.overlaysys-show.json"`, song `"<title> (CCLI <n>).json"` or `"<title>.json"`, template `"<slug>.overlaysys-template.json"`, hotcard `"<name>.overlaysys-hotcard.json"`; characters `/\:*?"<>|` removed; blank name falls back to the id.

- [ ] **Step 1: Write the failing tests**

```ts
const now = new Date(2026, 9, 28, 12, 0);
expect(formatServiceDate("2026-11-01", now)).toBe("Sun 1 Nov");
expect(formatServiceDate("2025-11-02", now)).toBe("Sun 2 Nov 2025");
expect(formatDuration(2550)).toBe("42:30");
expect(formatDuration(3725)).toBe("1:02:05");
expect(formatRelative("2026-10-26T12:00:00", now)).toBe("2 days ago");
expect(formatRelative(undefined, now)).toBe("");
expect(plural(9, "item")).toBe("9 items");
expect(exportFileName("song", { id: "s", title: "Placeholder Song", ccliNumber: "123" })).toBe("Placeholder Song (CCLI 123).json");
expect(exportFileName("template", { id: "t", name: "Lower Third / Alt" })).toBe("lower-third-alt.overlaysys-template.json");
expect(exportFileName("show", { id: "show-1", name: "  " })).toBe("show-1.overlaysys-show.json");
```

- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/listFormat.test.ts apps/operator/src/lib/exportName.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Use `en-GB` day/month order with `en-US` weekday abbreviations as shown (build the string from parts; don't rely on locale output).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(operator): list date, duration and export-name helpers [GD-28, T5]`

---

### Tasks 12–15: convert the library pages

Common to all four (each page task follows it; differences are listed per task):
- Remove `ManagementList` usage, `useDialog` `{dialog}` nodes and the per-row `<select>`/Duplicate/Export buttons. `PageChrome` keeps `title` only (no "in <Project>" context); the page renders `<PageBody variant="list" padding={0}>` with `<LibraryList>` filling it.
- `error` = `useConnection().connected ? null : "Not connected to the server. Retrying…"` (cloud mode is always connected); `loading` = true until the first list message (or cloud fetch) has arrived.
- `primaryAction.disabledReason` = "Reconnect to create" while disconnected.
- Create uses `prompt({ title: "New <noun>", confirmLabel: "Create", required: true, placeholder: "<Noun> name" })` and navigates to the editor.
- Menu items, in this order: Open · Duplicate · Rename… · Export · (per-type items) · separator · Copy id · separator · Delete… (danger). Disabled items carry a reason string ("Not connected to the server").
- Duplicate toasts `Duplicated as “<name> (copy)”` (tone ok). Rename uses `prompt` with `defaultValue`, fetches the body with `requestOne`, saves with `sendAndAwaitAck` (or the cloud save), toasts `Renamed to “<name>”`. Export uses `exportFileName`. Copy id writes to the clipboard and toasts "Id copied".
- Delete confirm copy: title `Delete <noun>?`, message `“<name>” will be deleted. This can't be undone.` (or the per-type note), confirmLabel "Delete", `danger: true`.
- Verification for each page: `pnpm typecheck`, `pnpm build`, and the shots named in the task at 1280×800, 1440×900, 1920×1080. Measure on every page at 1440: the list's right edge is within 1 px of the header row's right edge; no row action is taller than 28 px; the "⋯" button is visible without hover.

### Task 12: /shows

**Depends on:** Tasks 5, 6, 8, 9, 11. **Files:** Modify `apps/operator/src/app/shows/page.tsx`.

**Interfaces:** Consumes `ShowMeta` (`scheduledFor`, `updatedAt`, `totalLengthSec` from Task 8), `resolveShowDate` (core), `formatServiceDate`, `formatDuration`, `formatRelative`, `plural`.

- Sorts: `date-desc` "Service date" (default; `resolveShowDate` desc, undated last; ties by `updatedAt` desc, then name), `date-asc` "Service date (oldest)", `edited-desc` "Recently edited", `name-asc` "Name". `storageKey: "shows"`.
- Filter `when` "Date": All / Upcoming (date ≥ today) / Past (date < today) / No date.
- Columns: Date (110 px, `formatServiceDate` or "—"), Items (64 px right, `rowCount`), Length (72 px right, `formatDuration(totalLengthSec)` or "—"), Edited (120 px, `formatRelative`). `secondary`: `plural(rowCount, "item")` (no id). `kind`: none.
- Extra menu items: "Move to <project name>" for every other project (hidden when there is one project); after moving, toast `Moved to <project>` with action "Undo" (moves back).
- Duplicate: `duplicate_show` (server keeps the date and sections, Task 17). Empty state: title "No shows yet", body "A show is the rundown for one service. Create one here, or import a plan from Planning Center.", action "New show".
- [ ] Implement; [ ] typecheck/build; [ ] shots `after/redesign-1/shows-list-{1280,1440,1920}`: newest service first, no ids, Date/Items/Length/Edited columns aligned; `after/redesign-1/shows-menu` (right-click a row); [ ] commit `feat(shows): shows library on LibraryList, newest service first [SHOWS-17, SHOWS-18, SHOWS-22, SHOWS-23, SS-17]`.

### Task 13: /songs

**Depends on:** Tasks 5, 6, 8, 9, 11. **Files:** Modify `apps/operator/src/app/songs/page.tsx`, `apps/operator/src/app/songs/librarySearch.ts`, `librarySearch.test.ts`.

**Interfaces:**
- Produces (`librarySearch.ts`): `LibraryRow` gains `createdAt?`, `lastUsed?`; `songSearchText(row: LibraryRow): string` (title, author, CCLI, lyrics); `addedAt(row: LibraryRow): string` (`createdAt ?? updatedAt ?? ""`); `songSorts: SortSpec<LibraryRow>[]` = `added-desc` "Date added" (default; `addedAt` desc, empty last, then title), `title-asc` "Title", `edited-desc` "Recently edited", `used-desc` "Last used". `songMatches`, `sortLibrary` and `LibrarySort` are removed (only `/songs` used them); `mergeLibrary` stays and also merges `createdAt`.
- Test (in `librarySearch.test.ts`): `songSorts` `added-desc` puts a song with `createdAt` 2026-10-20 before one with only `updatedAt` 2026-10-10, and a song with neither last; `songSearchText` includes lyrics when loaded.
- Columns: Author (180 px), CCLI (96 px), Added (110 px, `formatRelative(addedAt)`), Last used (110 px, `formatServiceDate(lastUsed)` or "—"). `secondary`: "Used in N shows" when `usedIn` > 0. `kind`: `"song"`. `storageKey: "songs"`.
- `headerActions`: "Import from file…", "CCLI report…" (local only), "Recently deleted (n)" (local only, when n > 0) — `secondary` size `sm`.
- Duplicate (new): `requestOne(get_song)` → copy with id `song-<uuid8>`, title "<title> (copy)", no `createdAt` → `sendAndAwaitAck(save_song)`; then open the copy.
- After create, open `/songs/edit?id=<id>&paste=1` (2a's song editor reads `paste=1` to open and focus the paste panel; until then the param is ignored).
- Delete (local): no confirm when the library supports restore; toast `Deleted “<title>”` with action "Undo" (`restoreDeletedSong`). When `usedIn` > 0, confirm first: message `“<title>” is used in N shows (<names>). Those rundown items will show the song as missing.`. Cloud mode: always confirm, "This can't be undone."
- Save path: replace the page's local `saveSongAcked` with `sendAndAwaitAck`.
- Export uses `exportFileName("song", song)` (contracts §7; P2a has no separate song export-name helper).
- Recently deleted (SONGS-30): the modal closes after the last restore, each restore toasts `Restored “<title>”` (tone ok), and the modal shows the retention note "Deleted songs are kept until you empty Recently deleted." (or the real retention rule if the server has one). Restyle it on `Dialog`.
- Plan 3 hook: P3.20 later adds one "Convert to slide deck…" item to this page's `menuItems` in a marked block (shared-file rule); leave `menuItems` as a single array literal so that edit is one line.
- Empty state: title "No songs yet", body "Add a song, import a SongSelect or ChordPro file, or bring songs in from Planning Center.", action "New song".
- [ ] Write the `librarySearch.test.ts` cases → FAIL → implement → PASS; [ ] typecheck/build; [ ] shots `after/redesign-1/songs-list-{1280,1440,1920}` (newest added first), `after/redesign-1/list-offline` (stop the server: "Not connected to the server. Retrying…", New song disabled with its reason, no "No songs yet"); [ ] commit `feat(songs): song library on LibraryList, newest added first [SONGS-7, SONGS-22, SONGS-23, SONGS-25, SONGS-26, SONGS-27, SONGS-30, SONGS-31]`.

### Task 14: /design — Graphics and Stage layouts

**Depends on:** Tasks 5, 6, 8, 9, 10, 11; **P2b.12** (template usage helper, contracts §8) and **P2b.17** (`/design/stage/edit?new=1`). **Files:** Modify `apps/operator/src/app/design/page.tsx`; Create `apps/operator/src/app/design/NewTemplateDialog.tsx`. No server file and no `server/src/index.ts` line: the usage route belongs to P2b.12.

**Interfaces:**
- Consumes (contracts §8, P2b.12): `fetchTemplateUsage(id): Promise<TemplateUsage | null>` and `templateDeleteConfirm(name, usage)` from `apps/operator/src/app/design/edit/templateUsage.ts`. (The `ShowSong` override counting this task used to specify is part of P2b.12's `templateUsage`.)
- Tabs: `SegmentedControl` "Graphics" / "Stage layouts" (local only; URL `?tab=stage` kept); page title "Designs" (contracts §13).
- Graphics: sorts `edited-desc` "Recently edited" (default; `updatedAt` desc, missing last, then name), `name-asc` "Name"; filter `role` "Type": Graphic / Lyric / Scripture / Title / Other (via `templateRole`); columns Type (96 px), Size (100 px, "1920×1080"), Edited (120 px); `secondary` "1920×1080 · edited 2 days ago"; `kind`: `"graphic"`; `views.grid` with `renderCard = t => <TemplateThumbnail templateId={t.id} data={sampleData(body)} width={…} />` (`minCardWidth: 220`; thumbnail width = card width, data from `sampleData` of the cached body, `{}` until loaded); `storageKey: "design-graphics"`.
- "New template" opens `NewTemplateDialog({ open; onCancel(); onCreate(name: string, starterId: string) })`: starter cards from `TEMPLATE_STARTERS` (label + description, selected card has a `brand` border) and a required name `Input`; Create disabled until a name is typed. The header starter `<select>` is removed.
- Delete: `fetchTemplateUsage` first, then `confirm(templateDeleteConfirm(name, usage))`; a `blocked` result (built-in lyric template) shows only "OK" and deletes nothing. `null` usage (cloud/offline) falls back to the common copy.
- Stage layouts: `primaryAction` "New stage layout" → `router.push("/design/stage/edit?new=1")` (P2b.17's "Start from" step); sorts `name-asc` (default; built-ins first), `edited-desc`; columns Size (100 px), Used by (220 px, `channelsUsingLayout` names or "—"), plus a "Built-in" `Pill` in `secondary`; Rename/Delete hidden for built-ins (Delete shown disabled with reason "Built-in layouts can't be deleted"); Duplicate opens the copy (listen once for the next `stage_layout_list` and open the new id that wasn't there before); list view only; `storageKey: "design-stage"`.
- Empty (graphics): title "No templates yet", body "Start from a starter: lower third, title card, lyric or scripture.", action "New template".
- [ ] Implement; [ ] typecheck/build; [ ] shots `after/redesign-1/design-grid-1440` (thumbnails show the filled templates, no ids), `after/redesign-1/design-list-1440`, `after/redesign-1/design-stage-1440` ("Used by" column, Built-in pill), `after/redesign-1/design-delete-used` (usage listed); [ ] commit `feat(design): templates library with grid thumbnails and usage-aware delete [GD-15, GD-16, GD-17, GD-18, GD-28, GD-29, GD-30, STAGE-24, STAGE-25, STAGE-26, STAGE-27; GD-4 list side]`.

### Task 15: /hotcards

**Depends on:** Tasks 5, 6, 9, 11; **P2b.25** (`/hotcards/edit?new=1`). **Files:** Modify `apps/operator/src/app/hotcards/page.tsx`.

- `primaryAction` "New hotcard" → `router.push("/hotcards/edit?new=1")` (no prompt here; P2b.25's create step asks for name, template and F-key).

- Sorts: `key-asc` "F-key" (default; F1…F12 numeric, unassigned last, then name), `name-asc` "Name". Columns: F-key (64 px, `Kbd` or "—"; conflict shows a `warn` lucide `AlertTriangle` with Tooltip `F<n> is assigned to N cards in this project; only one fires`), Output (140 px, channel name from `channelHint` or "Program"), Template (200 px, template name or "Missing template"). `secondary`: none. `kind`: `"graphic"`. `storageKey: "hotcards"`.
- Extra menu items: "Move to <project>" (as Task 12, with Undo toast).
- Empty: title "No hotcards in this project", body "Hotcards are reusable graphics you can take from the Live page with Cue / Take or F1–F12.", action "New hotcard".
- [ ] Implement; [ ] typecheck/build; [ ] shots `after/redesign-1/hotcards-list-1440` (F-key column first, no ids), `after/redesign-1/hotcards-conflict` (two cards on F2 show the warning); [ ] commit `feat(hotcards): hotcards library on LibraryList [LM-4, LM-26, LM-30, SS-17]`.

---

### Task 16: Retire EntityList and ManagementList

**Depends on:** Tasks 12–15 and **P2b.29** (`/projects` converted to `LibraryList`). **Unblocks:** removes the old row styles everywhere.

**Files:**
- Delete: `packages/ui/src/EntityList.tsx` (and its export line), `apps/operator/src/app/components/ManagementList.tsx`

**Interfaces:**
- No adapter: after P2b.29 nothing imports `ManagementList`, so both components are deleted outright (contracts §3).
- [ ] `grep -rn "EntityList\|EntityRow\|ManagementList" apps packages --include=*.ts --include=*.tsx` → no matches outside `dist/`; [ ] typecheck/build; [ ] `pnpm test` → PASS; [ ] commit `refactor(ui): remove EntityList and ManagementList [SS-2, SHOWS-18, SONGS-22, LM-4, SS-16, STAGE-27, LM-30]`.

---

## Phase C — native sections

Tasks 17–20 touch only core and server and may start on day 1 in parallel with Phase A (they are numbered last only to keep the stage order of the spec). Task 17 touches `server/src/shows.ts` `duplicateShow`, Task 8 touches `listShowMetas`, Task 20 adds a function: different functions, rebase normally.

### Task 17: Show schema — sections, sectionId, pass-through

**Depends on:** nothing. **Unblocks:** Task 18; 2a (rundown, show editor), 3 (cloud sync can't strip `sections`/`sectionId`).

**Files:**
- Modify: `packages/core/src/show.ts`, `packages/core/src/show.test.ts`, `server/src/shows.ts` (`duplicateShow`), `server/src/registries.test.ts`

**Interfaces:**
- Produces: `ShowSectionSchema = z.object({ id: z.string().min(1), name: z.string() }).passthrough()`, `type ShowSection = { id: string; name: string }`; `Show.sections?: ShowSection[]`; `sectionId?: string` on `GraphicRow`, `SongRow`, `ScriptureRow`, `VideoRow` (and plan 3's `SlidesRow`, added by P3.8 in this file after this task, following the same strict-type / passthrough-schema pattern).
- Produces: `RowSourceRef.pcoArrangement?: z.array(z.string()).optional()` — the arrangement a PCO import last set on a song row, so re-import can tell an operator edit from its own (contracts §4; used by P2b.27).
- Decision: each schema is defined as a strict `z.object` (`GraphicRowObject`, …, `ShowObject`) whose **type** is exported (`type GraphicRow = z.infer<typeof GraphicRowObject>`), while the exported **schema** is `GraphicRowObject.passthrough()`. This keeps TypeScript types free of `[k: string]: unknown` index signatures while parsing keeps unknown keys. Apply to `GraphicRowSchema`, `SongRowSchema`, `ScriptureRowSchema`, `VideoRowSchema`, `ShowSongSchema`, `ShowSectionSchema` and the object inside `ShowSchema`'s `preprocess`.
- Produces: `duplicateShow` copies every field of the source (spread) except `id`, `name` ("<name> (copy)"), `deletedAt`, and row ids (fresh UUIDs); `sections`, `sectionId`s and `scheduledFor` are kept.

- [ ] **Step 1: Write the failing tests**

```ts
it("parses an old show without sections unchanged", () => {
  const s = ShowSchema.parse(oldFixtureShow); expect(s.sections).toBeUndefined(); expect(s.rows[0]!.sectionId).toBeUndefined();
});
it("round-trips sections and sectionId", () => {
  const s = ShowSchema.parse({ ...base, sections: [{ id: "sec-a", name: "Worship" }], rows: [{ ...graphicRow, sectionId: "sec-a" }] });
  expect(s.sections).toEqual([{ id: "sec-a", name: "Worship" }]); expect(s.rows[0]!.sectionId).toBe("sec-a");
});
it("keeps unknown keys on the show, rows, show songs and sections", () => {
  const s = ShowSchema.parse({ ...base, futureShowKey: 1, songs: [{ songId: "x", futureSongKey: true }],
    sections: [{ id: "a", name: "A", colour: "#fff" }], rows: [{ ...graphicRow, futureRowKey: "x" }] }) as Record<string, unknown>;
  expect(s.futureShowKey).toBe(1);
  expect((s.rows as Record<string, unknown>[])[0]!.futureRowKey).toBe("x");
  expect((s.songs as Record<string, unknown>[])[0]!.futureSongKey).toBe(true);
  expect((s.sections as Record<string, unknown>[])[0]!.colour).toBe("#fff");
});
it("still defaults a row without kind to graphic", ...);
it("round-trips sourceRef.pcoArrangement", ...);
// registries.test.ts
it("duplicateShow keeps sections, sectionIds and scheduledFor with fresh row ids", ...);
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/show.test.ts server/src/registries.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm test` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(core)!: native show sections; show and row schemas keep unknown keys`

---

### Task 18: Section helpers

**Depends on:** Task 17. **Unblocks:** Tasks 19–20; 2a show editor and Live rundown.

**Files:**
- Create: `packages/core/src/sections.ts`, `packages/core/src/sections.test.ts`; Modify `packages/core/src/index.ts`

**Interfaces (contracts §4):**
- Invariant: every helper that returns a `Show` returns `rows` in display order (the concatenation of `groupRowsBySection` groups), never mutates its input, and returns the same object when nothing changes.
- `groupRowsBySection(show: Show): { section: ShowSection | null; rows: RundownRow[] }[]` — first the `null` group (rows with no `sectionId` or an id not in `sections`), included when it has rows or when the show has no sections; then every section in `sections` order (empty ones included), members in `rows` order. Duplicate section ids: the first wins.
- `orderRowsBySection(show: Show): Show`.
- `moveRow(show: Show, rowId: string, toSectionId: string | null, toIndex: number): Show` — `toIndex` is the index within the target group after removal, clamped; `null` clears `sectionId` (key deleted); unknown row or unknown section → same show.
- `insertRow(show: Show, row: RundownRow, toSectionId: string | null, toIndex: number): Show`.
- `addSection(show: Show, name: string, afterSectionId?: string | null, id?: string): { show: Show; section: ShowSection }` — `undefined` = append, `null` = first, unknown id = append; trimmed name, empty → `"Section <n>"` (n = sections count + 1); default id `sec-<8 hex>` from `crypto.randomUUID()`.
- `renameSection(show: Show, id: string, name: string): Show` — trimmed empty or unknown id → same show.
- `deleteSection(show: Show, id: string, mode: "keep-rows" | "delete-rows"): Show` — keep-rows: members join the previous section in `sections` order, or "no section" when it was the first; delete-rows: members removed. When the last section is deleted the `sections` key is removed.
- `moveSection(show: Show, id: string, toIndex: number): Show`.
- `sectionLength(rows: RundownRow[]): number | null` — sum of `lengthSec`; null when no row has one.

- [ ] **Step 1: Write the failing tests** (fixture: rows r1..r5; sections A, B; r1 none, r2/r3 in A, r4 in B, r5 in A; freeze the input deeply with a `deepFreeze` helper in every test)

```ts
it("groups: no-section first, then sections in order, members in rows order", () =>
  expect(ids(groupRowsBySection(show))).toEqual([[null, ["r1"]], ["A", ["r2", "r3", "r5"]], ["B", ["r4"]]]));
it("rows with an unknown sectionId fall into the no-section group", ...);
it("a show without sections is one flat group, even when empty", () =>
  expect(groupRowsBySection({ ...show, sections: undefined, rows: [] })).toEqual([{ section: null, rows: [] }]));
it("empty sections are kept as groups", ...);
it("orderRowsBySection puts r5 before r4", () => expect(orderRowsBySection(show).rows.map((r) => r.id)).toEqual(["r1","r2","r3","r5","r4"]));
it("moveRow into B at 0 sets sectionId and display order", () => {
  const s = moveRow(show, "r2", "B", 0);
  expect(s.rows.find((r) => r.id === "r2")!.sectionId).toBe("B");
  expect(s.rows.map((r) => r.id)).toEqual(["r1","r3","r5","r2","r4"]);
});
it("moveRow to null removes the sectionId key", () => expect("sectionId" in moveRow(show, "r4", null, 9).rows.at(1)!).toBe(false));
it("moveRow with an unknown section returns the same show", () => expect(moveRow(show, "r2", "nope", 0)).toBe(show));
it("addSection(null) inserts first; empty name becomes 'Section 3'", ...);
it("deleteSection keep-rows moves B's rows into A; A's into no-section", ...);
it("deleteSection delete-rows removes the members", ...);
it("deleting the last section removes the sections key", ...);
it("renameSection ignores a blank name", () => expect(renameSection(show, "A", "  ")).toBe(show));
it("moveSection reorders sections and rows", ...);
it("sectionLength sums lengthSec and is null without lengths", () => {
  expect(sectionLength([{ ...g, lengthSec: 120 }, { ...g, lengthSec: 30 }, g])).toBe(150);
  expect(sectionLength([g])).toBeNull();
});
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/sections.test.ts` → FAIL.
- [ ] **Step 3: Implement** (all helpers build on `groupRowsBySection` → edit groups → flatten).
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(core): section helpers keep rows in display order`

---

### Task 19: Planning Center headers import as sections

**Depends on:** Tasks 17, 18. **Unblocks:** 2b `/pco` page (headers shown as section dividers, never as importable rows). `importPlan.ts` merge order (execution-order doc): **P1.19 → P2b.27 (EXTRA-2) → P3.11 (Import as Slides)**. This task touches only the header→section code; the file's owner is plan 2b.

**Files:**
- Create: `packages/core/src/pco/headerSections.ts`, `packages/core/src/pco/headerSections.test.ts`; Modify `packages/core/src/pco/index.ts`
- Modify: `server/src/pco/importPlan.ts`, `server/src/pco/importPlan.test.ts`

**Interfaces:**
- Produces (core): `pcoSectionId(itemId: string): string` → `"pco-" + itemId`; `isPcoSectionId(id: string): boolean`; `planHeaderSections(items: Pick<PcoPlanItem, "id" | "itemType" | "title" | "sequence">[]): { sections: ShowSection[]; sectionByItem: Map<string, string> }` — items sorted by `sequence` (index as fallback); a header opens a section named `title.trim() || "Section"`; each later non-header item maps to the open section; items before the first header are unmapped.
- Produces (core): `mergePlanSections(existing: ShowSection[] | undefined, plan: ShowSection[], keep: (id: string) => boolean): ShowSection[] | undefined` — existing sections keep their order (PCO ones get the plan's current name); plan sections not yet present and for which `keep(id)` is true are inserted after the nearest preceding plan section already in the list, else before the nearest following one, else appended; returns `undefined` when the result is empty.
- `importPlan` changes (headers only; nothing else in this file changes):
  - A plan item with `itemType === "header"` never becomes a row, whatever its config says, and isn't counted in `counts.rows`.
  - Existing rows whose `sourceRef.itemId` is a header item of this plan are removed (they were imported as graphic rows before); `counts.headerRowsConverted` counts them.
  - Each imported row gets `sectionId = sectionByItem.get(item.id)`; on re-import, a row whose current `sectionId` is set and not a PCO section id keeps it (the operator moved it).
  - `show.sections = mergePlanSections(show.sections, sections, id => some row has that sectionId)`; then `show = orderRowsBySection(show)` before validation.
  - `ImportPlanResult.counts` gains `sections: number` (PCO sections in the saved show) and `headerRowsConverted: number`.
- [ ] **Step 1: Write the failing tests**

```ts
// headerSections.test.ts
const items = [
  { id: "1", itemType: "item", title: "Prelude", sequence: 1 },
  { id: "2", itemType: "header", title: " Worship ", sequence: 2 },
  { id: "3", itemType: "song", title: "Placeholder Song", sequence: 3 },
  { id: "4", itemType: "header", title: "", sequence: 4 },
  { id: "5", itemType: "item", title: "Offertory", sequence: 5 },
];
const r = planHeaderSections(items);
expect(r.sections).toEqual([{ id: "pco-2", name: "Worship" }, { id: "pco-4", name: "Section" }]);
expect([...r.sectionByItem]).toEqual([["3", "pco-2"], ["5", "pco-4"]]);
expect(mergePlanSections([{ id: "mine", name: "Mine" }, { id: "pco-4", name: "Old" }], r.sections, () => true))
  .toEqual([{ id: "mine", name: "Mine" }, { id: "pco-2", name: "Worship" }, { id: "pco-4", name: "Section" }]);
// importPlan.test.ts (added, using the existing fake client/fixtures)
it("imports headers as sections, never as rows", ...);                 // rows exclude item 2/4; sectionIds set; counts.sections 2
it("re-import removes header rows left by an older import", ...);       // existing graphic row with sourceRef.itemId "2" → gone; headerRowsConverted 1
it("keeps a row the operator moved into a manual section", ...);
it("does not create a section with no imported rows", ...);
it("keeps rows in display order after import", ...);
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/pco/headerSections.test.ts server/src/pco/importPlan.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm vitest run server/src/pco` → PASS (existing EXTRA-2 / link tests untouched); `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(pco): plan headers import as show sections, never as rows [LM-11 (header part)]`

---

### Task 20: One-time header migration with backups

**Depends on:** Tasks 17–19. **Unblocks:** existing PCO shows open sectioned in 2a's Live and editor.

**Files:**
- Modify: `packages/core/src/pco/headerSections.ts`, `headerSections.test.ts` (add `migrateHeaderRows`)
- Create: `server/src/pco/headerMigration.ts`, `server/src/pco/headerMigration.test.ts`
- Modify: `server/src/shows.ts` (add `applyHeaderMigration`), `server/src/index.ts` (one line after `await reloadShows()`)

**Interfaces:**
- Produces (core): `migrateHeaderRows(show: Show, headers: ReadonlyMap<string, string> /* PCO itemId → title */): { show: Show; changed: boolean }` — walks `rows` in order; a `graphic` row with `sourceRef.provider === "pco"` and `headers.has(itemId)` becomes section `{ id: pcoSectionId(itemId), name: headers.get(itemId)?.trim() || first non-empty data value || "Section" }` (appended to `sections` if absent) and is dropped; later rows without a `sectionId` take the open section's id until the next header row; rows before the first header are untouched; result passes through `orderRowsBySection`; no header rows → `{ show, changed: false }` with the same object.
- Produces (server, `headerMigration.ts`):
  - Cache file `data/pco/plan-headers.json`: `{ version: 1, plans: Record<"<serviceTypeId>/<planId>", { fetchedAt: string; headers: Record<string, string> } | { fetchedAt: string; unavailable: true }> }` (read tolerant: missing/corrupt → empty).
  - `pendingPlanKeys(shows: Show[], cache: PlanHeaderCache): string[]` — plans referenced by PCO-sourced graphic rows of live shows that aren't in the cache.
  - `startHeaderMigration(deps?: { getClient?: () => PcoClient | null; now?: () => string; pollMs?: number /* 60000 */ }): Promise<void>` — (1) applies the cached headers to all live shows via `shows.applyHeaderMigration`; (2) if plans are pending and a client is available (default: `createPcoClient(getPcoAuthorization())` when `isPcoConnected()`), fetches each pending plan's items once (`getPlanItems`), stores `headers` (or `unavailable: true` on a non-auth error), saves the cache, applies again; on `PcoAuthError` stops and retries later; (3) while plans stay pending and no client is available, re-checks every `pollMs` with an `unref()`ed timer (one timer per process).
- Produces (`shows.ts`): `applyHeaderMigration(headers: ReadonlyMap<string, string>): Promise<string[] /* changed show ids */>` — for each live show where `migrateHeaderRows` changes something: if `<dataRoot>/shows/<id>.json.pre-sections.bak` doesn't exist, copy the current file there first (never overwrite an existing backup); then `saveShow(migrated)` (stamps `updatedAt` so sync pushes the migrated show).
- `index.ts`: `void startHeaderMigration().catch((err) => app.log.warn({ err }, "[pco] header migration failed"));` right after `await reloadShows();`.

- [ ] **Step 1: Write the failing tests**

```ts
// headerSections.test.ts (added)
it("turns known header rows into sections and files later rows under them", ...); // rows: g(pco 10), g(pco 11 header "Worship"), song(pco 12), g(manual) → sections [pco-11 Worship]; rows song+manual have sectionId pco-11
it("leaves PCO graphic rows whose item is not a known header", () =>
  expect(migrateHeaderRows(show, new Map([["999", "X"]]))).toEqual({ show, changed: false }));
it("is idempotent", () => { const once = migrateHeaderRows(show, h).show; expect(migrateHeaderRows(once, h)).toEqual({ show: once, changed: false }); });
it("does not move a row that already has a sectionId", ...);
// headerMigration.test.ts (tmp OVERLAYSYS_DATA_DIR, fake PcoClient)
it("no client and no cache writes no show file", ...);              // mtimes unchanged, no .bak
it("fetches each pending plan once, caches headers, migrates and writes one backup", ...);
it("never overwrites an existing .pre-sections.bak", ...);
it("marks a plan unavailable on a 404 and does not refetch it", ...);
it("stops on PcoAuthError and leaves the plan pending", ...);
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/pco/headerSections.test.ts server/src/pco/headerMigration.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm test`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5: Manual check** — copy the desktop data's PCO show (`show-3b47c3e0.json`) into the uxreview data copy, start the server with PCO connected, confirm the `.pre-sections.bak` appears once and that only items PCO reports as headers became sections; restart: no second backup, no change.
- [ ] **Step 6: Commit** — `feat(server): one-time, backed-up migration of PCO header rows into sections`

---

### Task 21: Dev asset proxy and dev badge (WS0.3)

**Depends on:** nothing. Day 1. **Unblocks:** honest screenshots for every plan (fonts and posters load in dev).

**Files:**
- Modify: `apps/renderer/vite.config.ts`, `apps/operator/next.config.mjs`
- Create: `apps/operator/src/lib/devProxy.ts`, `devProxy.test.ts` (pure config builders, so the rule is testable)

**Interfaces:**
- Produces: `assetRewrites(env: { NEXT_BUILD_STATIC?: string; OVERLAYSYS_SERVER_URL?: string }): { source: string; destination: string }[]` — `[{ source: "/assets/:p*", destination: "<server>/assets/:p*" }]` with `<server>` defaulting to `http://localhost:4000`, and `[]` when `NEXT_BUILD_STATIC === "1"` (packaged/static builds never proxy). `next.config.mjs` calls it from `async rewrites()` and sets `devIndicators: { position: "top-right" }` (LIVE-32: the "N" badge no longer covers the media transport).
- `vite.config.ts`: `server.proxy = { "/assets": "http://localhost:4000" }` (dev server only; `build` is unaffected).

- [ ] **Step 1: Write the failing test** — `expect(assetRewrites({})).toEqual([{ source: "/assets/:p*", destination: "http://localhost:4000/assets/:p*" }]); expect(assetRewrites({ NEXT_BUILD_STATIC: "1" })).toEqual([]);`
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/devProxy.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helper and both config edits.
- [ ] **Step 4: Verify** — restart both dev servers; re-shoot `live/s11-song-intro__out-pgm` as `after/redesign-1/song-intro-font` (intro in its custom font); the console on Live, the show editor's video form and `/nonexistent` has no `OTS parsing error`, no `failed to load font` and no `/assets` 404; the Next dev badge sits top-right (`after/redesign-1/dev-badge`). `pnpm build` and `pnpm --filter operator build:cloud` → PASS. Note in the commit that the packaged renderer font check is a follow-up for `fonts.ts` if it fails there.
- [ ] **Step 5: Commit** — `fix(dev): proxy /assets to the server in dev; move the Next dev badge [LIVE-28, SS-30, SHOWS-11 (404), LIVE-32]`

### Task 22: Stage layout rules — schema and resolver (spec "Stage screens choose their layout dynamically")

**Depends on:** Task 17 (row schema pattern). **Unblocks:** P2b.18 (rules editor), P2b.33 (server resolution), P2a.22 (Live drawer, row "Stage screens"), P3.22 (slides rows). Contracts §16.

**Files:**
- Create: `packages/core/src/stageLayoutRules.ts`, `stageLayoutRules.test.ts`; Modify `packages/core/src/index.ts` (one export line)
- Modify: `packages/core/src/channelConfig.ts` (stage `layoutRules`), `packages/core/src/show.ts` (`stageLayouts` on every row object), `show.test.ts`, `channelConfig` tests

**Interfaces (contracts §16):**
- `type StageRuleKind = "song" | "scripture" | "slides" | "graphic" | "video"`.
- `ChannelConfig.layoutRules?: Partial<Record<StageRuleKind, string /* layoutId */>>` (stage channels). `layoutId` keeps its meaning and is now the screen's **default**. No migration code: an existing config parses with `layoutRules` absent, so nothing changes until rules are added.
- Every row object (`GraphicRow`, `SongRow`, `ScriptureRow`, `VideoRow`; P3.8's `SlidesRow` too) gains `stageLayouts?: Record<string /* stage channel id */, string /* layoutId */>`.
- `type StageLayoutReason = "manual" | "item" | "rule:song" | "rule:scripture" | "rule:slides" | "rule:graphic" | "rule:video" | "default"` (written as a template-literal type over `StageRuleKind`).
- `resolveStageLayout(i: { manual?: string | null; rowOverride?: string; rules?: ChannelConfig["layoutRules"]; default?: string; liveRowKind?: string | null }): { layoutId: string | undefined; reason: StageLayoutReason }` — precedence manual > item (`rowOverride`) > type rule (`rules[liveRowKind]`) > default; an unknown `liveRowKind` or no live row falls to default; empty strings count as unset.
- `type StageLayoutStatus = { channel: string; layoutId: string | undefined; reason: StageLayoutReason; manual: string | null }` (the broadcast shape P2b.33 sends).

- [ ] **Step 1: Write the failing tests**
```ts
expect(resolveStageLayout({ manual: "m", rowOverride: "i", rules: { song: "r" }, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "m", reason: "manual" });
expect(resolveStageLayout({ rowOverride: "i", rules: { song: "r" }, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "i", reason: "item" });
expect(resolveStageLayout({ rules: { song: "r" }, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "r", reason: "rule:song" });
expect(resolveStageLayout({ rules: { song: "r" }, default: "d", liveRowKind: "scripture" })).toEqual({ layoutId: "d", reason: "default" });
expect(resolveStageLayout({ rules: { song: "r" }, default: "d", liveRowKind: null })).toEqual({ layoutId: "d", reason: "default" });
expect(resolveStageLayout({ manual: "", default: "d" }).reason).toBe("default");
it("a stored stage config without layoutRules parses unchanged", ...);
it("rows round-trip stageLayouts; old rows parse without it", ...);
```
- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/stageLayoutRules.test.ts packages/core/src/show.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(core): stage layout rules, per-row stage layouts and the layout resolver`

---

## Parallel groups and what they unblock

The cross-plan wave table, dependencies and merge order are in `2026-10-28-redesign-execution-order.md`; this is plan 1's slice of it.

| Wave | Tasks (parallel within a wave) | Unblocks |
|---|---|---|
| 1 (day 1) | 1, 8, 11, 17, 21 | 2a/2b template pickers (8); 3 cloud sync passthrough and SlidesRow (17) |
| 2 | 2, 10, 18, 22 | 2a Live thumbnails / show editor preview, 3 deck editor (10); 2a sectioned rundown (18) |
| 3 | 3, 4, 5, 19 | **2a and 2b can start every screen** once 1–5 are in; 2b `/pco` and EXTRA-2 (19) |
| 4 | 6, 7, 9, 20 | 2a/2b editors' save model and guard (6, 7); plan 3 decks library and P2b.29 `/projects` (9) |
| 5 | 12, 13 | P3.20 menu mount (13) |
| later | 14 (after P2b.12, P2b.17), 15 (after P2b.25), 16 (after 12–15 and P2b.29) | — |

Per plan: **2a** needs 1–7, 8 (`templatesFor`), 10, 11 (`exportFileName`), 17, 18. **2b** needs 1–7, 8 (`role`, metas), 9 (`/projects`), 10 (hotcard preview), 17 (`pcoArrangement`), 19 (pco page, EXTRA-2). **3** needs 1–6, 8, 9, 10, 17 (and 19 before touching `importPlan.ts`).

---

## Contract changes

Resolved in contracts §1 (tuned tokens), §2 (kit additions, `precision`, `OfflineState`/`offlineCopy`, `FileDrop`), §3 (`headerActions`), §4 (`migrateHeaderRows(show, headers)`, display-order helpers, `addSection` → `{ show, section }`, `pcoArrangement`), §5 (thumbnail companions), §7 (`awaitAck`, `useConnection`, `templatesFor`, `exportFileName`, `PageBody` variants), §8 (template usage is P2b.12's; `?new=1` routes), §11 (list metadata), §16 (stage layout rules, Task 22), §13 ("Designs") and §15 (log). File ownership and the shared-file rule: execution-order doc.

---

## Appendix: Fix-plan coverage

WS0 tasks (this plan's workstream) and the list-page tasks folded into the rebuilt pages.

| ID | Covered by |
|---|---|
| WS0.1 / LM-1 | Done on main (a586aef, dc809b3, 35f0911) |
| WS0.2 — SHOWS-4, SHOWS-21, SONGS-8, LM-6, LM-11 | Task 8 (contract + `templatesFor`); pickers adopt in 2a/2b; LM-11 header part Task 19 |
| WS0.3 — LIVE-28, SS-30, SHOWS-11 (404), LIVE-32 | Task 21 |
| WS0.4 — LIVE-15, LIVE-16, SS-10 (enables GD-19, STAGE-17, SHOWS-14) | Task 2 |
| WS0.5 — STAGE-11, GD-11, GD-29, LM-22, STAGE-20 | Task 3 (controls); adoption in 2b; GD-29 also Task 14 tabs |
| WS0.6 — LM-9, SONGS-24, SS-13 | Task 3 (`FileDrop`); import modals adopt in 2a/2b |
| WS0.7 — SS-11, SHOWS-25, SONGS-12, GD-23, STAGE-36 | Task 2 (`DeleteButton`); call sites in 2a/2b |
| WS0.8 — SS-29 | Task 5 |
| WS0.9 — SHOWS-2, SHOWS-28, SONGS-16, SS-6, STAGE-29, STAGE-33 | Task 6 (SaveBar, `sendAndAwaitAck`, single owner of `awaitAck`/`useConnection`); editors adopt in 2a/2b |
| WS0.10 — SS-3, SS-8, SS-13, SS-19, SHOWS-24 (slider), LIVE-15 (status labels) | Task 1 |
| WS0.11 — LIVE-18, LIVE-35, SONGS-33, SHOWS-16, SONGS-26, LM-27 | Task 5 |
| WS0.12 — SONGS-17, GD-24, STAGE-21 (upgrades SHOWS-1, LM-5, STAGE-33) | Task 7 |
| WS0.13 — SS-16, SHOWS-23, SONGS-27, STAGE-27, LM-30, SHOWS-15 (copy), SHOWS-26 (list empty), SONGS-25, SONGS-7, SS-4, STAGE-25, SHOWS-17, GD-15, STAGE-24, SONGS-23, LM-28 (pattern) | Superseded by LibraryList: Task 9 (states), Tasks 12–15 (copy, duplicate, empty states, offline); `/projects` is converted by P2b.29 (with LM-28), then Task 16 deletes the old components |
| WS0.14 — SS-2, SHOWS-18, SONGS-22, GD-16, STAGE-25, LM-4, SONGS-31; D10 | Task 9 + rebuild in Tasks 12–16 (D10 superseded by the context menu) |
| WS0.15 — SS-1, SS-12, LM-33, SS-25 | `PageBody variant` (the one width model): Task 1. `document.title` (LM-33, SS-25): P2b.2 (`shell/PageChrome.tsx` owner) |
| WS0.16 — SS-4 | Task 6 (`useConnection`, `OfflineState`); Live panels adopt in 2a |
| WS0.17 — GD-3, GD-21, STAGE-14, GD-11 (weight), STAGE-15 (weight), STAGE-11 (dependency) | Task 3 (`NumberInput` with `precision`, `roundTo`, `formatNumber` in `packages/ui`, contracts §2). `editor-kit` → `@overlaysys/ui` dependency, `FieldRow`, `FontWeightSelect`, re-export of the number helpers: P2b.4 |
| WS3.17 — SHOWS-17 | Task 12 (date sort + Upcoming/Past filter instead of grouped headings; duplicate keeps the date, Task 17) |
| WS3.19 — SHOWS-22 (list context), SHOWS-23 (list button) | Task 12; the editor parts stay with 2a |
| WS4.14 — SONGS-22, SONGS-23, SONGS-25, SONGS-26, SONGS-27 (list copy), SONGS-31 | Task 13 (paste panel focus: P2a.20 reads `?paste=1`) |
| WS4.16 — SONGS-30 (Recently deleted modal) | Task 13 |
| WS4.9 — export name part | Task 11 + Task 13 |
| WS5.8 — GD-4 | P2b.12 (usage helper, route, built-in protection); Task 14 uses it on the Designs list |
| WS5.12 — GD-15, GD-16, GD-17, GD-18, GD-28, GD-29, GD-30 | Task 14 (GD-17 editor-header id: 2b) |
| WS5.13 — STAGE-24, STAGE-26, STAGE-27 | Task 14 (stage layout thumbnails deferred: needs a static stage-widgets render; "Used by" column ships) |
| WS8.6 — LM-26, LM-30, SS-17, LM-4 | Task 15 (+ Task 12 for shows); the editor's "Move to project" field: 2b |
| D22 (thumbnails) | Superseded by the spec: Task 10 + Task 14 grid |
