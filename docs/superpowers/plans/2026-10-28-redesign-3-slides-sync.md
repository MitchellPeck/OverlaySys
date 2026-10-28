# Redesign plan 3: Slides decks, PCO "Import as Slides", Convert to slide deck, and cloud sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global library of reusable slide decks with a `slides` rundown item that plays like scripture and songs. Planning Center items can be imported as slides with remembered mappings. A song can be converted to a deck. Decks, mappings, show sections and slides rows, and hotcard hotkeys all sync to the cloud.

**Architecture:** Core zod schemas (`deck.ts`, plus the `SlidesRow` member of the `RundownRow` union) and pure resolvers (`slides.ts`) define everything once. Server, operator and Companion all read those definitions. The server adds a deck registry stored at `data/decks/<id>.json` and a PCO mappings file at `data/pco/itemMappings.json`. It also adds a `slidesSession` live engine. That engine is linear like `scriptureSession`, but it renders like `songSession`: `update` when the template stays the same, `takeInternal` when it changes. The engine publishes a `slidesSession` summary on `ChannelState`. The operator gets a /slides library, a deck editor, and pure helpers that plans 2a and 2b mount into Live, the show editor and /pco. Sync adds two JSON-payload entities (`decks`, `pcoItemMappings`) on the `stage_layouts` pattern. It also adds two cloud columns, `shows.extra` and `hotcards.hotkey`, and skips any of them quietly while the apps-portal migration is still unapplied.

**Tech Stack:** TypeScript, zod, Vitest (node env, logic only), Fastify + ws server, Next.js operator (React, zustand store), Supabase JS (`@overlaysys/supabase`), Bitfocus Companion module.

**Spec:** `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md` (sections "Slides decks" and "Cloud sync"). Contracts: `docs/superpowers/plans/2026-10-28-redesign-contracts.md` §6 and §12 (owned here), §9 (the slides adapter and slide editor pieces, whose adapter bodies this plan fills in) and §14. Execution order, cross-plan dependencies, file ownership and the shared-file rule: `docs/superpowers/plans/2026-10-28-redesign-execution-order.md`. Design sketch, treated as a starting point only: session scratchpad `uxreview/enrichment/content.md` §2.

## Global Constraints

- Every schema change is additive. Existing shows, songs, templates, hotcards, stage layouts and settings open unchanged. `DeckSchema` and `SlidesRowSchema` use `.passthrough()`.
- Template precedence for a slide is fixed: `slide.templateId` → `row.templateId` → `deck.defaultTemplateId`.
- Decks are global (not project-scoped) and have tags (Q1). Rows reference decks (Q2). A deck is a flat ordered slide list, and a row's `slideIds` may subset, reorder and repeat (Q4).
- In the UI the library page is called **"Slides"** and its items are called **"decks"** (Q9).
- Live keys: Space advances, Shift+Space goes back, B blanks. On the last slide, Space stops and shows exactly **`End of deck · Space again to clear`**. A second Space clears (Q7).
- Only decks with `licensing.kind === "ccli"` write CCLI usage, and only on non-preview takes. Liturgy decks never do (anti-goal).
- PCO mapping keys: `pcoSong:<id>` takes precedence over `title:<normalised>`. Normalisation only ignores case, punctuation, diacritics and whitespace. Numbers are kept.
- Convert rewrites **upcoming** shows only. A show is upcoming when `resolveShowDate` ≥ today's local date or the show has no date. Convert keeps `sourceRef`, records the PCO mapping, soft-deletes the song with `customFields.converted_to_deck = <deckId>`, and offers Undo.
- Cloud migrations are written into `docs/` for the apps-portal project and **never applied** from this repo. The Supabase MCP reaches "Ovation OS", not OverlaySys, so don't use it for this. A missing cloud table or column is skipped quietly with one `console.info` per process. It is never counted as a sync error.
- Tests run in Vitest node env with no DOM. UI tasks are verified by `pnpm typecheck`, `pnpm --filter @overlaysys/operator build`, and a screenshot taken with `uxreview/lib.mjs` (`open`, `shot`) against operator http://localhost:3000.
- Never type real lyrics or liturgy text in code, tests or fixtures. Use placeholders such as `"Line A"` and `"Response 1"`.
- Use the contract names from `2026-10-28-redesign-contracts.md` exactly. Edits in other plans' files are additive, inside a marked block (`// [P3.n] …` … `// [/P3.n]`), in the merge order of the execution-order doc.
- Target: ready for Sunday 2026-11-01.

## Review Focus

1. **A row whose deck was deleted, or whose `slideIds` name slides since removed from the deck.** Live must say so and must never put a blank or wrong slide on air. Pinned by the `slidesRowView` missing-deck and missing-slide tests (Task 1) and the `slides_take refuses a missing deck` test (Task 9).
2. **Titles that differ only by a number** ("Psalm 23" vs "Psalm 100") must not share a remembered deck. Pinned by the `normalizePcoTitle keeps numbers` test (Task 2).
3. **Converting a song that is live on program, or Undo after a rewritten show was edited again.** The conversion must not change what is on air, and Undo must not clobber the later edit. Pinned by `convert leaves a live song session alone` and `undo skips a show edited after the conversion` (Task 12).
4. **A cloud that hasn't had the apps-portal migration applied.** A pull must not drop local `sections`, hotcard keys, decks or mappings. Pinned by the missing-column tests (Task 7) and the missing-table tests (Task 6).
5. **A remembered mapping that points at a deleted deck.** The PCO import must not pre-select it. It falls back to the normal default. Pinned by the `suggestDeck ignores a deleted deck` test (Task 2).

---

## File Structure

**Created (owned by this plan):**

