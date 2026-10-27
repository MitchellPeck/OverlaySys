# Confidence Monitor — Phase 5 (Layout Designer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators design their own confidence-monitor layouts on a freeform canvas. Layouts are stored on disk and synced to the cloud. A draft can be previewed live on a real stage monitor before it is saved, and channels pick any stored or built-in layout.

**Architecture:** The renderer's stage widgets move into a new workspace package, `@overlaysys/stage-widgets`, so the renderer and the designer draw the same components (that's the spec's "output matches exactly"). Layouts become a registry like templates: `server/src/stageLayouts.ts` over `data/stage-layouts/<id>.json`, with built-ins merged in from core, CRUD over WS, and a sync table `stage_layouts`. The stage feed hub resolves a channel's layout in this order: preview override, then stored layout, then built-in, then Speaker. Every save invalidates all feeds. The designer is an operator page backed by an immer + history zustand store. Its canvas (`StageCanvas`) and inspector (`StageInspector`) live in `editor-kit`, and all geometry is pure helpers in `stageGeometry.ts`.

**Tech Stack:** TypeScript, zod 3, Fastify + `ws`, React 19, Next 15 operator, Vite renderer, immer 10 + zustand 5, Supabase JS (cloud adapter), Vitest 4 (node env, logic tests only).

**Spec:** `docs/superpowers/specs/2026-10-22-confidence-monitor-design.md` ("Layout designer", `StageLayout`, cloud sync, phase 5) and `docs/superpowers/specs/2026-10-27-stage-timers-pco-live-design.md` (phase 5 paragraph: designer covers the phase 6–8 widget props).

**Prerequisite:** Phases 6–8 have landed. In particular, this plan uses these fields from them:
- `timer.props`: `source` (`"firstActive" | "currentItem" | { channel } | { timerId }`), `warnBelowSec`, `warnColor`, `overColor`, `showLabel`
- the `serviceProgress` widget (`showPosition`, `showEnd`, `showDelta`)
- `rowTitle.props.prefer`
- `StageTimer.{id, source, overtime, running}`
- `StageFeed.service` (`StageServiceView`, including `laterLengthSec`)
- the operator store's `timers_state` list

If a field has a different name in the code, use the code's name and note it in the task's commit.

## Global Constraints

- Layout file: `data/stage-layouts/<id>.json` (under `dataRoot()`), validated by `StageLayoutSchema`. There are no fixtures and no seeding.
- Built-in layouts ship in code: **Speaker** (exists), **Lyrics** and **Scripture** (new). They are read-only. Saving or deleting a built-in id is rejected with error code `read_only`. Built-ins can be duplicated.
- New ids: `stage-layout-${randomUUID().slice(0, 8)}` (server); the operator uses `uuid().slice(0, 8)` with the same prefix.
- Every local write stamps `updatedAt` and deletes are tombstones (`server/src/lifecycle.ts`: `stampWrite`, `tombstone`, `isLive`, `liveOnly`).
- Layout resolution for a channel: preview override → stored live layout → built-in → `SPEAKER_LAYOUT`. A missing or deleted layout falls back to Speaker.
- Any layout save or delete, sync pull, or preview change calls `stageFeedHub.invalidateAll()`, so open monitors update immediately.
- Preview-on-monitor: one override per stage channel. It's held in server memory and owned by the socket that set it. It's cleared on toggle-off (`layout: null`), on a save of the same layout id, and when the owning socket closes.
- Size presets: 1920×1080, 3840×2160, 1920×1200, 1600×1200, custom. Changing the size does not move or scale widgets *(call)*.
- Sample data kinds (spec): Song, Scripture, Sermon notes, Video + timer, Message, **Item countdown (overtime)**, **PCO Live**.
- Minimum widget size is 20×20 canvas px. Rects must stay `w > 0 && h > 0` (`StageRectSchema` is positive-only).
- Snapping: to canvas edges and center, and to other widgets' edges and centers. The threshold is 6 screen px (`6 / scale` canvas px). Holding Alt while dragging disables snapping *(call)*.
- Arrow keys nudge 1 px; Shift + arrow nudges 10 px. Locked widgets ignore drag, resize and nudge.
- Undo/redo uses the `apps/operator/src/lib/editorStore.ts` pattern: `commit` / `applyLive` / `pushHistory`, `HISTORY_LIMIT = 50`.
- The Stage layouts UI is desktop-only. It's hidden in the cloud build, like sermon notes; the cloud sync of `stage_layouts` still runs server-side *(call)*.
- The cloud table migration belongs in apps-portal's Supabase project (schema `overlaysys`). This repo only documents it, in `docs/cloud-stage-layouts-migration.md`. Do not apply it.
- `PROTOCOL_VERSION` is unchanged; all new messages are additive.
- Tests are Vitest (node env), logic only; UI is verified by typecheck, build and the manual checklist. Run `pnpm test`.

## Review Focus

- **Saving the layout a monitor is previewing.** The monitor must drop the preview and show the saved layout, with no stale draft left behind. (Task 5 test.)
- **The designer's socket drops while previewing.** The monitor must revert to its configured layout. (Task 5 test.)
- **A channel's `layoutId` names a deleted stored layout.** The feed must use Speaker, not throw. (Task 4 test.)
- **`save_stage_layout` with a built-in id (`"speaker"`).** It must be rejected and must never shadow the built-in. (Task 4 test.)
- **Resizing past the opposite edge or below the minimum.** The rect must clamp to 20 px, and w/h must never be zero or negative, because the schema would reject the save. (Task 7 test.)

---

## File Structure

**New package `packages/stage-widgets/`** (`@overlaysys/stage-widgets`)
- Move from `apps/renderer/src/stage/`: `widgets.tsx`, `StageView.tsx`, `fitText.ts`, `useFitText.ts`, `notesMarkdown.ts`, `notesOverflow.ts`, `stageTime.ts`, plus their `*.test.ts`.
- Create `src/index.ts`, `package.json`, `tsconfig.json`.

**Core (`packages/core/src/`)**
- Modify `stageLayout.ts`: `LYRICS_LAYOUT`, `SCRIPTURE_LAYOUT`, `StageLayoutMeta`, `stageLayoutMeta()`, `isBuiltInStageLayoutId()`, `defaultStageWidget()`, `STAGE_WIDGET_LABELS`.
- Create `stageSampleFeeds.ts`: `STAGE_SAMPLE_KINDS`, `sampleStageFeed()`.
- Modify `storageAdapter.ts`, `syncEngine.ts`: `stageLayouts` entity.
- Modify `index.ts`.

**Protocol (`packages/ws-protocol/src/index.ts`)**
- Client: `list_stage_layouts`, `get_stage_layout`, `save_stage_layout`, `delete_stage_layout`, `duplicate_stage_layout`, `stage_layout_preview`.
- Server: `stage_layout_list`, `stage_layout`, `stage_layout_previews`.

**Server (`server/src/`)**
- Modify `storage.ts`: stage layout files.
- Create `stageLayouts.ts`: the registry.
- Modify `stageFeedHub.ts`: layout resolution and preview overrides.
- Modify `ws.ts`: handlers, close cleanup.
- Modify `fsStorageAdapter.ts`, `cloudSync.ts`.

**Supabase adapter (`packages/supabase/src/`)** — modify `cloudStorageAdapter.ts` and `database.types.ts`.

**Editor kit (`packages/editor-kit/src/`)**
- Create `stageGeometry.ts`: pure geometry.
- Create `StageCanvas.tsx`, `StageInspector.tsx`, `StageWidgetList.tsx`, `StagePalette.tsx`.
- Modify `index.ts`, `package.json`.

**Operator (`apps/operator/src/`)**
- Create `lib/stageLayoutOps.ts` (pure layout edits) and `lib/stageEditorStore.ts`.
- Modify `lib/store.ts` and `lib/useWs.ts`: `stageLayouts`, `stageLayoutPreviews`.
- Create `app/design/stage/edit/page.tsx`.
- Modify `app/design/page.tsx`: the tabs and the Stage layouts list.
- Modify `app/settings/channels/page.tsx`: the layout picker.
- Modify `next.config.mjs` and `package.json`.

**Renderer** — modify `apps/renderer/src/Renderer.tsx` and `package.json` to import from the package.

**Docs** — create `docs/cloud-stage-layouts-migration.md`.

---

### Task 1: Extract `@overlaysys/stage-widgets`

The designer has to render the real widgets, and the operator can't import from an app. This task changes no behaviour.

**Files:**
- Create: `packages/stage-widgets/package.json`, `packages/stage-widgets/tsconfig.json`, `packages/stage-widgets/src/index.ts`
- Move (with `git mv`): `apps/renderer/src/stage/*` → `packages/stage-widgets/src/`
- Modify: `apps/renderer/src/Renderer.tsx`, `apps/renderer/package.json`, `apps/operator/package.json`, `apps/operator/next.config.mjs` (`transpilePackages`), `packages/editor-kit/package.json`

**Interfaces:**
- Produces, from `@overlaysys/stage-widgets`:
  - `StageView`
  - `StageWidgetView({ widget, feed, nowMs, send? })`
  - `serverOffset`, `timerDisplay`, `formatClockDisplay`, `formatRemaining`, `videoRemainingSec`
  - `fitFontSize`
  - anything phase 6–8 added to `stageTime.ts` (for example the signed timer display)

- [ ] **Step 1: Move the files and create the package**

`package.json`: name `@overlaysys/stage-widgets`, `"type": "module"`, `main`/`types`/`exports` → `./src/index.ts` (copy the `packages/editor-kit/package.json` shape). Dependencies: `@overlaysys/core`, `@overlaysys/ws-protocol` (workspace). Peer dependency: `react ^19`. `tsconfig.json`: copy editor-kit's, and add `"jsx": "react-jsx"` if `tsconfig.base.json` doesn't set it. `index.ts` re-exports the public names listed above.

Fix the relative imports inside the moved files (they stay sibling-relative). Then:
- Renderer: `import { StageView, serverOffset } from "@overlaysys/stage-widgets"`, plus the dependency.
- Operator: add the dependency and append `"@overlaysys/stage-widgets"` to `transpilePackages`.
- Editor-kit: add the dependency.

Run `pnpm install`.

- [ ] **Step 2: Verify**

Run: `pnpm install && pnpm test && pnpm typecheck && pnpm --filter @overlaysys/renderer build`
Expected: the moved tests are found under `packages/stage-widgets/src/` and pass, and the test count is unchanged. Typecheck and build succeed.

- [ ] **Step 3: Commit**

```bash
git add -A packages/stage-widgets apps/renderer apps/operator/package.json apps/operator/next.config.mjs packages/editor-kit/package.json pnpm-lock.yaml
git commit -m "refactor: move stage widgets into @overlaysys/stage-widgets"
```

---

### Task 2: Core — Lyrics and Scripture built-ins, metas, widget defaults

**Files:**
- Modify: `packages/core/src/stageLayout.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/stageLayout.test.ts`

**Interfaces:**
- Produces:
  - `LYRICS_LAYOUT`, `SCRIPTURE_LAYOUT: StageLayout`
  - `BUILT_IN_STAGE_LAYOUTS = [SPEAKER_LAYOUT, LYRICS_LAYOUT, SCRIPTURE_LAYOUT]`
  - `type StageLayoutMeta = { id: string; name: string; size: { w: number; h: number }; builtIn: boolean }`, plus `StageLayoutMetaSchema`
  - `stageLayoutMeta(l: StageLayout): StageLayoutMeta`
  - `isBuiltInStageLayoutId(id: string): boolean`
  - `defaultStageWidget(kind: StageWidgetKind, id: string, rect: StageRect): StageWidget` — returns `StageWidgetSchema.parse({ id, kind, rect })`, so every default comes from the schema
  - `STAGE_WIDGET_LABELS: Record<StageWidgetKind, string>` — palette names, for example `currentSlide: "Current slide"`, `serviceProgress: "Service progress"`
- `resolveStageLayout(id)` keeps its built-in-only behaviour (the server layers stored layouts on top in Task 4).

- [ ] **Step 1: Write the failing tests**

```ts
it("ships three read-only built-ins", () => {
  expect(BUILT_IN_STAGE_LAYOUTS.map((l) => l.id)).toEqual(["speaker", "lyrics", "scripture"]);
  for (const l of BUILT_IN_STAGE_LAYOUTS) {
    expect(l.builtIn).toBe(true);
    expect(StageLayoutSchema.parse(l)).toEqual(l);
  }
});
it("lyrics is lyrics-first", () => {
  const kinds = LYRICS_LAYOUT.widgets.map((w) => w.kind);
  expect(kinds).toEqual(expect.arrayContaining(["currentSlide", "nextSlide", "clock", "message"]));
  const cur = LYRICS_LAYOUT.widgets.find((w) => w.kind === "currentSlide")!;
  expect(cur.rect.w * cur.rect.h).toBeGreaterThan(0.5 * 1920 * 1080 * 0.5);
});
it("scripture has reference text, next verse and a notes sidebar", () => {
  const kinds = SCRIPTURE_LAYOUT.widgets.map((w) => w.kind);
  expect(kinds).toEqual(expect.arrayContaining(["currentSlide", "nextSlide", "sermonNotes", "message"]));
});
it("widgets of every built-in stay inside the canvas", () => {
  for (const l of BUILT_IN_STAGE_LAYOUTS)
    for (const w of l.widgets) {
      expect(w.rect.x).toBeGreaterThanOrEqual(0);
      expect(w.rect.y).toBeGreaterThanOrEqual(0);
      expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(l.size.w);
      expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(l.size.h);
    }
});
it("isBuiltInStageLayoutId", () => {
  expect(isBuiltInStageLayoutId("lyrics")).toBe(true);
  expect(isBuiltInStageLayoutId("stage-layout-1234")).toBe(false);
});
it("defaultStageWidget fills schema defaults for every kind", () => {
  for (const kind of Object.keys(STAGE_WIDGET_LABELS) as StageWidgetKind[]) {
    const w = defaultStageWidget(kind, "w1", { x: 0, y: 0, w: 100, h: 50 });
    expect(w.kind).toBe(kind);
    expect(w.style.fontSize).toBe(64);
  }
  expect(defaultStageWidget("timer", "t", { x: 0, y: 0, w: 1, h: 1 }).props).toMatchObject({ source: "firstActive" });
});
it("stageLayoutMeta", () => {
  expect(stageLayoutMeta(SPEAKER_LAYOUT)).toEqual({ id: "speaker", name: "Speaker", size: { w: 1920, h: 1080 }, builtIn: true });
});
```