| File | Responsibility |
|---|---|
| `packages/core/src/deck.ts` (+ `deck.test.ts`) | `DeckSchema`, `DeckSlideSchema`, `DeckLicensingSchema`, `DeckMeta`, `SlidesRowFields` type |
| `packages/core/src/slides.ts` (+ `slides.test.ts`) | Pure resolvers: `resolveSlideTemplateId`, `resolveSlidesRow`, `slidesRowView`, `slideTextLines`, `deckTextToSlides`, `SlidesSessionSummarySchema`, `SLIDES_END_OF_DECK` |
| `packages/core/src/slidesRowOps.ts` (+ test) | Pure row edits: subset/order/repeat, overrides, detach, save-to-library, `newSlidesRow` |
| `packages/core/src/slidesMapping.ts` (+ test) | `PcoItemMappingSchema`, `normalizePcoTitle`, `mappingKeysFor`, `findMapping`, `suggestDeck`, `buildSlidesRow`, `carryOverSlidesRow` |
| `packages/core/src/slidesConvert.ts` (+ test) | Pure `deckFromSong`, `songRowToSlidesRow`, `isUpcomingShow`, `convertedDeckId` |
| `server/src/decksStore.ts` (+ test) | `data/decks/<id>.json` file IO |
| `server/src/decks.ts` (+ test) | Deck registry: list/get/save/delete/restore/duplicate, metas with `usedBy` |
| `server/src/decksConvert.ts` (+ test) | `convertSongToDeck` / `undoConversion` transaction and in-memory undo snapshots |
| `server/src/slidesSession.ts` (+ test) | Live slides engine |
| `server/src/slidesHandlers.ts` (+ test) | WS handlers for `slides_*`, deck CRUD and convert (called from `ws.ts`) |
| `server/src/pco/itemMappings.ts` (+ test) | `data/pco/itemMappings.json` store |
| `server/src/pco/slidesImport.ts` (+ test) | Import-as-slides helpers used by `importPlan.ts` and `routes.ts` |
| `packages/supabase/src/optionalColumns.ts` (+ test) | `isMissingColumnError`, `isMissingTableError` |
| `apps/operator/src/lib/slidesLive.ts` (+ test) | `slidesKeyMessage`, `slidesThumbClickMessage`, `slidesRowTakeMessage` (used by the adapter bodies) |
| `apps/operator/src/lib/slidesRowView.ts` (+ test) | The slides adapter (contracts §9): created with stub bodies by P2a.2, owned here from Task 13, which replaces the bodies and keeps every signature |
| `apps/operator/src/app/shows/edit/forms/SlidesItemForm.tsx` | `SlidesItemForm` + `SlidesAddFlow` (contracts §9): created as placeholders by P2a.18, owned here from Task 16 |
| `apps/operator/src/app/slides/edit/DeckSlideFields.tsx` | The deck fields editor: P2a's `SlideTextEditor` over `slideFieldsFor(template)` plus `FieldInput` for image/colour/video fields |
| `apps/operator/src/app/slides/page.tsx` | /slides library (LibraryList) |
| `apps/operator/src/app/slides/NewDeckDialog.tsx`, `LicensingField.tsx` | Creation and licensing prompt |
| `apps/operator/src/app/slides/edit/page.tsx`, `DeckEditor.tsx` | Deck editor (deck mode) |
| `apps/operator/src/app/slides/useDeck.ts` | Fetch-on-demand deck hook |
| `apps/operator/src/app/slides/row/{DeckPicker,SlidesRowInspector,LocalSlidesEditor}.tsx` | Show-editor slot components |
| `apps/operator/src/app/slides/ConvertToDeckDialog.tsx` | Convert dialog |
| `apps/operator/src/app/pco/{ImportAsSlides.tsx, slidesImport.ts, slidesImport.test.ts}` | /pco "Slides" option (mounted in P2b.26's `importOptions.ts` and `PcoItemRow.tsx`) |
| `packages/companion-module/src/__tests__/slides.test.ts` | Companion slides actions |
| `docs/cloud-slides-sync-migration.md` | apps-portal migration (not applied) |

**Modified (owned):** `packages/core/src/{storageAdapter.ts, syncEngine.ts, syncEngine.test.ts, index.ts}`; `server/src/{fsStorageAdapter.ts, fsStorageAdapter.test.ts, cloudSync.ts}`; `packages/supabase/src/{cloudStorageAdapter.ts, cloudStorageAdapter.test.ts, database.types.ts}`; `apps/operator/src/lib/{cloudData.ts, store.ts, useWs.ts}`; `docs/cloud-sermon-notes-migration.md` (pointer to the new doc).

**Shared files, additive edits only, in marked blocks (shared-file rule and merge order: execution-order doc):**
- `packages/core/src/show.ts`: `SlidesRowSchema` in the union (Task 8). Plan 1 owns the file; this edit lands after P1.17.
- `packages/core/src/channel.ts`: `slidesSession?` on `ChannelState` (Task 5; no other plan edits it).
- `packages/ws-protocol/src/index.ts`: deck, slides and convert messages (Task 4, after P1.8's list-item fields).
- `server/src/ws.ts` (Task 4; no other plan edits it), `server/src/channels.ts` (Task 5, before P2b.11's draft guard), `server/src/stageFeed.ts`, `server/src/stageFeedHub.ts` (Tasks 8, 10).
- `server/src/index.ts`: `await reloadDecks(); await reloadItemMappings();` after `await reloadShows();` (Task 3; after P1.20 and P2b.12's lines).
- `server/src/pco/{importPlan.ts, routes.ts}`: owner plan 2b; merge order P1.19 → P2b.27 → Task 11.
- `apps/operator/src/lib/store.ts`: decks state (Task 13, after P1.8's `ShowMeta` fields).
- Placeholder `case "slides"` lines in `packages/core/src/bundle.ts`, `apps/operator/src/lib/{onAir.ts, rowAirState.ts, stageMode.ts}` and `apps/operator/src/app/components/StageArea.tsx` (Task 8; lands **before** P2a.2/P2a.13 rewrite those files).
- Mount points: `apps/operator/src/app/songs/page.tsx` (P1.13's list menu) and `apps/operator/src/app/songs/edit/page.tsx` (P2a.20's ⋯ menu and not-found block) in Task 20; `apps/operator/src/app/pco/{importOptions.ts, PcoItemRow.tsx}` (P2b.26) in Task 19; Companion `actions.ts` / `presets.ts` / `feedbacks.ts` / `variables.ts` (P2b.30–32) in Task 21. Live, the rundown and the show editor are reached only through the adapter files above, so this plan makes no edits in P2a's Live or show-editor components, and none in `shell/areas.ts` (P2b.22 adds the Slides nav entry).

---

## Dependencies and parallel groups

| Group | Tasks | Starts when |
|---|---|---|
| A | 1, 2, 7 | now (Task 7's sections assertion waits for **P1.17**, `.passthrough()` on Show/rows) |
| A2 | 3, 4, 5 | Task 1 (Task 3 also needs Task 2; Task 4 merges after P1.8 in `ws-protocol`) |
| B | 8 | **P1.17** + Task 1. Lands before P2a.2 and P2a.13, which rewrite the four operator files it touches. |
| B2 | 6, 9, 10, 11, 12, 13 | 6: Tasks 3 + 2 · 9: 4, 5, 8 · 10: 5, 8 · 11: 2, 3, 8 + **P1.19** and **P2b.27** (EXTRA-2) merged first (all three edit `importPlan.ts`) · 12: 3, 4, 8 · 13: 4, 8 + **P2a.2** (adapter stub exists) + P1.8 (`store.ts`) |
| C (UI) | 14, 15, 16, 18, 19, 20, 21 | 14: 13 + **P1.5, P1.8, P1.9, P1.10** + **P2b.22** (nav entry) · 15: 14 + **P2a.19** (slide editor pieces) + P1.6, P1.7 · 16: 13 + **P2a.17, P2a.18** (show editor + `SlidesItemForm` placeholder) · 18: 13 + **P2a.13, P2a.16** (Live assembled) · 19: 11, 14 + **P2b.26** (/pco rebuild) · 20: 12, 14 + **P1.13** (songs list) + **P2a.20** (song editor) · 21: 4, 5 + **P2b.32** (Companion) |
| C2 | 17 | 16 |

The core schema (1, 2), server storage (3) and live engine (5) have no dependency on plans 1, 2a or 2b and start immediately. P2a.2 waits for Tasks 1 and 8 (its adapter stub imports the core slides types).

---

### Task 1: Deck schema and pure slide resolvers

**Files:**
- Create: `packages/core/src/deck.ts`, `packages/core/src/deck.test.ts`, `packages/core/src/slides.ts`, `packages/core/src/slides.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./deck"; export * from "./slides";`)

**Interfaces:**
- Consumes: `Template`, `TemplateMeta` from `./template` (the field list is `template.fields`, and each field has `key`, `type` and `label`).
- Produces:
  ```ts
  // deck.ts
  DeckLicensingSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ccli"), ccliNumber: z.string().optional() }),
    z.object({ kind: z.literal("public-domain") }),
    z.object({ kind: z.literal("own") }),
  ]);  type DeckLicensing
  DeckSlideSchema = z.object({ id: z.string(), templateId: z.string().optional(),
    data: z.record(z.string(), z.string()), label: z.string().optional() }).passthrough();  type DeckSlide
  DeckSchema = z.object({ id, name, tags: z.array(z.string()).default([]), defaultTemplateId: z.string(),
    licensing: DeckLicensingSchema, slides: z.array(DeckSlideSchema), createdAt: z.string(),
    updatedAt: z.string().optional(), deletedAt: z.string().optional(),
    convertedFromSongId: z.string().optional() }).passthrough();  type Deck
  type DeckMeta = { id: string; name: string; tags: string[]; slideCount: number;
    licensing: DeckLicensing["kind"]; usedBy: number; createdAt: string; updatedAt?: string }
  interface SlidesRowFields { kind: "slides"; id: string; deckId?: string; slideIds?: string[];
    templateId?: string; fieldOverrides?: Record<string, Record<string, string>>;
    localSlides?: DeckSlide[]; channelHint?: string; notes?: string; sermonNotesId?: string;
    lengthSec?: number; lengthSecManual?: boolean; sectionId?: string; stageLayouts?: Record<string, string>; sourceRef?: { provider: "pco";
    serviceTypeId: string; planId: string; itemId: string } }
  // slides.ts
  type ResolvedSlide = { key: string; slideId: string; position: number; templateId: string;
    data: Record<string, string>; label?: string }
  type SlidesRowView = { title: string; detail: string; slides: ResolvedSlide[];
    missingDeck: boolean; missingSlides: number; licensing: DeckLicensing["kind"] | null }
  resolveSlideTemplateId(slide: DeckSlide, row: Pick<SlidesRowFields,"templateId">, deck: Pick<Deck,"defaultTemplateId"> | null): string   // "" when nothing resolves
  resolveSlidesRow(row: SlidesRowFields, deck: Deck | null): { slides: ResolvedSlide[]; missingSlides: number }
  slidesRowView(row: SlidesRowFields, deck: Deck | null | undefined): SlidesRowView
    // null → missing deck; undefined with a deckId → { title: "Slides deck", detail: "Loading…", slides: [], missingDeck: false, missingSlides: 0, licensing: null }
  slideTextLines(data: Record<string, string>, template?: Pick<Template, "fields">): string[]
  deckTextToSlides(text: string, fieldKey: string, newId: () => string): DeckSlide[]
  SlidesSessionSummarySchema = z.object({ rowId: z.string(), deckId: z.string().optional(), title: z.string(),
    slideIdx: z.number().int().nonnegative(), slideCount: z.number().int().positive(),
    label: z.string().optional(), lines: z.array(z.string()), nextLines: z.array(z.string()).optional(),
    nextLabel: z.string().optional(), blanked: z.boolean(), atEnd: z.boolean() });  type SlidesSessionSummary
  SLIDES_END_OF_DECK = "End of deck · Space again to clear"
  ```

- [ ] **Step 1: Write the failing tests**

`deck.test.ts`:
```ts
it("parses a minimal deck and keeps unknown keys", () => {
  const d = DeckSchema.parse({ id: "d1", name: "Response", defaultTemplateId: "lyric",
    licensing: { kind: "public-domain" }, slides: [{ id: "s1", data: { text: "Line A" } }],
    createdAt: "2026-10-28T00:00:00.000Z", futureField: 1 });
  expect(d.tags).toEqual([]);
  expect((d as Record<string, unknown>).futureField).toBe(1);
});
it("rejects an unknown licensing kind", () => {
  expect(DeckLicensingSchema.safeParse({ kind: "other" }).success).toBe(false);
});
```
`slides.test.ts`:
```ts
const deck = { id: "d", name: "Gloria", defaultTemplateId: "deckT", tags: [], licensing: { kind: "own" },
  createdAt: "x", slides: [
    { id: "a", data: { text: "Line A" }, label: "Response 1" },
    { id: "b", templateId: "slideT", data: { text: "Line B" } },
    { id: "c", data: { text: "Line C" } } ] } as Deck;
const row = (p: Partial<SlidesRowFields> = {}): SlidesRowFields => ({ kind: "slides", id: "r", deckId: "d", ...p });

it("template precedence: slide → row → deck", () => {
  const out = resolveSlidesRow(row({ templateId: "rowT" }), deck).slides.map((s) => s.templateId);
  expect(out).toEqual(["rowT", "slideT", "rowT"]);
  expect(resolveSlidesRow(row(), deck).slides.map((s) => s.templateId)).toEqual(["deckT", "slideT", "deckT"]);
});
it("slideIds subset, reorder and repeat; keys are unique per position", () => {
  const s = resolveSlidesRow(row({ slideIds: ["c", "a", "a"] }), deck).slides;
  expect(s.map((x) => x.slideId)).toEqual(["c", "a", "a"]);
  expect(new Set(s.map((x) => x.key)).size).toBe(3);
  expect(s.map((x) => x.position)).toEqual([0, 1, 2]);
});
it("field overrides merge over slide data, per slide id", () => {
  const s = resolveSlidesRow(row({ fieldOverrides: { a: { text: "Line A2", choir: "X" } } }), deck).slides;
  expect(s[0]!.data).toEqual({ text: "Line A2", choir: "X" });
  expect(s[1]!.data).toEqual({ text: "Line B" });
});
it("missing slide ids are skipped and counted", () => {
  const r = resolveSlidesRow(row({ slideIds: ["a", "gone", "b"] }), deck);
  expect(r.slides.map((x) => x.slideId)).toEqual(["a", "b"]);
  expect(r.missingSlides).toBe(1);
});
it("view: title, detail and missing deck", () => {
  expect(slidesRowView(row(), deck)).toMatchObject({ title: "Gloria", detail: "3 slides", missingDeck: false, licensing: "own" });
  expect(slidesRowView(row({ slideIds: ["a"] }), deck).detail).toBe("1 of 3 slides");
  expect(slidesRowView(row(), null)).toMatchObject({ title: "Missing deck", detail: "Deck deleted or not synced", slides: [], missingDeck: true });
  expect(slidesRowView(row(), undefined)).toMatchObject({ title: "Slides deck", detail: "Loading…", slides: [], missingDeck: false });
  expect(slidesRowView(row({ deckId: undefined, localSlides: [{ id: "l", data: { text: "Line L" } }], templateId: "rowT" }), null))
    .toMatchObject({ title: "One-off slides", detail: "1 slide", missingDeck: false, licensing: null });
});
it("slideTextLines follows template text-field order, else non-empty values", () => {
  const tpl = { fields: [{ key: "people", type: "text", label: "P" }, { key: "leader", type: "text", label: "L" }] };
  expect(slideTextLines({ leader: "Line A", people: "Line B" }, tpl as never)).toEqual(["Line B", "Line A"]);
  expect(slideTextLines({ text: "Line A\nLine B", empty: "" })).toEqual(["Line A", "Line B"]);
});
it("deckTextToSlides splits on blank lines and trims", () => {
  let n = 0; const id = () => `s${++n}`;
  expect(deckTextToSlides("Line A\nLine B\n\n\nLine C\n", "text", id))
    .toEqual([{ id: "s1", data: { text: "Line A\nLine B" } }, { id: "s2", data: { text: "Line C" } }]);
  expect(deckTextToSlides("   \n", "text", id)).toEqual([]);
});
```

- [ ] **Step 2: Run them and confirm they fail**
Run: `pnpm vitest run packages/core/src/deck.test.ts packages/core/src/slides.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `deck.ts` and `slides.ts` with the signatures above**
`slideTextLines`: for each template field with `type === "text"` (the same filter as `textFieldLines` in `server/src/stageFeed.ts`), in field order, split the value on `\n` and drop empty lines. With no template, use `Object.values(data)` in insertion order. A local-slides row has no deck, so its templates resolve slide → row only. The view's `detail` is `"1 slide"` / `"n slides"`, or `"n of m slides"` when `slideIds` is set and the deck exists. Rows with neither a deck nor `localSlides` are `missingDeck: true`.

- [ ] **Step 4: Run them and confirm they pass**
Run: the same command. Expected: PASS. Also `pnpm --filter @overlaysys/core typecheck` exits 0.

This task unblocks P2a.2 (the operator adapter stub imports `Deck`, `SlidesRowView`, `ResolvedSlide`), so merge it early.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/deck.ts packages/core/src/deck.test.ts packages/core/src/slides.ts packages/core/src/slides.test.ts packages/core/src/index.ts
git commit -m "feat(core): deck schema and pure slides resolvers"
```

---

### Task 2: PCO item mappings and deck suggestion (core)

**Files:**
- Create: `packages/core/src/slidesMapping.ts`, `packages/core/src/slidesMapping.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces:**
- Consumes: `Deck`, `SlidesRowFields`, `DeckSlide` (Task 1); `PcoPlanItem` (`./pco/pcoTypes`; `item.song?.id` is the PCO song id); `RowSourceRef` (`./show`, a type-only import, so no cycle).
- Produces:
  ```ts
  PcoItemMappingSchema = z.object({ id: z.string() /* = key */, key: z.string(),
    kind: z.literal("slides"), deckId: z.string(), templateId: z.string().optional(),
    updatedAt: z.string(), deletedAt: z.string().optional() }).passthrough();  type PcoItemMapping
  normalizePcoTitle(title: string): string
  mappingKeysFor(item: Pick<PcoPlanItem, "title" | "song">): { songKey: string | null; titleKey: string }
  findMapping(item, mappings: PcoItemMapping[]): PcoItemMapping | null   // live mappings only; songKey wins
  type DeckSuggestion = { deckId: string; deckName: string; via: "remembered" | "name"; mappingId?: string; templateId?: string }
  suggestDeck(item, mappings: PcoItemMapping[], decks: Pick<Deck,"id"|"name"|"deletedAt">[]): DeckSuggestion | null
  buildSlidesRow(opts: { id: string; deckId: string; templateId?: string; sourceRef: RowSourceRef; lengthSec?: number }): SlidesRowFields
  carryOverSlidesRow(old: SlidesRowFields, next: SlidesRowFields): SlidesRowFields
  ```

- [ ] **Step 1: Write the failing tests**
```ts
it("normalizePcoTitle folds case, punctuation, quotes, dashes, diacritics and spaces", () => {
  expect(normalizePcoTitle("  Gloria  Patri! ")).toBe("gloria patri");
  expect(normalizePcoTitle("GLORIA – PATRI")).toBe("gloria patri");
  expect(normalizePcoTitle("“Doxology”")).toBe("doxology");
  expect(normalizePcoTitle("Créed")).toBe("creed");
});
it("normalizePcoTitle keeps numbers", () => {
  expect(normalizePcoTitle("Psalm 23")).not.toBe(normalizePcoTitle("Psalm 100"));
});
it("mappingKeysFor gives a song key only for linked songs", () => {
  expect(mappingKeysFor({ title: "Gloria Patri", song: { id: "123" } as never }))
    .toEqual({ songKey: "pcoSong:123", titleKey: "title:gloria patri" });
  expect(mappingKeysFor({ title: "Welcome" } as never).songKey).toBeNull();
});
it("findMapping: the song key beats the title key; tombstones ignored", () => {
  const m = (key: string, deckId: string, deletedAt?: string) => ({ id: key, key, kind: "slides" as const, deckId, updatedAt: "t", ...(deletedAt ? { deletedAt } : {}) });
  const item = { title: "Gloria Patri (retitled)", song: { id: "123" } } as never;
  expect(findMapping(item, [m("title:gloria patri retitled", "T"), m("pcoSong:123", "S")])!.deckId).toBe("S");
  expect(findMapping(item, [m("pcoSong:123", "S", "2026-10-01")])).toBeNull();
});
it("suggestDeck: remembered, then exact name, else null", () => {
  const decks = [{ id: "d1", name: "Gloria Patri" }, { id: "d2", name: "Doxology" }];
  expect(suggestDeck({ title: "gloria patri" } as never, [], decks)).toMatchObject({ deckId: "d1", via: "name" });
  expect(suggestDeck({ title: "Opening" } as never, [], decks)).toBeNull();
});
it("suggestDeck ignores a deleted deck", () => {
  const mapping = { id: "title:gloria patri", key: "title:gloria patri", kind: "slides" as const, deckId: "d1", updatedAt: "t" };
  expect(suggestDeck({ title: "Gloria Patri" } as never, [mapping], [{ id: "d1", name: "Gloria Patri", deletedAt: "x" }])).toBeNull();
});
it("carryOverSlidesRow keeps the operator's subset and overrides for the same deck only", () => {
  const old = { kind: "slides", id: "r", deckId: "d", slideIds: ["a"], fieldOverrides: { a: { t: "X" } }, templateId: "T", sermonNotesId: "n" } as SlidesRowFields;
  expect(carryOverSlidesRow(old, { kind: "slides", id: "r", deckId: "d" })).toMatchObject({ slideIds: ["a"], fieldOverrides: { a: { t: "X" } }, templateId: "T" });
  expect(carryOverSlidesRow(old, { kind: "slides", id: "r", deckId: "other" }).slideIds).toBeUndefined();
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/core/src/slidesMapping.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `slidesMapping.ts`**
`normalizePcoTitle`: NFKD, then strip combining marks (`\p{M}`), lowercase, replace every run of non-`[\p{L}\p{N}]` with a space, trim. `carryOverSlidesRow` copies only the slides-specific fields: `slideIds`, `fieldOverrides`, and `templateId` when `next.templateId` is unset, and only when `old.deckId === next.deckId`. The generic carry-over (notes link, manual length, `sectionId`) stays in `importPlan.carryOver`.

- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**: `git add packages/core/src/slidesMapping* packages/core/src/index.ts && git commit -m "feat(core): PCO item→deck mappings and deck suggestion"`

---

### Task 3: Server storage for decks and PCO mappings

**Files:**
- Create: `server/src/decksStore.ts`, `server/src/decks.ts`, `server/src/decks.test.ts`, `server/src/pco/itemMappings.ts`, `server/src/pco/itemMappings.test.ts`
- Modify (shared, marked block): `server/src/index.ts` — `await reloadDecks(); await reloadItemMappings();` right after `await reloadShows();` so the registries are loaded before the first client connects (merge after P1.20's migration line and P2b.12's route line)

**Interfaces:**
- Consumes: `DeckSchema`, `Deck`, `DeckMeta` (Task 1); `PcoItemMappingSchema` (Task 2); `dataRoot` from `./storage`; `isLive`, `liveOnly`, `stampWrite`, `tombstone` from `./lifecycle`; `listShowMetas`, `getShow` from `./shows`.
- Produces:
  ```ts
  // decksStore.ts — data/decks/<id>.json, includes tombstones
  loadAllDecks(): Promise<Deck[]>; loadDeck(id): Promise<Deck | null>; writeDeck(d: Deck): Promise<void>
  // decks.ts — registry (mirrors songs.ts)
  reloadDecks(): Promise<void>; listDeckMetas(): Promise<DeckMeta[]>; listDecks(): Promise<Deck[]> /* live */
  getDeck(id): Promise<Deck | null>; saveDeck(d: Deck): Promise<Deck>; deleteDeck(id): Promise<boolean>
  restoreDeck(id): Promise<Deck | null>; duplicateDeck(id, newId?: string): Promise<Deck | null>
  deckRegistrySnapshot(): Map<string, Deck>   // live decks, synchronous, for stageFeed
  // pco/itemMappings.ts — data/pco/itemMappings.json (array), includes tombstones
  reloadItemMappings(): Promise<void>; listItemMappings(opts?: { includeDeleted?: boolean }): Promise<PcoItemMapping[]>
  upsertItemMapping(m: Omit<PcoItemMapping, "id" | "updatedAt"> & { updatedAt?: string }): Promise<PcoItemMapping>
  putItemMapping(m: PcoItemMapping): Promise<void>   // sync path: stores as-is
  deleteItemMapping(id: string): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing tests** (set `OVERLAYSYS_DATA_DIR` to a tmp dir per test, as in `fsStorageAdapter.test.ts`)
```ts
it("saveDeck stamps updatedAt, defaults createdAt, round-trips through disk", async () => {
  const saved = await decks.saveDeck(deckFixture({ createdAt: undefined as never }));
  expect(saved.updatedAt).toBeTruthy(); expect(saved.createdAt).toBeTruthy();
  await decks.reloadDecks();
  expect((await decks.getDeck(saved.id))!.name).toBe(saved.name);
});
it("delete tombstones; list hides it; restore brings it back", async () => {
  await decks.saveDeck(deckFixture({ id: "d1" }));
  expect(await decks.deleteDeck("d1")).toBe(true);
  expect(await decks.getDeck("d1")).toBeNull();
  expect((await decksStore.loadDeck("d1"))!.deletedAt).toBeTruthy();
  expect((await decks.restoreDeck("d1"))!.deletedAt).toBeUndefined();
});
it("duplicateDeck names the copy '<name> copy' with fresh slide ids", async () => {
  await decks.saveDeck(deckFixture({ id: "d1", name: "Doxology" }));
  const copy = (await decks.duplicateDeck("d1"))!;
  expect(copy.name).toBe("Doxology copy"); expect(copy.id).not.toBe("d1");
});
it("listDeckMetas counts live shows that use the deck", async () => {
  // seed one live show with two slides rows on d1 and one deleted show using d1
  expect((await decks.listDeckMetas()).find((m) => m.id === "d1")!.usedBy).toBe(1);
});
it("item mappings: upsert by key, tombstone on delete, list hides tombstones", async () => {
  const m = await upsertItemMapping({ key: "title:gloria patri", kind: "slides", deckId: "d1" });
  expect(m.id).toBe("title:gloria patri");
  await upsertItemMapping({ key: "title:gloria patri", kind: "slides", deckId: "d2" });
  expect((await listItemMappings()).map((x) => x.deckId)).toEqual(["d2"]);
  await deleteItemMapping(m.id);
  expect(await listItemMappings()).toEqual([]);
  expect((await listItemMappings({ includeDeleted: true }))[0]!.deletedAt).toBeTruthy();
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run server/src/decks.test.ts server/src/pco/itemMappings.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the stores and the registry, and the two `index.ts` lines.** `createdAt` is stamped only for a new id (contracts §11 rule). Writes are atomic: write `<file>.tmp`, then rename. `usedBy` counts live shows (not rows) with any `slides` row whose `deckId` matches. Until Task 8 lands, use a structural `(r as { kind: string; deckId?: string })` check. Task 8 replaces it with the typed union. Upserting a mapping clears any `deletedAt`.

- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(server): deck registry and PCO item-mapping store"`

---

### Task 4: Wire protocol for decks, slides and convert, plus deck CRUD handlers

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`; `server/src/ws.ts` (delegate the new message types to `handleSlidesMessage`)
- Create: `packages/ws-protocol/src/slidesMessages.test.ts`, `server/src/slidesHandlers.ts`, `server/src/slidesHandlers.test.ts`

**Interfaces:**
- Consumes: `DeckSchema` (Task 1); the registry (Task 3); `broadcast`, `scheduleSync` (existing in `ws.ts`); `stageFeedHub.invalidateAll()`.
- Produces (exact message shapes):
  ```ts
  // client → server
  { type: "list_decks" } | { type: "get_deck"; deckId } | { type: "save_deck"; deck: Deck }
  | { type: "delete_deck"; deckId } | { type: "restore_deck"; deckId } | { type: "duplicate_deck"; deckId }
  | { type: "slides_take"; showId; rowId; slideIdx?: number /* int ≥0, default 0 */; channel?: string }
  | { type: "slides_advance"; channel; delta: -1 | 1 } | { type: "slides_goto"; channel; slideIdx: number }
  | { type: "slides_blank"; channel } | { type: "slides_end"; channel }
  | { type: "convert_song_to_deck"; songId; titleSlide: boolean; licensing?: DeckLicensing }
  | { type: "undo_convert_song"; conversionId }
  // server → client
  { type: "deck_list"; decks: DeckMeta[] } | { type: "deck"; deck: Deck }
  | { type: "song_converted"; conversionId; deckId; deckName; rows: number; shows: number; warnings: string[] }
  | { type: "song_convert_undone"; conversionId; songId; restoredShows: number; skippedShows: number }
  ```
  `type SlidesMessage = Extract<ClientMessage, { type: "list_decks" | … | "undo_convert_song" }>`
  `handleSlidesMessage(msg: SlidesMessage, send: Send): Promise<void>`. In this task it handles the deck CRUD types. Tasks 9 and 12 fill in `slides_*` and the convert types.

- [ ] **Step 1: Write the failing tests**
`slidesMessages.test.ts`: every shape above decodes through `ClientMessageSchema` / `ServerMessageSchema`. `slides_advance` with `delta: 2` and `slides_goto` with `slideIdx: -1` are rejected. `slides_take` without `slideIdx` decodes with `slideIdx` undefined.
`slidesHandlers.test.ts` (mock `./broadcast` and `./cloudSync`):
```ts
it("save_deck acks, broadcasts deck + deck_list and schedules sync", async () => { … expect(sent).toContainEqual({ type: "ack", op: "save_deck", id: "d1" });
  expect(broadcasts.map((m) => m.type)).toEqual(["deck", "deck_list"]); expect(scheduleSync).toHaveBeenCalled(); });
it("get_deck on a missing id sends not_found", …);
it("delete_deck then restore_deck round-trips and re-broadcasts deck_list", …);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/ws-protocol/src/slidesMessages.test.ts server/src/slidesHandlers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Add the schemas next to the scripture block in `ws-protocol/src/index.ts` (additive members of the two unions). In `ws.ts`, add one `case` group that falls through to `await handleSlidesMessage(parsed, send)`. Deck CRUD follows the `save_song` / `delete_song` broadcast pattern. A `save_deck` whose `slides` contain duplicate ids is rejected with `{ type: "error", code: "invalid", message: "Duplicate slide id" }`.

- [ ] **Step 4: Run them and confirm they pass.** Run: the same command plus `pnpm --filter @overlaysys/server typecheck`. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**: `git commit -m "feat(protocol,server): deck, slides and convert messages; deck CRUD handlers"`

---

### Task 5: Live slides engine

**Files:**
- Create: `server/src/slidesSession.ts`, `server/src/slidesSession.test.ts`
- Modify: `packages/core/src/channel.ts` (`slidesSession: SlidesSessionSummarySchema.optional()` on `ChannelStateSchema`); `server/src/channels.ts` (additive hooks, listed below)

**Interfaces:**
- Consumes: `ResolvedSlide`, `SlidesSessionSummary`, `slideTextLines`, `DeckLicensing` (Task 1); `channels.takeInternal`, `channels.update`, `channels.clear`, `channels.clearInternal`, `channels.setLiveRow`, `channels.getState`; `recordSongUse` from `./songUsage`.
- Produces:
  ```ts
  type StartArgs = { showId: string; rowId: string; deckId?: string; title: string; slides: ResolvedSlide[];
    licensing: DeckLicensing | null; templates: Map<string, Template> }
  start(ch: string, args: StartArgs, slideIdx = 0): boolean     // false: empty deck / bad index
  advance(ch: string, delta: -1 | 1): void
  goTo(ch: string, slideIdx: number): boolean
  blank(ch: string): void      // toggles
  end(ch: string): void
  promote(from: string, to: string): boolean   // PVW→PGM carry
  getSession(ch: string): SlidesSessionSummary | null
  dropAll(ch: string): boolean // used by channels.take/clear (external)
  resetAll(): void
  // channels.ts
  setSlidesSessionSummary(ch: string, s: SlidesSessionSummary | null, opts?: { deferEmit?: boolean }): void
  ```
- Edits to `channels.ts` (shared file; each in a `// [P3.5] slides session` block; P2b.11's draft guard lands after this and sits before these blocks):
  - In `take()` inside `if (!takeIsInternal)`, add `if (slidesSession.dropAll(channel)) delete s.slidesSession;`.
  - In `clear()` for an external clear, call `slidesSession.dropAll` and delete the summary.
  - In `takePvwToPgm()`, when `getState(from).slidesSession` is set, `return void slidesSession.promote(from, to)`. This happens before the generic promotion, so ⌘Enter and Companion's `take_pvw_to_pgm` both carry the session.

- [ ] **Step 1: Write the failing tests.** Follow `scriptureSession.test.ts` and use real `channels`. Mock `./songUsage` with `recordSongUse: vi.fn(async () => false)`.
```ts
const slides = [rs(0, "a", "T1", "Line A"), rs(1, "b", "T1", "Line B"), rs(2, "c", "T2", "Line C")];
it("start renders slide 0, sets summary, liveRow and next", () => {
  expect(slidesSession.start("program", args(), 0)).toBe(true);
  const st = channels.getState("program");
  expect(st.active).toMatchObject({ templateId: "T1", data: { text: "Line A" } });
  expect(st.slidesSession).toMatchObject({ rowId: "row", slideIdx: 0, slideCount: 3, lines: ["Line A"], nextLines: ["Line B"], atEnd: false, blanked: false });
  expect(st.liveRow).toEqual({ showId: "show", rowId: "row" });
});
it("same template advances with update (no remount); a template change remounts", () => {
  slidesSession.start("program", args()); const t0 = channels.getState("program").active!.takenAt;
  slidesSession.advance("program", 1);
  expect(channels.getState("program").active!.takenAt).toBe(t0);          // update()
  slidesSession.advance("program", 1);
  expect(channels.getState("program").active!.templateId).toBe("T2");     // takeInternal()
});
it("Space on the last slide arms end-of-deck, a second Space clears", () => {
  slidesSession.start("program", args(), 2);
  slidesSession.advance("program", 1);
  expect(channels.getState("program").slidesSession!.atEnd).toBe(true);
  expect(channels.getState("program").active!.data.text).toBe("Line C");
  slidesSession.advance("program", 1);
  expect(channels.getState("program").slidesSession).toBeUndefined();
  expect(channels.getState("program").active?.phase).toBe("out");
});
it("Shift+Space from the armed end disarms and steps back", () => { … atEnd false, slideIdx 1 });
it("Shift+Space on slide 0 does nothing", …);
it("blank toggles: out animation, session kept; again re-shows the same slide", …);
it("advance while blanked unblanks onto the next slide", …);
it("an external take ends the slides session", () => { slidesSession.start("program", args()); channels.take("program", "other", {});
  expect(slidesSession.getSession("program")).toBeNull(); expect(channels.getState("program").slidesSession).toBeUndefined(); });
it("PVW→PGM carries the cursor and ends the preview session", () => {
  slidesSession.start("preview", args(), 1); channels.takePvwToPgm("preview", "program");
  expect(channels.getState("program").slidesSession!.slideIdx).toBe(1);
  expect(slidesSession.getSession("preview")).toBeNull();
});
it("CCLI usage only for ccli decks and never on preview", () => {
  slidesSession.start("program", args({ licensing: { kind: "public-domain" } })); expect(recordSongUse).not.toHaveBeenCalled();
  slidesSession.start("preview", args({ licensing: { kind: "ccli", ccliNumber: "1" } })); expect(recordSongUse).not.toHaveBeenCalled();
  slidesSession.start("program", args({ licensing: { kind: "ccli", ccliNumber: "1" } }));
  expect(recordSongUse).toHaveBeenCalledWith({ id: "deck", title: "Deck", ccliNumber: "1" }, "program");
});
it("start on an empty slide list returns false and leaves the channel alone", …);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run server/src/slidesSession.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `slidesSession.ts` and the `channels.ts` hooks.**
- Render rule (copied from `songSession.render`): if the active mount's `templateId` equals the slide's and its `phase === "in"` and the session wasn't blanked, call `channels.update(ch, data)`. Otherwise call `channels.takeInternal(ch, templateId, data)`. `start` and `promote` always remount.
- Blank uses `channels.clearInternal`.
- `end` deletes the map entry, calls `setSlidesSessionSummary(ch, null, { deferEmit: true })`, then `channels.clear(ch)`.
- The usage log is written by `start` and by `promote` onto a non-preview channel. It uses `{ id: deckId ?? rowId, title, ccliNumber }`.
- `advance(+1)` from `idx < last` moves to `idx + 1` and clears `atEnd`. At `last` with `!atEnd` it sets `atEnd` and emits the summary only. At `last` with `atEnd` it calls `end`. `advance(-1)` moves to `max(0, idx - 1)` and clears `atEnd`.
- `nextLines` is set while `idx < last`. Lines come from `slideTextLines(data, templates.get(templateId))`.

- [ ] **Step 4: Run them and confirm they pass.** Run: `pnpm vitest run server/src/slidesSession.test.ts server/src/channels.test.ts server/src/scriptureSession.test.ts server/src/songSession.test.ts`. Expected: PASS, with no regression in the existing channel and session tests.

- [ ] **Step 5: Commit**: `git commit -m "feat(server): slides live engine with end-of-deck, blank and PVW→PGM carry"`

---

### Task 6: Sync entities for decks and PCO mappings

**Files:**
- Modify: `packages/core/src/storageAdapter.ts`, `packages/core/src/syncEngine.ts`, `packages/core/src/syncEngine.test.ts`, `server/src/fsStorageAdapter.ts`, `server/src/fsStorageAdapter.test.ts`, `server/src/cloudSync.ts`, `packages/supabase/src/cloudStorageAdapter.ts`, `packages/supabase/src/cloudStorageAdapter.test.ts`, `packages/supabase/src/database.types.ts`
- Create: `docs/cloud-slides-sync-migration.md` (the decks and mappings part; Task 7 adds the column part)

**Interfaces:**
- Consumes: `Deck`, `DeckSchema` (Task 1); `PcoItemMapping`, `PcoItemMappingSchema` (Task 2); `decksStore` / `decks.reloadDecks` / `listDeckMetas`, and `itemMappings.putItemMapping` / `listItemMappings` / `reloadItemMappings` (Task 3).
- Produces:
  - `StorageAdapter` additions: `listDecks(orgId)`, `listDecksSince(orgId, wm)`, `getDeck(orgId, id)`, `saveDeck(orgId, d)`, `deleteDeck(orgId, id)`, `listPcoItemMappings(orgId)`, `listPcoItemMappingsSince(orgId, wm)`, `savePcoItemMapping(orgId, m)`, `deletePcoItemMapping(orgId, id)`.
  - `SyncCursor` and `EMPTY_SYNC_CURSOR` gain `decks` and `pcoItemMappings`. `PendingWriteKind` gains `"deck" | "pcoItemMapping"`.
  - `SyncEntityKind` gains `"decks" | "pcoItemMappings"`. Both go in `OPTIONAL_TABLES`.
  - Cloud tables: `overlaysys.decks` and `overlaysys.pco_item_mappings`, both JSON-payload (`id`, `org_id`, `payload`, `updated_at`, `deleted_at`).

- [ ] **Step 1: Write the failing tests**
`syncEngine.test.ts` (extend `makeMemAdapter` with `decks` and `mappings` maps):
```ts
it("decks: remote-only pulls, newer local pushes, tombstones propagate", …perTable.decks…);
it("pcoItemMappings: LWW by updatedAt on the mapping id", …);
it("a missing remote decks table is skipped quietly", async () => {
  remote.listDecksSince = async () => { throw { code: "42P01", message: 'relation "overlaysys.decks" does not exist' }; };
  const r = await sync(local, remote, "org");
  expect(r.errors).toEqual([]); expect(r.perTable.decks).toEqual({ pulled: 0, pushed: 0 });
});
it("a missing remote pco_item_mappings table (PGRST205) is skipped quietly", …);
```
`fsStorageAdapter.test.ts`: decks save → `listDecksSince` includes tombstones and `listDecks` hides them. Mappings round-trip the same way.
`cloudStorageAdapter.test.ts`: with a fake `decks` payload table, `saveDeck` upserts `{ id, org_id, payload, updated_at, deleted_at }` and `listDecksSince` returns the deck with `updatedAt` normalised to `…Z`.

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/core/src/syncEngine.test.ts server/src/fsStorageAdapter.test.ts packages/supabase/src/cloudStorageAdapter.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
- Add the two `reconcileTable` blocks after `stageLayouts`. Rename the `OPTIONAL_TABLES` comment's doc pointer to name both migration docs.
- `CloudStorageAdapter`: widen the payload-table union to `"songs" | "templates" | "stage_layouts" | "channel_configs" | "decks" | "pco_item_mappings"`.
- `database.types.ts`: add hand-written `decks` and `pco_item_mappings` entries mirroring `stage_layouts`.
- `FsStorageAdapter` delegates to Task 3's stores. `saveDeck` and `putItemMapping` keep the incoming `updatedAt`, so a pulled record isn't re-stamped.
- `cloudSync.ts` `fanOut`: on `touched("decks")`, call `reloadDecks()` and broadcast `{ type: "deck_list", decks: await listDeckMetas() }`. On `touched("pcoItemMappings")`, call `reloadItemMappings()`. Add `"decks"` to the stage-feed invalidation condition.
- Docs: `docs/cloud-slides-sync-migration.md` §1 gets the two `create table` blocks, RLS, grants, policies and the `set_updated_at` trigger, verbatim in the `cloud-stage-layouts-migration.md` pattern. Add "After applying: regenerate types" and "Until applied: skipped quietly; the log line is `[sync] remote decks table unavailable; skipping until it is migrated`".

- [ ] **Step 4: Run them and confirm they pass.** Run: the same command plus `pnpm typecheck`. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**: `git commit -m "feat(sync): decks and PCO item-mapping entities (optional cloud tables)"`

---

### Task 7: Shows keep sections and slides through the cloud; hotcard hotkey round-trip

**Depends:** none to start. The assertion on `sections` waits for **plan 1: sections schema task**. Until then, write it with `scheduledFor` and `songs`, which the same mechanism carries. If the `keepLocalHotkey` stopgap (being added in parallel; test block `FsStorageAdapter.saveHotcard keeps the local hotkey`) has landed, rebase onto it and don't duplicate it.

**Files:**
- Create: `packages/supabase/src/optionalColumns.ts`, `packages/supabase/src/optionalColumns.test.ts`
- Modify: `packages/supabase/src/cloudStorageAdapter.ts`, `packages/supabase/src/cloudStorageAdapter.test.ts`, `packages/supabase/src/database.types.ts`, `packages/supabase/src/index.ts`, `apps/operator/src/lib/cloudData.ts`, `server/src/fsStorageAdapter.ts`, `server/src/fsStorageAdapter.test.ts`, `docs/cloud-slides-sync-migration.md` (§2 and §3), `docs/cloud-sermon-notes-migration.md` (add a one-line pointer: "superseded by `shows.extra` in docs/cloud-slides-sync-migration.md")

**Interfaces:**
- Produces:
  ```ts
  // optionalColumns.ts
  isMissingTableError(err: unknown): boolean          // moved here; syncEngine keeps its own copy (core can't import supabase)
  isMissingColumnError(err: unknown, column: string): boolean   // 42703 / PGRST204 whose message names `column`
  showExtra(show: Show): Record<string, unknown>      // Show minus id, name, projectId, rows, updatedAt, deletedAt
  hotkeyToColumn(h: Hotcard["hotkey"]): string | null // "F1".."F12" → same; null → "none"; undefined → null
  hotkeyFromColumn(v: string | null): Hotcard["hotkey"] | undefined   // "none" → null; null → undefined; invalid → undefined
  // fsStorageAdapter.ts
  keepLocalSections(incoming: Show, existing: Show | null): Show   // incoming lacks `sections` key → keep existing's
  ```
- Cloud columns: `alter table overlaysys.shows add column if not exists extra jsonb;` and `alter table overlaysys.hotcards add column if not exists hotkey text;`.
- Decision: `shows.rows` stays the authority for rows. A slides row and a row's `sectionId` already travel inside it, because the schema passes unknown keys through. `extra` carries every other show-level field: `sections`, `songs`, `scheduledFor`, `sermonNotes`, and any future key. An old client that upserts only `rows` therefore leaves `extra` intact.

- [ ] **Step 1: Write the failing tests**
`optionalColumns.test.ts`:
```ts
expect(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'extra' column of 'shows' in the schema cache" }, "extra")).toBe(true);
expect(isMissingColumnError({ code: "42703", message: "column shows.extra does not exist" }, "extra")).toBe(true);
expect(isMissingColumnError({ code: "42703", message: "column shows.other does not exist" }, "extra")).toBe(false);
expect(showExtra({ id: "s", name: "n", projectId: "p", rows: [], songs: [], scheduledFor: "2026-11-01", sections: [{ id: "x", name: "Opening" }] } as never))
  .toEqual({ songs: [], scheduledFor: "2026-11-01", sections: [{ id: "x", name: "Opening" }] });
expect([hotkeyToColumn("F3"), hotkeyToColumn(null), hotkeyToColumn(undefined)]).toEqual(["F3", "none", null]);
expect([hotkeyFromColumn("F3"), hotkeyFromColumn("none"), hotkeyFromColumn(null), hotkeyFromColumn("F99")]).toEqual(["F3", null, undefined, undefined]);
```
`cloudStorageAdapter.test.ts` (a fake `shows` / `hotcards` table with a `columns` set; unknown columns yield PGRST204 on upsert and 42703 on select):
```ts
it("saveShow writes extra; listShowsSince reads sections, songs, scheduledFor and slides rows back", …);
it("an old row with extra = null reads as today (songs [])", …);
it("without the extra column: save retries without it, list still works, one info log", …);
it("hotcard hotkey round-trips F-key, deliberate none, and absent", …);
it("without the hotkey column: save and list still work", …);
```
`fsStorageAdapter.test.ts`:
```ts
it("a pulled show without sections keeps the local sections", …);
it("an explicit sections: [] from the cloud clears them", …);
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/supabase/src server/src/fsStorageAdapter.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
- `CloudStorageAdapter` gets `private missingColumns = new Set<"shows.extra" | "hotcards.hotkey">()`. When a select or upsert fails with `isMissingColumnError`, add the column to the set, log `[sync] cloud shows.extra column unavailable; …` once, and retry once without that column.
- `rowToShow` spreads `extra` under the columned fields: `{ ...(extra ?? {}), id, name, projectId, rows, songs: extra?.songs ?? [] }`.
- Mirror the same logic in `cloudData.ts`: `getShowCloud`, `saveShowCloud`, `getHotcardCloud`, `saveHotcardCloud`, and `listHotcardMetasCloud` (which includes `hotkey`).
- In `FsStorageAdapter.saveShow`, chain `keepLocalSections` after `keepLocalSermonNotes`.
- Docs §2 holds the two `alter table` statements. §3 says "Code is in place; until applied, the cloud adapter retries without the column, and the local stopgaps (`keepLocalSections`, `keepLocalSermonNotes`, `keepLocalHotkey`) keep local values. Remove the stopgaps once the columns are live on every org."

- [ ] **Step 4: Run them and confirm they pass.** Run: the same command plus `pnpm typecheck`. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**: `git commit -m "feat(sync): show extra column and hotcard hotkey round-trip with quiet fallback"`

---

### Task 8: `SlidesRow` in the `RundownRow` union

**Depends:** **plan 1: sections schema task** (show.ts passthrough and `sectionId` on rows) and Task 1.

**Files:**
- Modify: `packages/core/src/show.ts`. This is a small additive edit in plan 1's file (after P1.17): add `SlidesRowObject` (strict, its type exported as `SlidesRow`) and `SlidesRowSchema = SlidesRowObject.passthrough()`, following P1.17's pattern, and add it to the `discriminatedUnion` list.
- Placeholder `case "slides"` branches so `pnpm typecheck` stays green:
  - `packages/core/src/bundle.ts`: add `row.templateId`, every `localSlides[].templateId`, and the deck's templates when the bundle store has the deck. Deck bundling itself is out of scope; see Notes.
  - `apps/operator/src/lib/onAir.ts`: `rowTitle` returns `"Slides"`.
  - `apps/operator/src/lib/rowAirState.ts`: returns the neutral "not on air" value for slides (no `slidesSession` read here; P2a.2 then routes slides through the adapter's `slidesAirState`).
  - `apps/operator/src/lib/stageMode.ts`: returns `{ kind: "slides", row }`, with the mode type widened.
  - `apps/operator/src/app/components/StageArea.tsx`: renders nothing for slides.
  - These four files are P2a's and are rewritten by P2a.2 and P2a.13, which keep the `"slides"` cases: merge this task **before** those tasks start, one marked line per file.
  - `server/src/stageFeed.ts`: `rowTitle` and `firstContentOf` return `"Slides"` / `NONE_SLIDE`. Task 10 replaces these.
  - `packages/companion-module/src/labels.ts`, if it switches on kind.
- Modify: `server/src/decks.ts` (replace the structural check with `r.kind === "slides"`)
- Test: `packages/core/src/show.test.ts` (add cases)

**Interfaces:**
- Produces: `SlidesRowSchema`, `type SlidesRow = z.infer<typeof SlidesRowSchema>`. It has exactly the `SlidesRowFields` keys (Task 1) plus `stageLayouts?: Record<string, string>` like every row kind (P1.22, contracts §16), `.passthrough()`, and `localSlides: z.array(DeckSlideSchema).optional()`. Add a compile-time check, `const _slidesRowFits: SlidesRowFields = {} as SlidesRow;`, to keep the two in step.

- [ ] **Step 1: Write the failing test**
```ts
it("parses a slides row with subset, overrides, local slides and an unknown key", () => {
  const show = ShowSchema.parse({ id: "s", name: "n", rows: [{ kind: "slides", id: "r", deckId: "d",
    slideIds: ["a", "a"], fieldOverrides: { a: { text: "Line X" } }, sectionId: "sec", later: true }] });
  expect(show.rows[0]).toMatchObject({ kind: "slides", slideIds: ["a", "a"], sectionId: "sec", later: true });
});
it("existing show fixtures still parse unchanged", …);   // loop over __fixtures__ shows
```
- [ ] **Step 2: Run it and confirm it fails.** Run: `pnpm vitest run packages/core/src/show.test.ts`. Expected: FAIL (`kind: "slides"` is an invalid discriminator).
- [ ] **Step 3: Add the schema and the placeholder branches.** Then run `pnpm typecheck` and fix every exhaustiveness error with the placeholders listed above. Don't change any non-slides behaviour.
- [ ] **Step 4: Run tests and typecheck.** Run: `pnpm vitest run packages/core server/src/stageFeed.test.ts apps/operator/src/lib && pnpm typecheck`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(core): slides row kind in the rundown union"`

---

### Task 9: Slides take/advance handlers

**Files:**
- Modify: `server/src/slidesHandlers.ts`, `server/src/slidesHandlers.test.ts`

**Interfaces:**
- Consumes: `shows.getShow`, `decks.getDeck`, `templates.getTemplate`, `resolveSlidesRow`, `slidesRowView` (Task 1), and the `slidesSession` API (Task 5).
- Produces handling for `slides_take`, `slides_advance`, `slides_goto`, `slides_blank` and `slides_end`.
  - The channel for `slides_take` is `msg.channel ?? row.channelHint ?? "program"`.
  - The title comes from `slidesRowView(...).title`.

- [ ] **Step 1: Write the failing tests**
```ts
it("slides_take starts the session at slideIdx (default 0) on the row channel", …);
it("slides_take refuses a missing deck", async () => {
  await handle({ type: "slides_take", showId: "s", rowId: "rowMissingDeck" });
  expect(sent).toContainEqual({ type: "error", code: "not_found", message: "This slides row's deck was deleted or hasn't synced" });
  expect(channels.getState("program").active?.templateId).toBe("before");
});
it("slides_take with an out-of-range slideIdx sends not_found 'slide 9' and changes nothing", …);
it("slides_take on a row whose template doesn't resolve sends not_configured 'Pick a design for this deck'", …);
it("slides_take on a non-slides row sends not_found", …);
it("slides_advance / goto / blank / end forward to the engine", …);
```
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run server/src/slidesHandlers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Load each distinct `templateId` among the resolved slides into the `templates` map. A slide whose template is `""` or missing makes the whole take fail with `not_configured`, so a half-rendered deck never reaches air. Set `liveRow` through the engine's `start`.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(server): slides take/advance/goto/blank/end handlers"`

---

### Task 10: Stage monitor current and next for slides

**Files:**
- Modify: `server/src/stageFeed.ts`, `server/src/stageFeed.test.ts`, `server/src/stageFeedHub.ts`

**Interfaces:**
- Consumes: `SlidesSessionSummary` on `ChannelState` (Task 5); `slidesRowView` and `slideTextLines` (Task 1); `deckRegistrySnapshot()` (Task 3).
- Produces: `StageFeedInputs.decks?: Map<string, Deck>`, which `stageFeedHub` fills from `deckRegistrySnapshot()`.

- [ ] **Step 1: Write the failing tests**
```ts
it("current/next come from the live slides session as lyric slides with the label as reference", () => {
  const feed = buildStageFeed(inputs({ followed: stateWith({ slidesSession: { rowId: "r", title: "Gloria", slideIdx: 0, slideCount: 2,
    label: "Response 1", lines: ["Line A"], nextLines: ["Line B"], blanked: false, atEnd: false } }) }));
  expect(feed.current).toEqual({ kind: "lyric", lines: ["Line A"], reference: "Response 1" });
  expect(feed.next).toEqual({ kind: "lyric", lines: ["Line B"], reference: "Gloria" });
});
it("blanked shows none as current", …);
it("on the last slide next falls back to the next row's first content", …);
it("rowTitle and firstContentOf use the deck name and its first resolved slide", …);
```
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run server/src/stageFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the slides branches.** `currentOf` checks `slidesSession` after `scriptureSession`. The reference is `label ?? title`. The next slide's reference is `nextLabel ?? title`.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(stage): confidence monitor shows current/next deck slides"`

---

### Task 11: PCO "Import as Slides" on the server

**Depends:** Tasks 2, 3, 8. Plan 1's PCO header→sections task and plan 2b's WS8.10 task must merge first, because all three edit `importPlan.ts`.

**Files:**
- Create: `server/src/pco/slidesImport.ts`, `server/src/pco/slidesImport.test.ts`
- Modify: `server/src/pco/importPlan.ts`, `server/src/pco/importPlan.test.ts`, `server/src/pco/routes.ts`, `server/src/pco/routes.test.ts`

**Interfaces:**
- Consumes: `suggestDeck`, `findMapping`, `mappingKeysFor`, `buildSlidesRow`, `carryOverSlidesRow` (Task 2); the deck registry and mapping store (Task 3).
- Produces:
  - `ImportItemConfig.kind` gains `"slides"`, with `deckId?: string` and `remember?: boolean`. The existing `templateId` field is reused as the row template override.
  - `slidesSuggestionsFor(items: PcoPlanItem[]): Promise<Record<string /*itemId*/, DeckSuggestion>>` in `slidesImport.ts`.
  - `rememberSlidesChoices(items: PcoPlanItem[], configs: ImportItemConfig[]): Promise<number>` in `slidesImport.ts`. It writes the `title:` key, plus the `pcoSong:` key when the item is linked to a PCO song.
  - The `GET /api/pco/plans/:planId/items` response gains `slidesSuggestions` (an additive field; `buildItemPreview` is unchanged).
  - New routes: `GET /api/pco/item-mappings` → `{ mappings: PcoItemMapping[] }`, and `DELETE /api/pco/item-mappings/:id` → `{ ok: boolean }`. Both call `scheduleSync()`.
  - `findRemovedPlanRows` labels a slides row with its deck name (fallback `"Slides"`).

- [ ] **Step 1: Write the failing tests**
`importPlan.test.ts`:
```ts
it("a slides-kind item becomes a slides row with sourceRef and PCO length", …row.kind==="slides", deckId, sourceRef.itemId, lengthSec…);
it("re-import keeps the operator's slideIds and fieldOverrides for the same deck", …);
it("re-import keeps sectionId, sermonNotesId and a manual length on slides rows", …);
it("a slides config naming an unknown deck fails that item with 'Deck not found for \"<title>\"' and imports the rest", …);
it("remember: true writes title and pcoSong mappings only after the show saved", …);
it("remember: false writes no mapping", …);
```
`routes.test.ts`: the items route returns `slidesSuggestions[itemId].via === "remembered"` for a mapped title. The mappings list and delete routes work, and delete tombstones the mapping.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run server/src/pco`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `importPlan`, add a `cfg.kind === "slides"` branch next to scripture. Call `carryOverSlidesRow` from the existing `carryOver` when both rows are slides rows. Call `rememberSlidesChoices` after the show save succeeds.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(pco): import any plan item as slides with remembered deck mappings"`

---

### Task 12: Convert a song to a slide deck (core and server)

**Files:**
- Create: `packages/core/src/slidesConvert.ts`, `packages/core/src/slidesConvert.test.ts`, `server/src/decksConvert.ts`, `server/src/decksConvert.test.ts`
- Modify: `server/src/slidesHandlers.ts` (the `convert_song_to_deck` and `undo_convert_song` cases), `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Song`, `SongRow`, `ShowSong`, `resolveArrangement`, `resolveIntroTake` (core); `resolveShowDate`, `toISODate` (`showSchedule.ts`); `PCO_SONG_ID_KEY` (`pco/mapPlanItems.ts`); `mappingKeysFor` and `normalizePcoTitle` (Task 2); the registries (Task 3), `songs.ts` and `shows.ts`.
- Produces:
  ```ts
  // core/slidesConvert.ts
  deckFromSong(song: Song, opts: { id: string; now: string; newId: () => string; licensing?: DeckLicensing;
    titleSlide?: { templateId: string; data: Record<string,string> } }): { deck: Deck; sectionSlideIds: Record<string, string[]>; droppedSections: string[] }
  songRowToSlidesRow(row: SongRow, showSong: ShowSong | undefined, song: Song, deck: Deck,
    sectionSlideIds: Record<string, string[]>): { row: SlidesRow; warning?: string }
  isUpcomingShow(show: Pick<Show, "name" | "scheduledFor">, todayISO: string): boolean   // date ≥ today, or no date
  convertedDeckId(song: Pick<Song, "customFields">): string | null   // reads customFields.converted_to_deck
  // server/decksConvert.ts
  convertSongToDeck(songId: string, opts: { titleSlide: boolean; licensing?: DeckLicensing; today?: string }):
    Promise<{ conversionId: string; deck: Deck; rows: number; shows: number; warnings: string[] }>
  undoConversion(conversionId: string): Promise<{ songId: string; restoredShows: number; skippedShows: number } | null>
  ```
- Rules:
  - The deck name is the song title. Slides follow `defaultArrangement`, and each section occurrence becomes one slide per song slide with `data.text = lines.join("\n")` and `label = section.label`. A repeated section copies its slides again with new ids.
  - `sectionSlideIds` maps a section id to the slide ids from its **first** occurrence. `droppedSections` lists the labels of sections that aren't in the play order. They are not copied, and the dialog warns about them.
  - `defaultTemplateId` is `song.defaultLyricTemplateId`, falling back to the first template.
  - Licensing defaults to `{ kind: "ccli", ccliNumber }` when the song has a CCLI number, and to `{ kind: "public-domain" }` otherwise.
  - The title slide is `resolveIntroTake(syntheticRow, undefined, song, templates)`. It is prepended only when that call returns a value.
  - Row rewrite:
    - Keep the row id, `channelHint`, `notes`, `sermonNotesId`, `lengthSec`, `lengthSecManual`, `sourceRef` and `sectionId`.
    - Set `templateId` only when `lyricTemplateId !== deck.defaultTemplateId`.
    - `slideIds`: use the row's or show's arrangement mapped through `sectionSlideIds`, only when it differs from the default arrangement. An unmapped section adds `Section "<label>" isn't in the deck; skipped`.
    - Drop the show's `ShowSong` entry when no remaining row uses the song.
  - Mappings: write `title:<normalised song title>`, plus `pcoSong:<customFields.pco_song_id>` when that field is present.
  - The song is saved once with `customFields.converted_to_deck = deckId`, then tombstoned.
  - The undo snapshot is kept in memory for the process. It holds the original song, every changed show as it was before, the created deck id, and each mapping's previous value or "absent".

- [ ] **Step 1: Write the failing tests** (placeholder lyrics only)
`slidesConvert.test.ts`:
```ts
it("builds slides in play order with labels; repeats get new ids; first-occurrence map", () => {
  // song sections v1 (2 slides), c (1 slide), v2 (1 slide, not in arrangement); arrangement [v1, c, c]
  const { deck, sectionSlideIds, droppedSections } = deckFromSong(song, opts);
  expect(deck.slides.map((s) => s.label)).toEqual(["Verse 1", "Verse 1", "Chorus", "Chorus"]);
  expect(new Set(deck.slides.map((s) => s.id)).size).toBe(4);
  expect(sectionSlideIds.c).toHaveLength(1); expect(droppedSections).toEqual(["Verse 2"]);
  expect(deck.licensing).toEqual({ kind: "ccli", ccliNumber: "123" }); expect(deck.convertedFromSongId).toBe(song.id);
});
it("prepends a title slide when asked", …);
it("songRowToSlidesRow keeps id, sourceRef, sectionId and length; maps a custom arrangement; warns on unmapped section", …);
it("isUpcomingShow: today and later and undated are upcoming; yesterday is not", …);
```
`decksConvert.test.ts` (tmp data dir):
```ts
it("rewrites upcoming shows only, records mappings, tombstones the song with the pointer", …);
it("convert leaves a live song session alone", () => { /* start a song session on program first; after convert the channel state and active mount are unchanged */ });
it("undo restores the song, the shows and the mappings, and deletes the deck", …);
it("undo skips a show edited after the conversion", async () => { /* save the rewritten show again; undo → skippedShows 1, that show keeps its new edit */ });
it("undo with an unknown id returns null", …);
```
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/core/src/slidesConvert.test.ts server/src/decksConvert.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The handler replies with `song_converted` and broadcasts `deck`, `deck_list`, `song_list`, `show_list`, and a full `show` for each changed show. It also calls `stageFeedHub.invalidateAll()` and `scheduleSync()`. Undo detects "edited since" by comparing each show's current `updatedAt` with the value stamped at conversion.
- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): convert a song to a slide deck with undo"`

---

### Task 13: Operator store, `useWs`, `useDeck`, Live helpers and the slides adapter bodies

**Depends:** Tasks 4, 8; **P2a.2** (adapter stub); P1.8 (`store.ts` merge order).

**Files:**
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`, `apps/operator/src/lib/slidesRowView.ts` and `slidesRowView.test.ts` (ownership passes from P2a here: replace every stub body, keep every signature in contracts §9)
- Create: `apps/operator/src/app/slides/useDeck.ts`, `apps/operator/src/lib/slidesLive.ts`, `apps/operator/src/lib/slidesLive.test.ts`

**Interfaces:**
- Consumes: the protocol (Task 4); `SlidesRow` (Task 8); `KeyLike` from `lib/shortcutGuards.ts`.
- Produces:
  ```ts
  // store
  decks: DeckMeta[]; deckCache: Record<string, Deck>; lastSongConversion: Extract<ServerMessage,{type:"song_converted"}> | null;
  setDecks(d: DeckMeta[]): void; upsertDeck(d: Deck): void; setLastSongConversion(m): void
  // useWs: on open send { type: "list_decks" }; handle deck_list, deck, song_converted
  // useDeck.ts
  useDeck(deckId: string | undefined): Deck | null | undefined   // undefined = loading (sends get_deck once), null = not found
  // slidesLive.ts
  slidesKeyMessage(e: KeyLike, states: Record<string, ChannelState | undefined>): ClientMessage | null
  slidesThumbClickMessage(a: { showId: string; row: SlidesRow; position: number;
    states: Record<string, ChannelState | undefined> }): ClientMessage
  slidesRowTakeMessage(showId: string, row: SlidesRow, action: "cue" | "take"): ClientMessage
  // slidesRowView.ts adapter bodies (contracts §9)
  slidesAddItemEnabled = true
  useDeckCache() = useStore(s => s.deckCache);  useDeckFor(row): const id = row.kind === "slides" ? row.deckId : undefined; const d = useDeck(id); return id ? d : null   // hook called unconditionally
  slidesRowViewFor(row, deck) = row.kind === "slides" ? slidesRowView(row, deck) : null
  slidesAirState(row, states) = states.program?.slidesSession?.rowId === row.id ? "program" : states.preview?.slidesSession?.rowId === row.id ? "preview" : null
  slidesThumbState(row, position, states) = program session on this row at slideIdx === position → "live"; preview session likewise → "cued"; else null
  slidesThumbMessages(showId, row, position, target) = target === "program-live" ? [{ type: "slides_goto", channel: "program", slideIdx: position }] : [{ type: "slides_take", showId, rowId: row.id, slideIdx: position, channel: "preview" }]
  slidesRowTakeMessages(showId, row, action) = [slidesRowTakeMessage(showId, row, action)]
  slidesStripNotice(row, view, states) = atEnd for this row → SLIDES_END_OF_DECK; view.missingDeck → "Missing deck — restore it from Slides"; view.missingSlides > 0 → "<n> slide(s) no longer in the deck were skipped"; else null
  slidesKeyChannel(states) = states.program?.slidesSession ? "program" : null
  slidesAdvanceMessage(delta) = { type: "slides_advance", channel: "program", delta };  slidesBlankMessage() = { type: "slides_blank", channel: "program" }
  ```
- Rules:
  - Keys act only when `states.program?.slidesSession` is set: Space → `slides_advance +1`, Shift+Space → `−1`, `KeyB` → `slides_blank`. Any other key, or any key with no session, returns `null`.
  - Thumbnail click: if the program session's `rowId` is this row, send `slides_goto` on program. Otherwise send `slides_take` to `"preview"` at `position`, so a click never goes straight to program.
  - A take goes to `row.channelHint ?? "program"`. A cue goes to `"preview"`.

- [ ] **Step 1: Write the failing tests** (`slidesLive.test.ts`): each rule above as its own `it`, including "click on a row that is live on preview but not program cues to preview", "B with a song session but no slides session returns null", and "Shift+Space → delta −1". Replace P2a's stub assertions in `slidesRowView.test.ts` with one case per adapter function above (end-of-deck notice, missing deck, `slidesAirState` program vs preview, `slidesThumbMessages` both targets).
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run apps/operator/src/lib/slidesLive.test.ts apps/operator/src/lib/slidesRowView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the store, `useWs`, `useDeck` and helpers.** `useDeck` is keyed by `deckId` and re-reads `deckCache`, so a broadcast `deck` refreshes every consumer.
- [ ] **Step 4: Run them and confirm they pass,** then `pnpm --filter @overlaysys/operator typecheck`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(operator): deck store, useDeck, slides live helpers and adapter"`

---

### Task 14: /slides library page, New deck dialog with licensing, Library nav entry

**Depends:** Task 13. Plan 1: UI kit (`Button`, `Dialog`, `useConfirm`, `useToast`, `SegmentedControl`, `Input`; P1.2–P1.5), `LibraryList` (P1.9) and `TemplateThumbnail` (P1.10). `templatesFor` (P1.8). **P2b.22**, which already adds the Library nav entry `{ route: "/slides", label: "Slides", icon: Presentation, desktopOnly: true }` between Songs and Designs (contracts §13).

**Files:**
- Create: `apps/operator/src/app/slides/page.tsx`, `NewDeckDialog.tsx`, `LicensingField.tsx`, `apps/operator/src/app/slides/libraryConfig.ts`, `libraryConfig.test.ts`
- No edit to `shell/areas.ts` (P2b.22 owns it and adds the entry).

**Interfaces:**
- Consumes: `LibraryList<DeckMeta>` (contract §3), `KindBar` kind `"slides"`, `useDeck`, the store.
- Produces:
  - `deckSorts: SortSpec<DeckMeta>[]` with ids `name-asc` (default), `edited-desc` and `added-desc`.
  - `deckFilters: FilterSpec<DeckMeta>[]`: licensing (`ccli` / `public-domain` / `own`) and tag.
  - `deckColumns: Column<DeckMeta>[]`: Slides (`slideCount`), Licensing (`"CCLI"` / `"Public domain"` / `"Own"`), Tags, Edited.
  - `deckMenuItems(meta, actions): MenuItem[]`: Open, Duplicate, Rename, Delete.
  - `<LicensingField value onChange />` and `<NewDeckDialog open onClose onCreate(deck: Deck) initialName? />`.
- Copy:
  - Page title: "Slides". Primary action: "New deck".
  - Empty state: title "No decks yet"; body "Decks are reusable slides for liturgy, responses, anthems and announcements."; action "New deck".
  - Licensing question: "Is this covered by your CCLI licence?" Options: "Yes, CCLI" (then the input "CCLI song number (optional)"), "Public domain", "Our own words". Help: "Only CCLI decks are added to your CCLI usage report."
  - Delete confirm when `usedBy > 0`: title "Delete deck?"; message "\"<name>\" is used in <n> show(s). Those rows will show \"Missing deck\" until you restore it."; confirm "Delete"; danger. After deleting, toast "Deck deleted" with the action "Undo" → `restore_deck`.
  - The New deck dialog requires a name and a licensing answer, which has no default (Q8). It saves a deck with one empty slide on the chosen default template (the `templatesFor(metas, "lyric")` suggested group first), then opens `/slides/edit?id=<id>`.

- [ ] **Step 1: Write the failing test** (`libraryConfig.test.ts`): sorts order correctly; the licensing filter matches; the Delete menu item exists; the licensing label map.
- [ ] **Step 2: Run it and confirm it fails.** Run: `pnpm vitest run apps/operator/src/app/slides/libraryConfig.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the config, page and dialog.** The page uses `PageBody variant="list"`, `useConnection` for `error`, and `primaryAction.disabledReason` "Reconnect to create" while offline, like the other library pages (P1.12–P1.15).
- [ ] **Step 4: Verify.** `pnpm vitest run apps/operator/src/app/slides` passes. `pnpm typecheck && pnpm --filter @overlaysys/operator build` exit 0. Take screenshots `redesign/slides/library-1440` (with three seeded decks) and `redesign/slides/new-deck-dialog`. Check:
  - "Slides" shows in the Library nav between Songs and Designs.
  - Rows show name, slide count, licensing and tags with a green-teal KindBar.
  - The "⋯" menu is visible without hover.
  - Create stays disabled until a licensing option is picked.
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): library page, new deck dialog with licensing prompt, nav entry"`

---

### Task 15: Deck editor

**Depends:** Task 14. **P2a.19**, which exports the deck-mode components from `@/app/songs/edit/slides` (contracts §9). `TemplateThumbnail` (P1.10). `SaveBar`, `sendAndAwaitAck` (P1.6), `useUnsavedGuard` (P1.7).

**Files:**
- Create: `apps/operator/src/app/slides/edit/page.tsx`, `apps/operator/src/app/slides/edit/DeckEditor.tsx`, `apps/operator/src/app/slides/edit/DeckSlideFields.tsx`, `apps/operator/src/app/slides/edit/deckDraftOps.ts`, `deckDraftOps.test.ts`

**Interfaces:**
- Consumes: P2a's `EditorFrame` (`header`, `left`, `main`, `right`), `SlideThumbGrid` (`slides: SlideCard[]` keyed by slide id, `selectedId`, `onSelect`, `onReorder`, `onAdd`, `menuItems(id)` for Duplicate / Delete), `SlideTextEditor` and `slideFieldsFor` (contracts §9); `SaveBar`; `useUnsavedGuard`; `sendAndAwaitAck(getClient(), { type: "save_deck", deck }, { op: "save_deck", id })`; `deckTextToSlides` (Task 1); `LicensingField` (Task 14).
- Produces: `DeckSlideFields({ template: Template | null; data: Record<string, string>; onChange(next: Record<string, string>): void })` — `<SlideTextEditor heading="Edit slide n" fields={slideFieldsFor(template)} value={data} onChange />` for the text fields, then the existing `lib/FieldInput.tsx` for each remaining template field (image, colour, video). This is the multi-field editor for a slide's template fields.
- Produces (pure, in `deckDraftOps.ts`):
  - `addSlide(deck, afterId?, newId)`, `duplicateSlide(deck, id, newId)`, `deleteSlide(deck, id)` (refused when it is the last slide), `moveSlide(deck, from, to)`
  - `setSlideTemplate(deck, id, templateId | undefined)`, `setSlideData(deck, id, key, value)`, `setSlideLabel(deck, id, label)`
  - `appendPastedText(deck, text, fieldKey, newId)`
- Layout (`EditorFrame`): the left column is the flat slide list (`SlideThumbGrid`, thumbnails with labels as `caption`). The centre is the selected slide's `DeckSlideFields` for its effective template (`resolveSlideTemplateId`). The right column holds deck settings: name, tags, default design, licensing, and a per-slide "Design" override with the option "Deck default (<name>)". The ⋯ menu offers "Paste text as slides…", "Duplicate deck" and "Delete deck". A missing id shows "This deck doesn't exist (it may have been deleted)" with "Back to Slides".

- [ ] **Step 1: Write the failing tests** for each op, including "deleteSlide refuses the last slide" and "moveSlide keeps ids".
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run apps/operator/src/app/slides/edit`. Expected: FAIL.
- [ ] **Step 3: Implement the ops and the editor.** Save sends `save_deck` and awaits the ack; failure toasts `` `Not saved: ${ackErrorText(e)}` ``. Dirty means `JSON.stringify(draft) !== JSON.stringify(saved)`.
- [ ] **Step 4: Verify.** Tests pass; typecheck and build exit 0. Take screenshots `redesign/slides/deck-editor-1440` and `redesign/slides/deck-editor-bad-id`. Check:
  - A per-slide override thumbnail renders the override design.
  - The unsaved dot and ⌘S work.
  - Navigating away while dirty shows the guard dialog.
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): deck editor in deck mode"`

---

### Task 16: Slides rows in the show editor

**Depends:** Task 13 and **P2a.17, P2a.18**, which create the add-row menu entry "Slides" (enabled by the adapter's `slidesAddItemEnabled`) and the placeholder `forms/SlidesItemForm.tsx` (contracts §9).

**Files:**
- Create: `packages/core/src/slidesRowOps.ts`, `packages/core/src/slidesRowOps.test.ts`, `apps/operator/src/app/slides/row/DeckPicker.tsx`, `apps/operator/src/app/slides/row/SlidesRowInspector.tsx`
- Modify (ownership passes from P2a here): `apps/operator/src/app/shows/edit/forms/SlidesItemForm.tsx` — `SlidesItemForm` renders `<SlidesRowInspector row onChange>`; `SlidesAddFlow({ open, onClose, onAdd })` renders `<DeckPicker>` and calls `onAdd(newSlidesRow(id, deckId))`. No edit in P2a's `shows/edit/page.tsx`.
- Modify (append-only): `packages/core/src/index.ts` (`export * from "./slidesRowOps";`)

**Interfaces:**
- Produces:
  ```ts
  newSlidesRow(id: string, deckId: string): SlidesRow
  setDeck(row, deckId): SlidesRow   // clears slideIds, fieldOverrides
  useAllSlides(row): SlidesRow      // removes slideIds
  setSubset(row, deck, slideIds: string[]): SlidesRow   // collapses to undefined when equal to deck order
  addRepeat(row, deck, position): SlidesRow; removeAt(row, deck, position): SlidesRow; moveAt(row, deck, from, to): SlidesRow
  setRowTemplate(row, templateId | undefined): SlidesRow
  setFieldOverride(row, slideId, key, value | undefined): SlidesRow   // empty map entries are pruned
  detachSlidesRow(row, deck, newId): SlidesRow  // localSlides = resolved slides with overrides baked; deckId, slideIds, fieldOverrides removed; templateId = row.templateId ?? deck.defaultTemplateId
  // components
  <DeckPicker open onClose onPick(deckId: string) />   // search; recent (edited-desc) first; footer "New deck…" opens NewDeckDialog
  <SlidesRowInspector row: SlidesRow; onChange(row: SlidesRow): void />
  ```
- Inspector copy:
  - The deck line reads "<deck name> · <n of m slides>", with the links "Change deck" and "Edit deck".
  - Slides list for this week: checkbox per deck slide, drag to reorder, "Repeat" per row, and "Use all slides".
  - "Design for this week": options "Deck default (<name>)" plus the template list.
  - "Text for this week": appears on the selected slide, with "Reset" per field.
  - "Detach to this show" confirm: title "Detach from deck?"; message "This show gets its own copy of the slides. Later edits to \"<name>\" won't change it."; confirm "Detach".

- [ ] **Step 1: Write the failing tests** for every op. Include:
  - "setSubset back to full order clears slideIds"
  - "addRepeat inserts the same id after position"
  - "detach bakes overrides and the effective template and keeps id, sourceRef, sectionId"
  - "setFieldOverride with undefined prunes the empty slide entry"
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/core/src/slidesRowOps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the ops, picker, inspector and the two `SlidesItemForm.tsx` exports.**
- [ ] **Step 4: Verify.** Tests pass; typecheck and build exit 0. Take screenshots `redesign/slides/show-editor-slides-row` and `redesign/slides/deck-picker`. Check:
  - The row's line 1 is the deck name and line 2 is "n of m slides".
  - The thumbnail preview updates when the design override changes.
  - A repeat shows twice in the list.
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): slides rows in the show editor (subset, repeats, overrides, detach)"`

---

### Task 17: One-off local slides and "Save to library"

**Depends:** Task 16.

**Files:**
- Modify: `packages/core/src/slidesRowOps.ts`, `slidesRowOps.test.ts`, `SlidesRowInspector.tsx`
- Create: `apps/operator/src/app/slides/row/LocalSlidesEditor.tsx`

**Interfaces:**
- Produces:
  - `newLocalSlidesRow(id, templateId, newId): SlidesRow`. It starts with one empty slide.
  - `saveRowToLibrary(row, a: { deckId: string; name: string; licensing: DeckLicensing; now: string }): { deck: Deck; row: SlidesRow }`. The row becomes `{ deckId }`. `localSlides` and `templateId` are dropped. `deck.defaultTemplateId = row.templateId`.
  - Add-row menu: "Slides" opens `SlidesAddFlow` (the DeckPicker), whose footer gains "One-off slides for this show" → `onAdd(newLocalSlidesRow(...))`.
  - The inspector for a local row shows `LocalSlidesEditor` (add, delete, reorder, fields, paste text). Its action "Save to library…" opens `NewDeckDialog` prefilled with the name, then sends `save_deck` and replaces the row.

- [ ] **Step 1: Write the failing tests:** "saveRowToLibrary keeps slide ids so nothing re-keys" and "the row afterwards resolves to the same slides through the deck".
- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Tests pass; typecheck and build exit 0. Take the screenshot `redesign/slides/local-slides-row` and check that "Save to library…" is present and the row title reads "One-off slides".
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): one-off slides on a row with Save to library"`

---

### Task 18: Live integration (verification of the adapter in plan 2a's Live)

**Depends:** Task 13 and **P2a.13, P2a.16** (thumbnail strip, rundown rows, `useGlobalShortcuts` with `keyMode` "slides").

**Files:** none of P2a's. P2a's Live renders slides rows only through the adapter (contracts §9), whose bodies Task 13 filled in:
- Thumbnail strip: `slidesRowViewFor(row, deck).slides` through `TemplateThumbnail`, each with its `label`; the live one has a red border and the cued one green (`slidesThumbState`); a click sends `slidesThumbMessages`.
- Notice line above the strip: `slidesStripNotice` (end of deck → `SLIDES_END_OF_DECK`; missing deck → "Missing deck — restore it from Slides" and no thumbnails; skipped slides → "<n> slide(s) no longer in the deck were skipped").
- Rundown row: line 1 is `view.title` and line 2 is `view.detail`; Take/Cue use `slidesRowTakeMessages`.
- Keys: `keyMode` is "slides" while `slidesKeyChannel` is non-null; Space / Shift+Space send `slidesAdvanceMessage(±1)` and B sends `slidesBlankMessage()` (P2a.16). If anything here is missing, file the fix against P2a's task rather than editing P2a's files.

- [ ] **Step 1:** Confirm `pnpm vitest run apps/operator/src/lib/slidesLive.test.ts apps/operator/src/lib/slidesRowView.test.ts` passes.
- [ ] **Step 2: Verify.** Typecheck and build exit 0. Against the running app, with a show holding a 3-slide public-domain deck, script `uxreview/slides-live.mjs` and take these screenshots:
  - `redesign/slides/live-cued`: click thumbnail 2 while it's not live. PVW shows slide 2 and PGM is unchanged.
  - `redesign/slides/live-onair`: take, then press Space twice. Thumbnail 3 is red.
  - `redesign/slides/live-end`: press Space once more. The notice reads "End of deck · Space again to clear" and PGM still shows slide 3.
  - Press Space again: PGM clears.
  - Press B on a live slide: PGM goes out and the session pill remains.
  - Delete the deck from /slides: the row reads "Missing deck" and Take sends nothing to air (`redesign/slides/live-missing-deck`).
  - Also confirm the stage monitor at http://localhost:3001 shows the current and next lines.
- [ ] **Step 3: Commit** (screenshot script only, if any): `git commit -m "test(live): slides decks play through the Live adapter"`

---

### Task 19: /pco "Import as Slides" UI

**Depends:** Tasks 11 and 14, and **P2b.26** (/pco rebuild).

**Files:**
- Create: `apps/operator/src/app/pco/ImportAsSlides.tsx`, `apps/operator/src/app/pco/slidesImport.ts`, `slidesImport.test.ts`
- Modify (marked blocks in P2b.26's files): `apps/operator/src/app/pco/importOptions.ts` — `ImportAs` gains `"slides"` and `importOptions(item)` offers "Slides" for every item type; `apps/operator/src/app/pco/PcoItemRow.tsx` — renders `<ImportAsSlides>` when it is chosen. The import request carries `kind: "slides"`, `deckId`, `templateId?` and `remember`. Extend `importOptions.test.ts` with "every item offers Slides".

**Interfaces:**
- Consumes: `slidesSuggestions` from the items route (Task 11); `DeckPicker` (Task 16, or a plain searchable select if Task 16 hasn't landed); `NewDeckDialog` (Task 14).
- Produces:
  - `initialSlidesChoice(suggestion: DeckSuggestion | undefined, decks: DeckMeta[]): { kind: "slides"; deckId: string; templateId?: string; remember: true } | null`. It returns non-null only for `via === "remembered"` when the deck is still in `decks`.
  - `rememberLabel(item: Pick<PcoPlanItem, "title" | "song">): string`
  - `forgetMapping(id: string): Promise<void>`, which calls `DELETE /api/pco/item-mappings/:id`.
- Copy:
  - Kind option: "Slides".
  - Picker placeholder: "Choose a deck…". Footer: "New deck from this item…".
  - Remember checkbox, on by default: `Remember for items titled "<title>"`. For a PCO song item: `Remember for this Planning Center song`.
  - Remembered pill: `Remembered · Slides → <deck name>` with the link "Forget".
  - A name-match suggestion shows "Suggested: <deck name>" and is not auto-selected.

- [ ] **Step 1: Write the failing tests** (`slidesImport.test.ts`): a remembered and existing deck → preselected; a remembered but deleted deck → null; a name-only suggestion → null; the two `rememberLabel` forms.
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run apps/operator/src/app/pco/slidesImport.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the component, helpers and mount point.**
- [ ] **Step 4: Verify.** Tests pass; typecheck and build exit 0. With mocked PCO fixtures (the existing `server/src/pco/__fixtures__`; no real credentials), take the screenshot `redesign/slides/pco-import-as-slides`. Check:
  - A remembered item opens preselected with the pill.
  - "Forget" removes the pill and the item reverts to its default kind.
- [ ] **Step 5: Commit**: `git commit -m "feat(pco): Import as Slides with remembered deck choice"`

---

### Task 20: "Convert to slide deck" UI

**Depends:** Tasks 12 and 14, **P1.13** (songs list `menuItems`) and **P2a.20** (song editor ⋯ menu and `SongNotFound` block).

**Files:**
- Create: `apps/operator/src/app/slides/ConvertToDeckDialog.tsx`, `apps/operator/src/app/slides/convertCopy.ts`, `convertCopy.test.ts`
- Modify (marked blocks): `apps/operator/src/app/songs/page.tsx` (P1.13's file) — the Songs list `menuItems` adds "Convert to slide deck…"; `apps/operator/src/app/songs/edit/page.tsx` (P2a.20's file) — the ⋯ menu adds the same item, and `SongNotFound` uses `convertedDeckId(song)` from the trashed song to show "This song was converted to the deck \"<name>\"" with the button "Open deck".

**Interfaces:**
- Consumes: `convert_song_to_deck`, `undo_convert_song` and `song_converted` (Tasks 4, 12); `store.lastSongConversion` (Task 13); `LicensingField`; `useToast`.
- Produces: `convertResultMessage(m: { deckName: string; rows: number; shows: number }): string`, which returns `Converted to deck "<name>" · switched <rows> row(s) in <shows> show(s)`. When `rows === 0` it returns `Converted to deck "<name>"`.
- Dialog copy:
  - Title: "Convert to slide deck".
  - Body: `Creates the deck "<title>" from this song's play order, switches upcoming shows that use it to the deck, and moves the song to Recently deleted.`
  - Checkbox: "Add a title slide using the song's intro design". When the song has no intro design it is disabled, with the tooltip "This song has no intro design".
  - `LicensingField` is prefilled with the derived licensing.
  - Confirm: "Convert".
  - After converting, show a toast `convertResultMessage(...)` with the action "Undo" → `undo_convert_song`. Any warnings appear as one `warn` toast listing them.

- [ ] **Step 1: Write the failing test** for `convertResultMessage`, covering the plurals and the zero case.
- [ ] **Step 2: Run it and confirm it fails.** Expected: FAIL.
- [ ] **Step 3: Implement the dialog and the mount points.**
- [ ] **Step 4: Verify.** Typecheck and build exit 0. Convert a placeholder song used by one upcoming show and one past show, and take these screenshots:
  - `redesign/slides/convert-dialog`
  - `redesign/slides/convert-toast`
  Then check:
  - In the upcoming show the row is now a slides row with the same position and section.
  - The past show is unchanged.
  - /songs no longer lists the song.
  - Undo restores both.
  - Opening the old `/songs/edit?id=` link shows the converted-to notice.
- [ ] **Step 5: Commit**: `git commit -m "feat(slides): Convert to slide deck from Songs with Undo"`

---

### Task 21: Companion slides next and previous

**Depends:** Tasks 4 and 5, and **P2b.30–P2b.32** (Companion; contracts §14 reserves this task's ids). These edits are additive, in marked blocks, to `actions.ts`, `presets.ts`, `feedbacks.ts` and `variables.ts`. Action ids are never renamed. Regenerate HELP.md with `pnpm --filter @overlaysys/companion-module gen:help` and keep P2b.32's drift test and naming test ("Slides: next slide") green.

**Files:**
- Modify: `packages/companion-module/src/actions.ts`, `presets.ts`, `variables.ts`, `feedbacks.ts`, `companion/HELP.md` (regenerated by P2b.32's `gen:help`)
- Create: `packages/companion-module/src/__tests__/slides.test.ts`

**Interfaces:**
- Produces:
  - Action ids:
    - `slides_advance`: "Slides: next / previous slide"; options channel and delta. It sends `{ type: "slides_advance", channel, delta }`.
    - `slides_blank`: "Slides: blank".
    - `slides_end`: "Slides: end".
  - Presets in a "Slides" category: "Slides next" (delta 1) and "Slides previous" (delta −1) on program.
  - Variables `<c>_slides_deck`, `<c>_slide_n` (1-based) and `<c>_slide_count`, read from `ChannelState.slidesSession`.
  - Feedback `slides_on_air` (red) when the channel has a `slidesSession`.

- [ ] **Step 1: Write the failing tests:**
  - "slides_advance with delta −1 sends delta −1"
  - "presets use valid action options"
  - "variables are empty with no session and filled with one"
- [ ] **Step 2: Run them and confirm they fail.** Run: `pnpm vitest run packages/companion-module/src/__tests__/slides.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass,** plus the existing companion tests. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(companion): slides next/previous, blank, end, variables and feedback"`

### Task 22: Stage screens on slides rows

**Depends:** Task 16 and **P2a.22** (`StageScreensField`), P1.22. Spec "Stage screens choose their layout dynamically" (the item editor part, for slides rows). Contracts §16.

**Files:**
- Modify: `apps/operator/src/app/slides/row/SlidesRowInspector.tsx`

- Add the collapsible "Stage screens" section with P2a's `<StageScreensField value={row.stageLayouts} onChange={(v) => onChange(v ? { ...row, stageLayouts: v } : omit(row, "stageLayouts"))} />`. The server (P2b.33) already applies `stageLayouts` for any row kind, and `slidesRowOps` keeps the key (extend `slidesRowOps.test.ts`: `detachSlidesRow` and `setDeck` keep `stageLayouts`).
- [ ] Write the `slidesRowOps` cases → FAIL → keep the key → PASS; typecheck and build exit 0; screenshot `redesign/slides/slides-row-stage-screens`; take the row on a show whose band screen has a song rule: the slides row's override picks the layout.
- [ ] Commit: `git commit -m "feat(slides): stage screen layouts on slides rows"`

---

## Notes and deliberate omissions

- **Bundles:** export and import of decks inside a show bundle is not in the spec and not in this plan. Task 8 only keeps `bundle.ts` exhaustive and collects the slides row's templates. Follow-up: add `decks[]` to `bundle.ts` and pull referenced decks in as dependencies.
- **Service-type-scoped mappings, the template `purpose` tag, auto-advance and loop, image-folder import, STT follow:** these are enrichment phase 2 and 3 items and not in the spec.
- **Settings "Import rules" table:** dropped in favour of "Forget" on the remembered pill (Task 19). The mappings list route exists, so a table can be added later without server work.
- **CCLI report:** deck uses are written to the same `song-usage.jsonl` with the deck id as `songId` and the deck name as `title`. No schema change is needed.

---

## Contract changes

Resolved in contracts §6 (C1 `DeckSlide.label`, C2 `convertedFromSongId` and the exact licensing union, C3 `channelHint`/`lengthSecManual`, C8 `converted_to_deck`, `ChannelState.slidesSession`, `slidesRowView` with `undefined` = loading), §9 (C4 → the operator adapter `lib/slidesRowView.ts` and `SlidesItemForm`/`SlidesAddFlow`, whose bodies this plan owns from Tasks 13 and 16; C5 → P2a's names `EditorFrame`, `SlideThumbGrid`, `SlideTextEditor`, `slideFieldsFor`, path `@/app/songs/edit/slides`, with this plan's `DeckSlideFields` on top), §12 (`shows.extra`, `hotcards.hotkey`, decks and mappings entities), §13 (C6: P2b.22 adds the `/slides` nav entry), §14 (C6: Companion ids reserved), §16 (stage layout rules: `stageLayouts` on `SlidesRow`, Task 22) and §15 (log). C7 (shared server files) is the shared-file rule and merge order in the execution-order doc.

---

## Appendix: Fix-plan coverage

No FIX-PLAN workstream is assigned to this plan. The IDs that touch its scope:

| ID | Where |
|---|---|
| LM-11 (PCO choices not remembered; headers imported as graphics) | Remembered deck choice: Tasks 2, 11, 19. Header defaults: P1.19 (headers → sections) and P2b.26 |
| SONGS-6 (bad song id spins forever) | P2a.20. The converted-to notice: Task 20 (contracts §6) |
| T14 / D12 / WS0.2 (template pickers list everything) | P1.8. Deck pickers use `templatesFor(…, "lyric")` suggested first: Tasks 14, 15, 16 |
| T18 (delete safety and "used by") | Decks: Task 14 (`usedBy` in Task 3) |
| T4 / D10 (hover-only row actions) | LibraryList (plan 1). Slides page: Task 14 |
| T1 (unsaved guard) | Deck editor: Task 15 |
| WS8.10 / EXTRA-2 | P2b.27. Task 11 merges after it in `importPlan.ts` |
| WS8.12–8.14 / LM-12…LM-18 (Companion) | P2b.30–P2b.32. Task 21 follows its naming and HELP.md generator |
| LM-10, LM-19, LM-20 (/pco page) | P2b.26. Task 19 mounts into it |

---

## Self-review

- **Spec coverage.** Every item in the spec has a task:
  - Library with tags and the "Slides" page: Task 14.
  - Flat deck and templates with precedence: Tasks 1 and 15.
  - Rows by reference with subset, repeats, overrides and detach: Task 16.
  - One-off slides with "Save to library": Task 17.
  - Live click/Space/B/end of deck: Tasks 5, 9, 13 and 18.
  - Stage current/next: Task 10.
  - Companion next/prev: Task 21.
  - Licensing at creation and CCLI only for ccli decks: Tasks 14 and 5.
  - PCO import for any item with remembered mappings and song-id precedence: Tasks 2, 11 and 19.
  - Convert: Tasks 12 and 20.
  - Sync: the `decks` entity (Task 6), mappings synced (Task 6), shows carry sections and slides rows (Tasks 7 and 8), hotkey round-trip (Task 7), missing table or column skipped quietly (Tasks 6 and 7), migration doc (Tasks 6 and 7).
- **Type consistency.** `SlidesRowFields` (Task 1) and `SlidesRow` (Task 8) are tied by a compile-time check. `DeckSuggestion` is defined in Task 2 and used in Tasks 11 and 19. `SlidesSessionSummary` is defined in Task 1 and used in Tasks 5, 10, 13 and 21. `ResolvedSlide.position` is the index used by `slides_take.slideIdx` and `slides_goto.slideIdx`.
- **Review Focus.** All five lines have tests in their owning tasks (1, 2, 6, 7, 9, 12).