Run: `pnpm vitest run packages/core/src/stageLayout.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`STAGE_WIDGET_LABELS` must have a key for every `StageWidgetKind`. Type it as `Record<StageWidgetKind, string>` so a missing kind is a type error.

Lyrics (1920×1080, background `#000000`):
- `currentSlide` {24,24,1872,720}: fontSize 96, align center, vAlign middle, `showReference: false`
- `nextSlide` {24,760,1480,200}: fontSize 48, color `#bbbbbb`, label "NEXT", `maxLines: 2`
- `clock` {1528,760,368,200}: fontSize 72, align right, vAlign middle, `autoFit: false`
- `message` {24,976,1872,80}: same style as Speaker's message bar

Scripture (1920×1080):
- `currentSlide` {24,24,1300,820}: fontSize 64, label "SCRIPTURE", `showReference: true`
- `nextSlide` {24,860,1300,196}: fontSize 36, color `#bbbbbb`, label "NEXT VERSE"
- `sermonNotes` {1348,24,548,936}: fontSize 36, label "NOTES", border as in Speaker
- `message` {1348,976,548,80}: Speaker message style, fontSize 40

Run → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/stageLayout.ts packages/core/src/stageLayout.test.ts packages/core/src/index.ts
git commit -m "feat(core): Lyrics and Scripture stage layouts, layout metas, widget defaults"
```

---

### Task 3: Core — sample feeds for the designer

**Files:**
- Create: `packages/core/src/stageSampleFeeds.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/stageSampleFeeds.test.ts`

**Interfaces:**
- Consumes: `StageFeedSchema`, `StageLayout`, `encodeTimerValue`.
- Produces:
  - `STAGE_SAMPLE_KINDS = ["song", "scripture", "notes", "videoTimer", "message", "itemOvertime", "pcoLive"] as const`
  - `type StageSampleKind`
  - `STAGE_SAMPLE_LABELS: Record<StageSampleKind, string>`: "Song", "Scripture", "Sermon notes", "Video + timer", "Message", "Item countdown (overtime)", "PCO Live"
  - `sampleStageFeed(kind: StageSampleKind, layout: StageLayout, now: number): StageFeed`

- [ ] **Step 1: Write the failing tests**

```ts
const now = 1_700_000_000_000;
it.each(STAGE_SAMPLE_KINDS)("%s parses as a StageFeed and carries the layout", (k) => {
  const f = sampleStageFeed(k, SPEAKER_LAYOUT, now);
  expect(StageFeedSchema.parse(f)).toEqual(f);
  expect(f.layout).toBe(SPEAKER_LAYOUT);
  expect(f.serverNow).toBe(now);
});
it("song shows lyric current and next", () => {
  const f = sampleStageFeed("song", SPEAKER_LAYOUT, now);
  expect(f.current.kind).toBe("lyric");
  expect(f.next.kind).toBe("lyric");
  expect(f.row?.title).toBeTruthy();
});
it("notes has several points with the second active", () => {
  const f = sampleStageFeed("notes", SPEAKER_LAYOUT, now);
  expect(f.notes!.points.length).toBeGreaterThanOrEqual(3);
  expect(f.notes!.pointIdx).toBe(1);
});
it("itemOvertime is an item countdown 1:23 past zero", () => {
  const t = sampleStageFeed("itemOvertime", SPEAKER_LAYOUT, now).timers[0]!;
  expect(t).toMatchObject({ source: "item", mode: "countdown", overtime: true, running: true });
  expect(decodeTimerValue(t.value).anchor).toBe(now - 83_000);
});
it("pcoLive sets the service view", () => {
  const s = sampleStageFeed("pcoLive", SPEAKER_LAYOUT, now).service!;
  expect(s).toMatchObject({ source: "pco", status: "live", itemIndex: 4, itemCount: 12 });
  expect(s.plannedEndAt).toBeGreaterThan(now);
});
it("message sample is fresh", () => {
  expect(sampleStageFeed("message", SPEAKER_LAYOUT, now).message).toEqual({ text: "Wrap up", sentAt: now });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `sampleStageFeed`**

Start from a neutral base, with `row`/`nextRow` set and everything else empty or null. Each kind overrides only its own slice:
- **song:** "Amazing Grace" verse/chorus lines.
- **scripture:** John 3:16–17.
- **notes:** four points with headings.
- **videoTimer:** `video` playing, 95 s remaining at `now`, plus a manual countdown timer 4:00 running.
- **message:** as in the test above.
- **itemOvertime:** `{ id: "current-item", label: "Sermon", source: "item", overtime: true, running: true, mode: "countdown", value: encodeTimerValue({ anchor: now - 83_000, durationMs: 1_800_000 }) }`.
- **pcoLive:** `service` = `{ source: "pco", planTitle: "Sunday 9:00", itemIndex: 4, itemCount: 12, current: { title: "Sermon", startedAt: now - 600_000, lengthSec: 1800 }, next: { title: "Response" }, laterLengthSec: 900, plannedEndAt: now + 2_400_000, status: "live" }`, plus the matching PCO item timer.

Run → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/stageSampleFeeds.ts packages/core/src/stageSampleFeeds.test.ts packages/core/src/index.ts
git commit -m "feat(core): sample stage feeds for the layout designer"
```

---

### Task 4: Server — stage layout storage and registry

**Files:**
- Modify: `server/src/storage.ts`
- Create: `server/src/stageLayouts.ts`
- Test: `server/src/stageLayouts.test.ts`

**Interfaces:**
- Consumes: Task 2 (`BUILT_IN_STAGE_LAYOUTS`, `isBuiltInStageLayoutId`, `stageLayoutMeta`, `SPEAKER_LAYOUT`).
- Produces:
  - `storage.ts`: `loadAllStageLayouts(): Promise<StageLayout[]>` (tombstones included), `saveStageLayout(l): Promise<void>`. Use the `readJsonFiles` / `writeAtomic` pattern on `STAGE_LAYOUTS_DIR = path.join(dataRoot(), "stage-layouts")`.
  - `stageLayouts.ts`:
    - `reloadStageLayouts(): Promise<void>`
    - `listStageLayoutMetas(): Promise<StageLayoutMeta[]>` — built-ins first, then stored live layouts by name
    - `getStageLayout(id): Promise<StageLayout | null>` — built-ins included
    - `saveStageLayout(l): Promise<StageLayout>` — throws `ReadOnlyLayoutError` on a built-in id; strips `builtIn`; `stampWrite`
    - `deleteStageLayout(id): Promise<boolean>` — false for built-ins and unknown ids; writes a tombstone
    - `duplicateStageLayout(id): Promise<StageLayout | null>` — works on built-ins too; new id `stage-layout-xxxxxxxx`, name `"<name> (copy)"`, no `builtIn`
    - `resolveStageLayout(id: string | undefined): Promise<StageLayout>` — stored live, then built-in, then Speaker
    - `export class ReadOnlyLayoutError extends Error`

- [ ] **Step 1: Write the failing tests**

Use `server/src/registries.test.ts`'s temp-dir harness (`OVERLAYSYS_DATA_DIR` and `OVERLAYSYS_FIXTURES_DIR` → mkdtemp, then `reloadStageLayouts()` in `beforeEach`).

```ts
const mine = (over: Partial<StageLayout> = {}): StageLayout =>
  StageLayoutSchema.parse({ id: "stage-layout-aaaa1111", name: "Mine", widgets: [], ...over });

it("lists built-ins first, then stored", async () => {
  await stageLayouts.saveStageLayout(mine());
  const metas = await stageLayouts.listStageLayoutMetas();
  expect(metas.map((m) => m.id)).toEqual(["speaker", "lyrics", "scripture", "stage-layout-aaaa1111"]);
  expect(metas[3]!.builtIn).toBe(false);
});
it("save stamps updatedAt and persists to data/stage-layouts", async () => {
  const saved = await stageLayouts.saveStageLayout(mine());
  expect(saved.updatedAt).toBeTruthy();
  const raw = JSON.parse(await fs.readFile(path.join(tmpDir, "stage-layouts", "stage-layout-aaaa1111.json"), "utf8"));
  expect(raw.name).toBe("Mine");
});
it("rejects saving a built-in id", async () => {
  await expect(stageLayouts.saveStageLayout({ ...SPEAKER_LAYOUT, name: "Hacked" })).rejects.toBeInstanceOf(ReadOnlyLayoutError);
  expect((await stageLayouts.getStageLayout("speaker"))!.name).toBe("Speaker");
});
it("delete tombstones; built-ins can't be deleted", async () => {
  await stageLayouts.saveStageLayout(mine());
  expect(await stageLayouts.deleteStageLayout("stage-layout-aaaa1111")).toBe(true);
  expect(await stageLayouts.getStageLayout("stage-layout-aaaa1111")).toBeNull();
  expect((await storage.loadAllStageLayouts())[0]!.deletedAt).toBeTruthy();
  expect(await stageLayouts.deleteStageLayout("speaker")).toBe(false);
});
it("duplicates a built-in into an editable copy", async () => {
  const copy = (await stageLayouts.duplicateStageLayout("lyrics"))!;
  expect(copy.id).toMatch(/^stage-layout-[0-9a-f]{8}$/);
  expect(copy.name).toBe("Lyrics (copy)");
  expect(copy.builtIn).toBeUndefined();
  expect(copy.widgets).toEqual(LYRICS_LAYOUT.widgets);
});
it("resolve: stored → built-in → Speaker (deleted / unknown / undefined)", async () => {
  await stageLayouts.saveStageLayout(mine());
  expect((await stageLayouts.resolveStageLayout("stage-layout-aaaa1111")).name).toBe("Mine");
  expect((await stageLayouts.resolveStageLayout("lyrics")).id).toBe("lyrics");
  await stageLayouts.deleteStageLayout("stage-layout-aaaa1111");
  expect((await stageLayouts.resolveStageLayout("stage-layout-aaaa1111")).id).toBe("speaker");
  expect((await stageLayouts.resolveStageLayout(undefined)).id).toBe("speaker");
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — mirror `server/src/templates.ts` (REGISTRY map, `ensureLoaded`, lifecycle helpers). Run → PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/storage.ts server/src/stageLayouts.ts server/src/stageLayouts.test.ts
git commit -m "feat(server): stored stage layouts registry"
```

---

### Task 5: Protocol, WS handlers, feed-hub layout resolution and preview overrides

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`, `server/src/stageFeedHub.ts`, `server/src/ws.ts`
- Test: `packages/ws-protocol/src/schema.test.ts`, `server/src/stageFeedHub.test.ts`, `server/src/ws.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces, client messages:
  - `{ type: "list_stage_layouts" }`
  - `{ type: "get_stage_layout"; layoutId }`
  - `{ type: "save_stage_layout"; layout: StageLayout }`
  - `{ type: "delete_stage_layout"; layoutId }`
  - `{ type: "duplicate_stage_layout"; layoutId }`
  - `{ type: "stage_layout_preview"; channel: string; layout: StageLayout | null }`
- Produces, server messages:
  - `{ type: "stage_layout_list"; layouts: StageLayoutMeta[] }`
  - `{ type: "stage_layout"; layout: StageLayout }`
  - `{ type: "stage_layout_previews"; previews: { channel: string; layoutId: string }[] }`
- `stageFeedHub.ts` additions:
  - `setPreview(channel: string, layout: StageLayout, ownerId: string): void`
  - `clearPreview(channel: string, ownerId: string): void` — only the owner can clear
  - `clearPreviewsByOwner(ownerId: string): void`
  - `clearPreviewsForLayout(layoutId: string): void`
  - `listPreviews(): { channel: string; layoutId: string }[]`
  - `subscribePreviews(listener: () => void): () => void`
  - Every mutation calls the listeners, then `invalidateAll()`. `computeFeed` resolves the layout as `previews.get(channel)?.layout ?? await stageLayouts.resolveStageLayout(cfg.layoutId)`.

- [ ] **Step 1: Write the failing tests**

`schema.test.ts`: `save_stage_layout` with `SPEAKER_LAYOUT` parses; `stage_layout_preview` with `layout: null` parses; and `stage_layout_previews` decodes.

`stageFeedHub.test.ts` (use the file's existing harness for channel configs and the temp dir):

```ts
it("uses a stored layout named by the channel", async () => { /* save "Mine", stage channel layoutId=Mine → computeFeed(..).layout.name === "Mine" */ });
it("falls back to Speaker when the stored layout is deleted", async () => { /* delete → layout.id === "speaker" */ });
it("a preview override wins until cleared by its owner only", async () => {
  hub.setPreview("stage1", { ...SPEAKER_LAYOUT, id: "draft", name: "Draft", builtIn: undefined }, "sockA");
  expect((await hub.computeFeed("stage1"))!.layout.name).toBe("Draft");
  hub.clearPreview("stage1", "sockB");
  expect((await hub.computeFeed("stage1"))!.layout.name).toBe("Draft");
  hub.clearPreviewsByOwner("sockA");
  expect((await hub.computeFeed("stage1"))!.layout.id).not.toBe("draft");
});
it("saving a layout clears previews of that layout id", async () => {
  hub.setPreview("stage1", mineDraft, "sockA");
  hub.clearPreviewsForLayout(mineDraft.id);
  expect(hub.listPreviews()).toEqual([]);
});
```

`ws.test.ts` (use the existing socket helper):
- `save_stage_layout` acks with `op: "save_stage_layout"` and broadcasts `stage_layout_list` and `stage_layout`.
- `save_stage_layout` with `SPEAKER_LAYOUT` → `{ type: "error", code: "read_only" }`.
- When a socket sends `stage_layout_preview` and then closes, `listPreviews()` is empty.

Run → FAIL.

- [ ] **Step 2: Implement the protocol and the hub**

Use `StageLayoutSchema` / `StageLayoutMetaSchema` from core in the schemas. In the hub, `previews: Map<string, { layout; ownerId }>`. `setPreview` replaces any existing preview on that channel, whoever owns it (the last designer wins) *(call)*.

- [ ] **Step 3: Implement the WS handlers**

Mirror the `*_template` cases in `ws.ts` (lines ~243–290):
- Saves and deletes broadcast the new `stage_layout_list` and call `scheduleSync()` and `stageFeedHub.invalidateAll()`.
- A save also calls `clearPreviewsForLayout(saved.id)` and broadcasts `stage_layout`.
- Catch `ReadOnlyLayoutError` → `send({ type: "error", code: "read_only", message: id })`.

For `stage_layout_preview`, give each connection a `connId = randomUUID()`. A null layout calls `clearPreview(channel, connId)`; otherwise call `setPreview(channel, layout, connId)`. In `ws.on("close")`, call `stageFeedHub.clearPreviewsByOwner(connId)`.

At module level: `stageFeedHub.subscribePreviews(() => broadcast({ type: "stage_layout_previews", previews: stageFeedHub.listPreviews() }))`.

Run → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ws-protocol/src server/src/stageFeedHub.ts server/src/stageFeedHub.test.ts server/src/ws.ts server/src/ws.test.ts
git commit -m "feat(server): stage layout CRUD over WS, stored layouts and preview overrides in feeds"
```

---

### Task 6: Cloud sync of `stage_layouts`

**Files:**
- Modify: `packages/core/src/storageAdapter.ts`, `packages/core/src/syncEngine.ts`, `packages/core/src/syncEngine.test.ts`, `server/src/fsStorageAdapter.ts`, `server/src/fsStorageAdapter.test.ts`, `packages/supabase/src/cloudStorageAdapter.ts`, `packages/supabase/src/database.types.ts`, `server/src/cloudSync.ts`
- Create: `docs/cloud-stage-layouts-migration.md`

**Interfaces:**
- Produces: these `StorageAdapter` methods, with the same contract as the Templates block:
  - `listStageLayouts(orgId)`
  - `listStageLayoutsSince(orgId, watermark)`
  - `getStageLayout(orgId, id)`
  - `saveStageLayout(orgId, l)`
  - `deleteStageLayout(orgId, id)`

  Also `SyncEntityKind` gains `"stageLayouts"`.

- [ ] **Step 1: Write the failing tests**

In `syncEngine.test.ts`, extend `makeMemAdapter` with a `stageLayouts` map, then:

```ts
it("pulls a remote-only stage layout and pushes a newer local one", async () => { /* perTable.stageLayouts.pulled === 1, then pushed === 1 */ });
it("a missing remote stage_layouts table fails only that table", async () => {
  remote.listStageLayoutsSince = async () => { throw new Error('relation "overlaysys.stage_layouts" does not exist'); };
  const r = await sync(local, remote, "org");
  expect(r.errors).toEqual([expect.objectContaining({ kind: "stageLayouts", id: "(list)" })]);
  expect(r.perTable.templates.pushed + r.perTable.templates.pulled).toBeGreaterThanOrEqual(0); // other tables still ran
});
```

In `fsStorageAdapter.test.ts`, add a save → `listStageLayoutsSince` round-trip that includes tombstones.

Run → FAIL.

- [ ] **Step 2: Implement**

1. In `syncEngine.ts`, add the `reconcileTable<StageLayout>` block after templates, and add `stageLayouts: { pulled: 0, pushed: 0 }` to `perTable`.
2. In `FsStorageAdapter`, delegate to `storage.loadAllStageLayouts` / `saveStageLayout`. List hides tombstones and Since includes them, as for templates.
3. In `CloudStorageAdapter`, widen the payload helpers' table union to include `"stage_layouts"` and add the five methods. In `database.types.ts`, add `stage_layouts` with the same Row/Insert/Update as `templates`.
4. In `cloudSync.ts` `fanOutSyncWrites`, add:

   ```ts
   if (touched("stageLayouts")) {
     await reloadStageLayouts();
     broadcast({ type: "stage_layout_list", layouts: await listStageLayoutMetas() });
   }
   ```

   and add `touched("stageLayouts")` to the condition that calls `stageFeedHub.invalidateAll()`.

Write `docs/cloud-stage-layouts-migration.md` following `docs/cloud-sermon-notes-migration.md`. It says where the migration goes (apps-portal, schema `overlaysys`), gives the SQL below, says to regenerate types afterwards, and notes that until the migration is applied each sync pass logs one `stageLayouts (list)` error and nothing else is affected:

```sql
create table if not exists overlaysys.stage_layouts (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);
alter table overlaysys.stage_layouts enable row level security;
grant select, insert, update, delete on overlaysys.stage_layouts to authenticated, service_role;
create policy "stage_layouts_select_members" on overlaysys.stage_layouts for select using (overlaysys.is_org_member(org_id));
create policy "stage_layouts_insert_members" on overlaysys.stage_layouts for insert with check (overlaysys.is_org_member(org_id));
create policy "stage_layouts_update_members" on overlaysys.stage_layouts for update using (overlaysys.is_org_member(org_id));
create policy "stage_layouts_delete_members" on overlaysys.stage_layouts for delete using (overlaysys.is_org_member(org_id));
create trigger stage_layouts_updated_at before update on overlaysys.stage_layouts
  for each row execute function overlaysys.set_updated_at();
```

(`overlaysys.set_updated_at()` is the trigger function used by every table in `supabase/migrations/0001_init.sql`.)

Run: `pnpm test && pnpm typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src packages/supabase/src server/src/fsStorageAdapter.ts server/src/fsStorageAdapter.test.ts server/src/cloudSync.ts docs/cloud-stage-layouts-migration.md
git commit -m "feat(sync): stage_layouts cloud sync; migration doc for apps-portal"
```

---

### Task 7: Editor kit — pure stage geometry

**Files:**
- Create: `packages/editor-kit/src/stageGeometry.ts`
- Modify: `packages/editor-kit/src/index.ts`
- Test: `packages/editor-kit/src/stageGeometry.test.ts`

**Interfaces:**
- Produces:
  - `MIN_WIDGET_SIZE = 20`
  - `SNAP_SCREEN_PX = 6`
  - `type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"`
  - `moveRect(r: StageRect, dx, dy): StageRect`
  - `resizeRect(r: StageRect, handle: ResizeHandle, dx: number, dy: number): StageRect` — the opposite edge stays fixed; each dimension clamps to `MIN_WIDGET_SIZE`
  - `boundsOf(rects: StageRect[]): StageRect`
  - `type Guide = { axis: "x" | "y"; at: number }`
  - `snapRect(moving: StageRect, others: StageRect[], canvas: { w: number; h: number }, threshold: number, edges?: { x: ("start"|"center"|"end")[]; y: (...)[] }): { rect: StageRect; guides: Guide[] }` — snaps each axis independently to the nearest candidate within `threshold`. Candidates are the canvas's 0 / center / size, and each other rect's start / center / end. `edges` limits which edges of `moving` can snap; a resize snaps only the edges being dragged.
  - `alignRects(rects: StageRect[], mode: "left"|"hcenter"|"right"|"top"|"vcenter"|"bottom", canvas): StageRect[]` — aligns to the selection's bounds; with one rect, aligns to the canvas
  - `distributeRects(rects: StageRect[], axis: "x"|"y"): StageRect[]` — equal gaps between the first and last in sorted order; fewer than 3 rects come back unchanged; output keeps input order

- [ ] **Step 1: Write the failing tests**

```ts
const r = { x: 100, y: 100, w: 200, h: 100 };
it("resize se grows, nw keeps the bottom-right fixed", () => {
  expect(resizeRect(r, "se", 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 120 });
  expect(resizeRect(r, "nw", 50, 20)).toEqual({ x: 150, y: 120, w: 150, h: 80 });
});
it("resize past the opposite edge clamps to the minimum, never ≤ 0", () => {
  expect(resizeRect(r, "e", -500, 0)).toEqual({ x: 100, y: 100, w: 20, h: 100 });
  expect(resizeRect(r, "w", 500, 0)).toEqual({ x: 280, y: 100, w: 20, h: 100 });
  expect(resizeRect(r, "n", 0, 999).h).toBe(20);
});
it("snaps to canvas center and reports the guide", () => {
  const { rect, guides } = snapRect({ x: 858, y: 10, w: 200, h: 50 }, [], { w: 1920, h: 1080 }, 6);
  expect(rect.x).toBe(860);
  expect(guides).toContainEqual({ axis: "x", at: 960 });
});
it("snaps to another widget's edge, not beyond threshold", () => {
  const other = { x: 500, y: 0, w: 100, h: 100 };
  expect(snapRect({ x: 603, y: 300, w: 50, h: 50 }, [other], { w: 1920, h: 1080 }, 6).rect.x).toBe(600);
  expect(snapRect({ x: 620, y: 300, w: 50, h: 50 }, [other], { w: 1920, h: 1080 }, 6).rect.x).toBe(620);
});
it("align left to selection bounds; single aligns to canvas", () => {
  const a = { x: 10, y: 0, w: 50, h: 50 }, b = { x: 100, y: 0, w: 50, h: 50 };
  expect(alignRects([a, b], "left", { w: 1920, h: 1080 }).map((x) => x.x)).toEqual([10, 10]);
  expect(alignRects([b], "hcenter", { w: 1920, h: 1080 })[0]!.x).toBe(935);
});
it("distribute x evens gaps and keeps order; <3 unchanged", () => {
  const rs = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }];
  expect(distributeRects(rs, "x").map((x) => x.x)).toEqual([0, 50, 100]);
  expect(distributeRects(rs.slice(0, 2), "x")).toEqual(rs.slice(0, 2));
});
```

Run → FAIL. Implement. Run → PASS.

- [ ] **Step 2: Commit**

```bash
git add packages/editor-kit/src/stageGeometry.ts packages/editor-kit/src/stageGeometry.test.ts packages/editor-kit/src/index.ts
git commit -m "feat(editor-kit): pure stage geometry — resize, snap, align, distribute"
```

---

### Task 8: Operator — layout ops and the stage editor store (undo/redo)

**Files:**
- Create: `apps/operator/src/lib/stageLayoutOps.ts`, `apps/operator/src/lib/stageEditorStore.ts`
- Test: `apps/operator/src/lib/stageLayoutOps.test.ts`, `apps/operator/src/lib/stageEditorStore.test.ts`

**Interfaces:**
- Consumes: `defaultStageWidget` (Task 2); `moveRect`, `alignRects`, `distributeRects` (Task 7).
- Produces, from `stageLayoutOps.ts` (immer recipes on `Draft<StageLayout>`, so they plug into `commit`):
  - `addWidget(kind, id): (d) => void` — new widget 480×200, centered on the canvas and clamped inside it, pushed on top
  - `removeWidgets(ids)`
  - `duplicateWidgets(ids, newId: (old: string) => string)` — copies offset by +20/+20
  - `moveWidgetZ(id, to: "up" | "down" | "top" | "bottom")`
  - `toggleHidden(id)`, `toggleLocked(id)`
  - `nudgeWidgets(ids, dx, dy)` — skips locked widgets
  - `alignWidgets(ids, mode)`, `distributeWidgets(ids, axis)` — skip locked widgets
  - `patchWidget(id, patch: { rect?; style?; props? })` — shallow-merges `style` and `props`
- Produces, from `stageEditorStore.ts` (zustand hook `useStageEditor`):
  - state: `draft: StageLayout | null`, `selectedIds: string[]`, `sampleKind: StageSampleKind` (default `"song"`), `dirty`, `history`, `redoStack`
  - `setDraft`, `commit`, `applyLive`, `pushHistory`, `undo`, `redo`, `markSaved`, `select(ids: string[], additive?: boolean)`, `setSampleKind`
  - Same semantics as `editorStore.ts`, with `HISTORY_LIMIT = 50`.

- [ ] **Step 1: Write the failing tests**

`stageLayoutOps.test.ts` (use `produce` from immer on a fresh 1920×1080 layout):

```ts
it("addWidget centers a 480×200 widget on top", () => {
  const l = produce(blank, addWidget("clock", "clock-1"));
  expect(l.widgets.at(-1)).toMatchObject({ id: "clock-1", kind: "clock", rect: { x: 720, y: 440, w: 480, h: 200 } });
});
it("moveWidgetZ top/bottom/up/down reorders the array", () => { /* … */ });
it("nudge and align skip locked widgets", () => {
  // two widgets, second locked → nudge [a,b] by 10 moves only a
});
it("patchWidget merges style and props", () => {
  // patch style.color keeps fontSize; patch props.seconds keeps format
});
it("duplicateWidgets offsets +20 and gets new ids", () => { /* … */ });
```

`stageEditorStore.test.ts`: call `useStageEditor.getState()` directly (zustand works in node).

```ts
it("commit pushes history; undo/redo round-trip; no-op commit adds nothing", () => {
  const s = useStageEditor.getState();
  s.setDraft(blank);
  s.commit(addWidget("text", "t1"));
  s.commit(() => {});
  expect(useStageEditor.getState().history).toHaveLength(1);
  s.undo();
  expect(useStageEditor.getState().draft!.widgets).toHaveLength(0);
  s.redo();
  expect(useStageEditor.getState().draft!.widgets).toHaveLength(1);
});
it("applyLive changes draft without history; pushHistory snapshots once per drag", () => { /* … */ });
it("undo prunes selection ids that no longer exist", () => { /* select t1, undo add → selectedIds [] */ });
it("history is capped at 50", () => { /* 60 commits → history.length 50 */ });
```

Run → FAIL. Implement. Run → PASS.

- [ ] **Step 2: Commit**

```bash
git add apps/operator/src/lib/stageLayoutOps.ts apps/operator/src/lib/stageLayoutOps.test.ts apps/operator/src/lib/stageEditorStore.ts apps/operator/src/lib/stageEditorStore.test.ts
git commit -m "feat(operator): stage layout edit ops and undoable editor store"
```

---

### Task 9: Editor kit — `StageCanvas`

**Files:**
- Create: `packages/editor-kit/src/StageCanvas.tsx`
- Modify: `packages/editor-kit/src/index.ts`

**Interfaces:**
- Consumes: `StageWidgetView` (Task 1); `resizeRect`, `moveRect`, `snapRect`, `SNAP_SCREEN_PX` (Task 7).
- Produces:

```ts
type StageCanvasProps = {
  layout: StageLayout;
  feed: StageFeed;                  // sample feed; its .layout is ignored, `layout` is drawn
  nowMs: number;
  selectedIds: string[];
  onSelect(ids: string[], additive: boolean): void;
  onLive(recipe: (d: Draft<StageLayout>) => void): void;
  onCommit(recipe: (d: Draft<StageLayout>) => void): void;
  onPushHistory(): void;
  onNudge(dx: number, dy: number): void;   // the page commits nudgeWidgets(selectedIds, dx, dy)
};
```

- [ ] **Step 1: Implement (UI; typecheck + manual)**

- **Scaling:** scale the layout to fit the host with `fitScale` from `utils.ts`. Draw `layout.background`. Render each non-hidden widget with `<StageWidgetView widget={w} feed={feed} nowMs={nowMs} />` (no `send`, so notes overflow reporting stays off). Hidden widgets are drawn only as a dashed outline while selected.
- **Overlay:** an overlay div per widget catches pointer events.
- **Selection:** a click selects the widget; Shift-click toggles it in the selection; clicking the background clears the selection. A marquee drag on the background selects every widget it intersects.
- **Move:** dragging a selected unlocked widget moves the whole selection. Call `onPushHistory()` on the first movement past 2 screen px, then `onLive` each frame.
  - Snap the primary widget's moved rect with `snapRect` (threshold `SNAP_SCREEN_PX / scale`; the other rects are the unselected widgets) and apply the same delta to the rest of the selection.
  - Alt disables snapping. Draw the returned guides as 1 px magenta lines.
- **Resize:** 8 handles, only when exactly one unlocked widget is selected. Resize goes through `resizeRect` and then snaps only the dragged edges.
- **Pointer up:** after a drag, commit nothing extra. History was pushed at drag start and the draft is already live.
- **Keyboard:** the canvas owns arrow keys while it has focus (`tabIndex=0`). Arrows call `onNudge(dx, dy)`: 1 px, or 10 px with Shift. Locked widgets are skipped by `nudgeWidgets` on the page side. Ignore keys while focus is in an input, as `Canvas.tsx`'s `isEditable` does.

Run: `pnpm --filter @overlaysys/editor-kit typecheck`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add packages/editor-kit/src/StageCanvas.tsx packages/editor-kit/src/index.ts
git commit -m "feat(editor-kit): StageCanvas with move, resize, snap, multi-select"
```

---

### Task 10: Editor kit — `StageInspector`, `StageWidgetList`, `StagePalette`

**Files:**
- Create: `packages/editor-kit/src/StageInspector.tsx`, `packages/editor-kit/src/StageWidgetList.tsx`, `packages/editor-kit/src/StagePalette.tsx`
- Modify: `packages/editor-kit/src/index.ts`

**Interfaces:**
- Consumes: `FontInput`, `ColorInput` (existing editor-kit files); `STAGE_WIDGET_LABELS` (Task 2).
- Produces:
  - `StagePalette({ onAdd(kind: StageWidgetKind): void })`
  - `StageWidgetList({ layout, selectedIds, onSelect, onReorder(id, to), onToggleHidden(id), onToggleLocked(id) })`
  - `StageInspector({ layout, selectedIds, onPatch(id, patch), onAlign(mode), onDistribute(axis), timerChoices: { id: string; label: string }[], channelChoices: { id: string; name: string }[] })`

- [ ] **Step 1: Implement (UI; typecheck + manual)**

**Palette:** one button per kind, in `STAGE_WIDGET_LABELS` order. Clicking adds the widget. It also supports HTML5 drag, with `dataTransfer` `"application/x-stage-widget"` = kind; the canvas host in Task 11 drops it at the pointer.

**Widget list:** top of the z-order is listed first. Each row has the name (`STAGE_WIDGET_LABELS[kind]`, plus `style.label` when set), eye and lock toggles, and up/down arrows. Clicking a row selects it; Shift-click adds to the selection.

**Inspector:**
- With 2 or more widgets selected, show only the align buttons (6), the distribute buttons (needs 3 or more) and a "Delete" hint.
- With 1 selected, show:
  - **Rect:** x, y, w, h number inputs; w/h are clamped to ≥ 20.
  - **Style:** `FontInput` (family), size, weight (100–900, step 100), `ColorInput` color, background (with a "none" option), padding, align / vAlign segmented buttons, autoFit checkbox, label text, and border (width, color, radius; width 0 removes the border).
  - **Props, per kind:**

| kind | controls |
|---|---|
| `currentSlide` | showReference |
| `nextSlide` | maxLines (1–10), dimOpacity (0–1 slider) |
| `rowTitle` | showNext; prefer (`rundown` / `pco`) |
| `rowCue` | includeNextRow |
| `clock` | format (12h / 24h), seconds |
| `timer` | source: select "First active", "Current item", then "Channel: …" for each of `channelChoices`, then "Timer: …" for each of `timerChoices`, mapped to `"firstActive"`, `"currentItem"`, `{ channel }`, `{ timerId }`. If the stored source isn't in the lists, show it as "(missing) …". Also warnBelowSec, warnColor, overColor, showLabel |
| `videoRemaining` | warnBelowSec |
| `sermonNotes` | highlightColor, dimPast, showCounter, anchor (0–1 slider) |
| `message` | flash |
| `serviceProgress` | showPosition, showEnd, showDelta |
| `text` | text (textarea) |

Use exhaustive `switch (w.kind)` with a `never` default, so a kind added later fails typecheck here.

Run: `pnpm --filter @overlaysys/editor-kit typecheck` → PASS.

- [ ] **Step 2: Commit**

```bash
git add packages/editor-kit/src
git commit -m "feat(editor-kit): stage inspector, widget list and palette"
```

---

### Task 11: Operator — the stage layout editor page

**Files:**
- Create: `apps/operator/src/app/design/stage/edit/page.tsx`
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 8, 9, 10; phase 6's `timers` in the store (for `timerChoices`); `useResolvedChannelConfigs` (for stage channels and `channelChoices`).
- Produces: store fields `stageLayouts: StageLayoutMeta[]` and `stageLayoutPreviews: { channel: string; layoutId: string }[]`, with setters. `useWs` handles `stage_layout_list` and `stage_layout_previews`. The editor listens for `stage_layout` itself, the way `design/edit/page.tsx` listens for `template`.

- [ ] **Step 1: Implement (UI; typecheck + build + manual)**

**Route and loading:** `/design/stage/edit?id=` (Suspense + `useSearchParams`, as in `design/edit/page.tsx`). On open, send `get_stage_layout`, and call `setDraft` when `stage_layout` arrives, unless the draft is dirty. A built-in opens read-only: the canvas and inspector are disabled, and the banner reads "Built-in layout — Duplicate to edit". The **Duplicate** button sends `duplicate_stage_layout`, then routes to the copy's id when its `stage_layout` arrives.

**Layout:** `PageChrome` with the title set to the name.
- Left column: `StagePalette` above `StageWidgetList`.
- Center: `StageCanvas`. The feed is `sampleStageFeed(sampleKind, draft, now)`, recomputed on a 250 ms tick, so clocks and timers tick in the designer.
- Right: `StageInspector`.
- A drop on the canvas host adds the widget, positioned with its rect centered at the drop point (converted with the canvas scale).

**Top bar:**
- Name input (commit on blur).
- Size select: the presets plus "Custom…", which reveals w/h inputs.
- Background `ColorInput`.
- Sample select (`STAGE_SAMPLE_LABELS`).
- Undo / Redo.
- **Preview on monitor**: a select of stage channels plus a toggle.
  - While it's on, send `stage_layout_preview { channel, layout: draft }` right away and after every draft change, throttled to at most one every 150 ms (trailing).
  - Toggling off, unmounting, or changing the channel sends `{ channel, layout: null }` for the old channel.
  - Show "Previewing on <name>" while `stageLayoutPreviews` has `{ channel, layoutId: draft.id }`.
- **Save**: sends `save_stage_layout`, and `markSaved()` on its ack. The server clears the preview; turn the toggle off locally to match.

**Keyboard** (ignored while an input has focus):
- Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo, Cmd/Ctrl+S save
- Delete/Backspace removes the selection
- Cmd/Ctrl+D duplicates the selection

**Leaving:** show the "unsaved" marker and a Revert button, as the template editor does, and add a `beforeunload` warning while the draft is dirty.

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm --filter @overlaysys/operator build` → PASS.

- [ ] **Step 2: Commit**

```bash
git add apps/operator/src/app/design/stage apps/operator/src/lib/store.ts apps/operator/src/lib/useWs.ts
git commit -m "feat(operator): stage layout designer with sample data and preview on monitor"
```

---

### Task 12: Operator — Stage layouts tab on `/design`, channel layout picker

**Files:**
- Modify: `apps/operator/src/app/design/page.tsx`, `apps/operator/src/app/settings/channels/page.tsx`

**Interfaces:**
- Consumes: the store's `stageLayouts` and the Task 5 messages.

- [ ] **Step 1: Implement (UI; typecheck + build + manual)**

**`/design`:**
- A two-button segmented control at the top, "Graphics" | "Stage layouts". The selection is stored in the query as `?tab=stage`. In the cloud build, the control is not rendered and only graphics shows.
- The stage tab renders a `ManagementList<StageLayoutMeta>`:
  - `createFn` sends `save_stage_layout` with a blank layout (`StageLayoutSchema.parse({ id, name, widgets: [] })`), then routes to `/design/stage/edit?id=`.
  - `rowSecondary` is `` `${size.w}×${size.h}${builtIn ? " · built-in" : ""}` ``.
  - `rowActions`: Duplicate.
  - `canDelete` is `!builtIn`, with `cannotDeleteReason` "Built-in layouts can't be deleted".
  - `deleteConfirmDetails` lists the stage channels whose `layoutId` is this layout, plus "They will fall back to Speaker."
  - On mount (and when the connection opens) send `list_stage_layouts`.

**Channel settings:** the layout `Select` lists `useStore((s) => s.stageLayouts)`, falling back to `BUILT_IN_STAGE_LAYOUTS.map(stageLayoutMeta)` until the list arrives. When the stored `layoutId` isn't in the list, show "<id> (missing — Speaker)". Add an "Edit" link next to it that opens `/design/stage/edit?id=<layoutId>`. On mount, send `list_stage_layouts`.

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm --filter @overlaysys/operator build` → PASS.

- [ ] **Step 2: Commit**

```bash
git add apps/operator/src/app/design/page.tsx apps/operator/src/app/settings/channels/page.tsx
git commit -m "feat(operator): Stage layouts list on Designs; channels pick stored layouts"
```

---

### Task 13: Full verification

- [ ] **Step 1: Automated**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all green. The only allowed failure is the pre-existing `server/src/pco/importPlan.test.ts` "persists a client-configured song draft instead of rebuilding it", if it hasn't been fixed yet.

- [ ] **Step 2: Manual checklist (desktop app, `pnpm desktop`)**

1. Designs → Stage layouts lists Speaker, Lyrics and Scripture as built-in. Built-ins have no Delete; Duplicate opens an editable copy.
2. In the copy: add every palette kind; drag, resize from all 8 handles and snap to center and neighbours (guides show; Alt disables). Check:
   - Shift-click multi-select, align ×6, distribute (3 or more).
   - Arrow nudge 1 px and Shift+arrow 10 px; locked widgets don't move.
   - Undo/redo across all of these.
3. Every sample in the switcher renders. Item countdown shows red `+1:23`, counting up. PCO Live shows the service progress text.
4. With a stage channel open, turn on Preview: edits appear on the monitor within about 150 ms. Then:
   - Toggling off reverts the monitor.
   - Quitting the operator window while previewing reverts the monitor.
   - Saving while previewing leaves the monitor on the saved layout, and the toggle turns off.
5. Settings → Channels: pick the new layout; the monitor switches without reopening. Then delete that layout: the monitor falls back to Speaker and the picker shows "(missing — Speaker)".
6. With cloud paired and no `stage_layouts` table yet: the sync log shows one `stageLayouts (list)` error, and templates and shows still sync.
7. The cloud build (`pnpm --filter @overlaysys/operator build:cloud`) shows no Stage layouts tab.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -am "fix(stage): phase 5 verification fixes"
```
