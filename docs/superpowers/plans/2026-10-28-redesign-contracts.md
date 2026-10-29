# Redesign shared contracts (plans 1–3)

Spec: `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md`.
The four plans — `2026-10-28-redesign-1-foundation.md` (P1),
`…-2a-live-shows-songs.md` (P2a), `…-2b-designers-settings-library.md` (P2b),
`…-3-slides-sync.md` (P3) — must use exactly these names. Task references use
the form `P1.6`, `P2a.19`. Execution order, file ownership and the shared-file
rule are in `2026-10-28-redesign-execution-order.md`.

This file is the single source of truth. Every "Contract changes" proposal in
the four plans has been resolved into the sections below (resolution log in
§15). A plan that needs a further change edits this file in the same commit
and says so.

## 1. Tokens (`packages/ui/src/tokens.ts`, `apps/operator/src/app/globals.css`) — owner P1.1

CSS variables (P1 may tune values only while `contrast.test.ts` and
`palette.test.ts` AA rules pass; the values below are the tuned ones):

| var | value | `colors.` key |
|---|---|---|
| `--bg` | `#1b1b1d` | `bg` |
| `--surface` | `#202022` | `surface` |
| `--surface-2` | `#242426` | `surface2` |
| `--surface-3` | `#2c2c2f` | `surface3` |
| `--control` | `#3a3a3e` | `control` |
| `--border` | `#333336` | `border` |
| `--border-strong` | `#45454a` | `borderStrong` |
| `--text` | `#e8e8ea` | `text` |
| `--text-dim` | `#aaaab0` (tuned from `#a0a0a6`: AA on `--control`) | `textDim` |
| `--text-muted` | `#98989e` (tuned from `#8e8e94`: that was 4.27:1 on `--surface-3`) | `textMuted` |
| `--brand` | `#4f7cff` (selection / primary); `--accent` is an alias | `brand`, `accent` |
| `--brand-text` | `#7b9dff` | `brandText` |
| `--brand-fill` | `#3a66f0` (white text AA) | `brandFill` |
| `--onair` | `#e5484d` (program / live) | `onair` |
| `--onair-fill` | `#d13b40` | `onairFill` |
| `--ok` | `#30a46c` (preview / next) | `ok` |
| `--ok-fill` | `#24855a` | `okFill` |
| `--warn` | `#f5b942` | `warn` |
| `--danger` | `#e5484d` | `danger` |
| `--danger-text` | `#f2777b` | `dangerText` |

Item-kind colours, exported as `kindColor: Record<ItemKind, string>` (values
`"var(--kind-<kind>)"`) with
`type ItemKind = "graphic" | "song" | "slides" | "scripture" | "video" | "section"`:
graphic `#60a5fa`, song `#f5b942`, slides `#34d399`, scripture `#f472b6`,
video `#a78bfa`, section `#8e8e94`.

`radius = { sm: 4, md: 6, lg: 8, xl: 12, pill: 999 }`; `control[size].height`
= `sm 24`, `md 28`, `lg 32`. Existing token keys keep working (aliases)
until plans 2a/2b remove their users. Song-section chip colours are not
tokens: `sectionKindColor` (§9) lives with the song editor.

## 2. UI kit components (`packages/ui/src/*`, exported from `index.ts`) — owner P1.2–P1.7

- `Button` — `variant: "primary" | "secondary" | "ghost" | "danger" | "onair"` (`destructive`, `success` kept as deprecated aliases), `size: "sm" | "md"`, `icon?: ReactNode`, `block?`, plus native props. (`onair` = red Take.) A disabled filled button renders as secondary in `textMuted` at opacity 1.
- `IconButton` — requires `aria-label`; `size?: number` (28), `tone?: "default" | "danger"`. `DeleteButton({ name; onClick; disabled?; size? })`.
- `Input`, `Textarea`, `Select` (restyled, same props as today).
- `NumberInput` — `{ value: number; onCommit(v: number): void; min?; max?; step?; int?: boolean; precision?: number; suffix?: string; size?; disabled?; "aria-label"?; id? }`; draft text, commits on blur/Enter, Esc reverts, ↑/↓ steps. `precision` fixes the decimal places for display and commit (overrides the `step`-derived default). Pure helpers in `numberDraft.ts`: `roundTo(v, dp)` (half away from zero: `roundTo(-0.5, 0) === -1`), `formatNumber(v, dp)` (no trailing zeros), `decimalsFor(step?, int?, precision?)`, `parseDraft`, `stepValue`. `packages/editor-kit` uses these (re-exported from its `numberFormat.ts`), never its own copy.
- `SegmentedControl<T extends string>` — `{ value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange(v: T): void; size?; "aria-label"? }`.
- `Switch` — `{ checked; onChange(b); label?; disabled?; "aria-label"? }`; `Checkbox` same shape.
- `FileDrop` — `{ accept: string /* ".txt,.cho,image/*" */; onFile(f: File): void; hint?: ReactNode; buttonLabel?: string; file?: File | null; onClear?(): void }`; pure `acceptsFile(name: string, mime: string, accept: string): boolean`. The only file picker in the app (`/data`, song import, …).
- `Menu` — `{ items: MenuItem[]; anchor: { x: number; y: number } | HTMLElement; onClose(): void }`, `type MenuItem = { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean | string /* reason → tooltip */; shortcut?: string; onSelect(): void } | { separator: true }`. Keyboard: arrows, Enter, Esc.
- `useContextMenu()` → `{ open(e: React.MouseEvent | HTMLElement, items: MenuItem[]): void; menu: ReactNode }`.
- `Dialog` + `useConfirm()` → `confirm({ title, message, confirmLabel, cancelLabel?, danger? }): Promise<boolean>`; imperative `confirm`, `prompt(o: PromptOptions)`/`usePrompt()`, `chooseAction(...)`, `alertDialog(...)`; one `<DialogHost />` in `app/layout.tsx`. Replaces `window.confirm`/`window.prompt` everywhere incl. `useUnsavedGuard`.
- `Toast` + `useToast()` → `toast({ message, tone?: "info" | "ok" | "warn" | "error", action?: { label; onClick }, durationMs? })`; one `<ToastHost />`.
- `Tooltip` — `{ content: ReactNode; children; side?: "top" | "bottom" }`.
- `KindBar` — `{ kind: ItemKind }` thin 3px vertical bar.
- `SaveBar` — `{ dirty: boolean; saving: boolean; onSave(); onRevert(); disabledReason?: string; revertTitle?: string /* [P2a.17] title of the Revert confirm; default "Revert changes?" */; revertMessage?: string /* [P2a.20] body of the Revert confirm; default "Your unsaved edits will be lost." */ }` (unsaved dot + Revert + Save ⌘S, binds ⌘/Ctrl+S) — used by every editor and settings page. Offline: `disabledReason: "Reconnect to save"`.
- `OfflineState` — `{ noun?: string; variant?: "empty" | "stale"; onRetry(): void; compact?: boolean; children?: ReactNode }`. Copy from pure `offlineCopy(noun?: string, variant: "empty" | "stale" = "empty"): { title: string; body: string }` (`packages/ui/src/offlineCopy.ts`): empty + noun → `{ title: "Can't load <noun>", body: "Not connected to the server." }`; stale → `{ title: "Not connected to the server", body: "Showing what was last loaded." }`. Button "Retry" (secondary, lucide `RefreshCw`). `stale` renders a slim notice above `children`.

## 3. Shared library list (`packages/ui/src/LibraryList.tsx`) — owner P1.9

```ts
type SortSpec<T> = { id: string; label: string; compare(a: T, b: T): number };
type FilterSpec<T> = { id: string; label: string; options: { value: string; label: string }[]; test(item: T, value: string): boolean };
type Column<T> = { id: string; label: string; width?: string; render(item: T): ReactNode; align?: "left" | "right" };
type LibraryListProps<T> = {
  items: T[];
  getId(item: T): string;
  primary(item: T): ReactNode;          // name (line 1)
  secondary?(item: T): ReactNode;       // muted line 2 (never an id)
  kind?(item: T): ItemKind;             // KindBar
  columns?: Column<T>[];
  searchText(item: T): string;          // haystack for search
  sorts: SortSpec<T>[];
  defaultSort: string;                  // SortSpec id
  filters?: FilterSpec<T>[];
  menuItems(item: T): MenuItem[];       // context menu + "⋯" button
  onOpen(item: T): void;                // click / Enter
  primaryAction?: { label: string; onClick(): void; disabledReason?: string };
  headerActions?: ReactNode;            // secondary page actions, left of the primary action
  views?: { grid?: { renderCard(item: T): ReactNode; minCardWidth?: number } }; // enables list/grid toggle
  storageKey: string;                   // persists sort/filter/view per page
  emptyState: { title: string; body?: string; action?: { label: string; onClick(): void } };
  loading?: boolean; error?: string | null;
};
```
Full width; no hover-only actions; keyboard ↑/↓, Enter opens, typing focuses search; right-click and "⋯" open the menu. Pure model in `libraryListModel.ts` (`computeVisible`, `loadListPrefs`, `listBodyState`, …).

Default sorts (spec): Shows `date-desc` (show date, then updatedAt); Songs `added-desc` (createdAt; fallback updatedAt for songs without createdAt); Designs `edited-desc`; Slides decks `name-asc`; others `name-asc`.

Users: `/shows` (P1.12), `/songs` (P1.13), `/design` Graphics + Stage layouts (P1.14), `/hotcards` (P1.15), `/projects` (P2b.29), Live show picker (P2a.16), `/slides` (P3.14). `EntityList` and `ManagementList` are deleted (P1.16, after P2b.29).

## 4. Sections (core `packages/core/src/show.ts`, `sections.ts`) — owner P1.17, P1.18

```ts
ShowSection = { id: string; name: string }
Show.sections?: ShowSection[]            // display order of sections
RundownRow.sectionId?: string            // every row kind incl. SlidesRow; undefined = "no section" (rendered before the first section)
RowSourceRef.pcoArrangement?: string[]   // arrangement a PCO import last set on a song row (P1.17 adds; P2b.27 uses)
```
Invariant: every helper that returns a `Show` returns `rows` in **display order** (the concatenation of `groupRowsBySection` groups), never mutates its input, and returns the same object when nothing changes. A section's members are the rows with its id, in `rows` order. Live's "next row" and Companion's row indexes therefore match what the operator sees.

Helpers in `packages/core/src/sections.ts`:
- `groupRowsBySection(show): { section: ShowSection | null; rows: RundownRow[] }[]` — the `null` group first (rows with no `sectionId` or an unknown one), then every section in order, empty ones included.
- `orderRowsBySection(show): Show`
- `moveRow(show, rowId, toSectionId: string | null, toIndex: number): Show` — `toIndex` is the index inside the target section after removal.
- `insertRow(show, row, toSectionId: string | null, toIndex: number): Show`
- `addSection(show, name, afterSectionId?: string | null, id?: string): { show: Show; section: ShowSection }` — `undefined` = append, `null` = first.
- `renameSection(show, id, name): Show`
- `deleteSection(show, id, mode: "keep-rows" | "delete-rows"): Show`
- `moveSection(show, id, toIndex): Show`
- `sectionLength(rows): number | null` (sum of `lengthSec`, null if none have one).

Schema: every row and show schema is a strict `z.object` whose **type** is exported, and whose exported **schema** is `.passthrough()` (P1.17 pattern; P3.8's `SlidesRowSchema` follows it), so an older client can't strip `sections`/`sectionId`/future fields on re-save.

PCO headers: `pcoSectionId(itemId) = "pco-" + itemId`; `planHeaderSections(items)`, `mergePlanSections(existing, plan, keep)` (P1.19, `packages/core/src/pco/headerSections.ts`). Migration: `migrateHeaderRows(show: Show, headers: ReadonlyMap<string, string> /* PCO itemId → title */): { show: Show; changed: boolean }` — only item ids Planning Center reports as `itemType: "header"` convert. The server fetches each plan's items once (cache `data/pco/plan-headers.json`) and runs the migration at load and when PCO becomes available, writing `<file>.pre-sections.bak` once per changed show (P1.20). Re-import maps headers to sections (P1.19). `ImportPlanResult.counts` gains `sections` and `headerRowsConverted`.

## 5. Thumbnails — owner P1.10

`packages/ui` stays render-agnostic. `apps/operator/src/lib/thumbnails/`:
- `TemplateThumbnail({ templateId: string; data: Record<string,string>; width: number; label?: string })` — mounts the template engine statically at its final frame, scaled, lazily on first intersection; memoised per `thumbKey`.
- `useTemplateBody(templateId): { template: Template | null; status: "loading" | "ready" | "missing" }`
- `sampleData(template: Pick<Template,"fields">): Record<string,string>`
- `thumbKey(templateId, data, updatedAt?): string`

Used by the Designs grid (P1.14), show editor preview (P2a.18), Live thumbnail strip (P2a.13), song editor and slide grid (P2a.19/20), hotcard preview (P2b.25), deck editor (P3.15).

## 6. Slides decks (core) — owner P3

```ts
// packages/core/src/deck.ts (P3.1)
DeckLicensing = { kind: "ccli"; ccliNumber?: string } | { kind: "public-domain" } | { kind: "own" }   // exactly these
DeckSlide = { id: string; templateId?: string /* override */; data: Record<string,string>; label?: string }   // .passthrough()
Deck = { id; name; tags: string[] /* default [] */; defaultTemplateId: string; licensing: DeckLicensing;
         slides: DeckSlide[]; createdAt: string; updatedAt?: string; deletedAt?: string; convertedFromSongId?: string }   // .passthrough()
DeckMeta = { id; name; tags; slideCount; licensing: DeckLicensing["kind"]; usedBy: number; createdAt; updatedAt? }
SlidesRowFields = { kind: "slides"; id; deckId?: string; slideIds?: string[] /* subset/order, repeats allowed */;
              templateId?: string /* row override */; fieldOverrides?: Record<string /*slideId*/, Record<string,string>>;
              localSlides?: DeckSlide[] /* one-off, no deck */; channelHint?: string; notes?: string; sermonNotesId?: string;
              lengthSec?: number; lengthSecManual?: boolean; sectionId?: string; stageLayouts?: Record<string, string> /* §16 */; sourceRef?: RowSourceRef }
// packages/core/src/show.ts (P3.8, additive in P1's file): SlidesRowSchema joins the RundownRow union; type SlidesRow ≡ SlidesRowFields
// packages/core/src/slides.ts (P3.1)
ResolvedSlide = { key: string; slideId: string; position: number; templateId: string; data: Record<string,string>; label?: string }
SlidesRowView = { title: string; detail: string; slides: ResolvedSlide[]; missingDeck: boolean; missingSlides: number;
                  licensing: DeckLicensing["kind"] | null }
resolveSlideTemplateId(slide, row, deck): string            // "" when nothing resolves
resolveSlidesRow(row, deck): { slides: ResolvedSlide[]; missingSlides: number }
slidesRowView(row: SlidesRowFields, deck: Deck | null | undefined): SlidesRowView
   // deck null → { title: "Missing deck", detail: "Deck deleted or not synced", missingDeck: true }
   // deck undefined with a deckId → { title: "Slides deck", detail: "Loading…", slides: [], missingDeck: false } (not loaded yet)
slideTextLines(data, template?): string[]; deckTextToSlides(text, fieldKey, newId): DeckSlide[]
SlidesSessionSummary = { rowId; deckId?; title; slideIdx; slideCount; label?; lines: string[]; nextLines?; nextLabel?; blanked: boolean; atEnd: boolean }
SLIDES_END_OF_DECK = "End of deck · Space again to clear"
ChannelState.slidesSession?: SlidesSessionSummary            // packages/core/src/channel.ts (P3.5)
```
Template precedence: `slide.templateId → row.templateId → deck.defaultTemplateId`. Only `licensing.kind === "ccli"` decks write CCLI usage, and only on non-preview takes.

Converted songs carry `customFields.converted_to_deck = <deckId>` and the deck carries `convertedFromSongId`; `convertedDeckId(song): string | null` (P3.12, `packages/core/src/slidesConvert.ts`).

PCO mappings: `PcoItemMapping = { id /* = key */; key: "pcoSong:<id>" | "title:<normalised>"; kind: "slides"; deckId; templateId?; updatedAt; deletedAt? }`; `normalizePcoTitle` keeps numbers; `pcoSong:` beats `title:` (P3.2).

Wire protocol (P3.4, additive in `packages/ws-protocol/src/index.ts`): `list_decks`, `get_deck`, `save_deck`, `delete_deck`, `restore_deck`, `duplicate_deck`, `slides_take { showId; rowId; slideIdx?; channel? }`, `slides_advance { channel; delta: -1|1 }`, `slides_goto`, `slides_blank`, `slides_end`, `convert_song_to_deck`, `undo_convert_song`; server → `deck_list`, `deck`, `song_converted`, `song_convert_undone`.

## 7. Shared operator helpers — owner P1 (others import, never re-create)

| Module | Exports | Task |
|---|---|---|
| `apps/operator/src/lib/awaitAck.ts` | `type AckClient = { send(m: ClientMessage): void; on(l: (m: ServerMessage) => void): () => void; onStatus(l: (s: WsStatus) => void): () => void; getStatus(): WsStatus }` (`getClient()` from `lib/wsClient` satisfies it); `class AckError extends Error { code: "not_connected" \| "timeout" \| "disconnected" \| "server_error" }`; `sendAndAwaitAck(client: AckClient, message: ClientMessage, match: { op: string; id?: string }, o?: { timeoutMs?: number /* 8000 */ }): Promise<void>`; `requestOne<T>(client, message, pick: (m: ServerMessage) => T \| undefined, o?: { timeoutMs?: number /* 5000 */ }): Promise<T>`; `ackErrorText(e: unknown): string` ("Not connected to the server." / "The server didn't confirm in time." / "Disconnected before the server confirmed." / the server's message). Failure toast copy everywhere: `` `Not saved: ${ackErrorText(e)}` ``. | P1.6 |
| `apps/operator/src/lib/useConnection.ts` | `useConnection(): { connected: boolean; conn: WsStatus; retry(): void }` — `connected = isCloudMode() \|\| conn === "open"`, `retry = getClient().reconnectNow()`. | P1.6 |
| `packages/ui` `OfflineState`, `offlineCopy` | §2 | P1.6 |
| `apps/operator/src/lib/useUnsavedGuard.ts` | `useUnsavedGuard(dirty, opts?: { …; onSave?: () => Promise<boolean>; resetKey? })` on the app dialog (Stay / Discard changes / Save and leave) | P1.7 |
| `apps/operator/src/lib/templateRoles.ts` | `type TemplateUse = "graphic" \| "lyric" \| "scripture" \| "title"`; `templateRole(meta: Pick<TemplateMeta, "name" \| "role">): TemplateUse \| "other"` (explicit `role` wins; else `/^old\b/i` → other, `/lyric/i` → lyric, `/scripture\|verse/i` → scripture, `/intro\|title\|outro/i` → title, else graphic); `templatesFor<T extends Pick<TemplateMeta, "id" \| "name" \| "role">>(metas: T[], use: TemplateUse, recentIds?: string[]): { suggested: T[]; others: T[] }` (suggested: recent ids first, then by name; others by name; nothing dropped). | P1.8 |
| `apps/operator/src/lib/listFormat.ts` | `formatServiceDate`, `formatDuration`, `formatRelative`, `plural` | P1.11 |
| `apps/operator/src/lib/exportName.ts` | `exportFileName(kind: "show" \| "song" \| "template" \| "hotcard", item: { name?; title?; ccliNumber?; id }): string` — the only export-name helper (song: `"<Title> (CCLI n).json"` / `"<Title>.json"`). | P1.11 |
| `apps/operator/src/app/components/PageShell.tsx` | `PageBody({ variant?: "form" \| "wide" \| "list"; maxWidth?; padding?; children })` — form max 760, wide max 1100, list full width; all left-aligned (no auto margins), padding 24, flex column gap 16; an explicit `maxWidth` wins. This is the one page width model (no `PageFrame`). | P1.1 |
| `apps/operator/src/app/shell/PageChrome.tsx` | `PageChrome({ title?, docTitle?: string, context?, actions? })`; `composeDocTitle(docTitle?, title?): string` → `"<x> · OverlaySys"`; sets `document.title`. | P2b.2 (shell owner) |

## 8. Template usage, roles and create routes — owner P2b

- Server `server/src/templateUsage.ts` (P2b.12): `type TemplateUsage = { shows: { id: string; name: string }[]; hotcards: { id: string; name: string }[]; songs: { id: string; title: string }[]; scriptureDefault: boolean; protected: boolean }`; pure `templateUsage(id, d: { shows; hotcards; songs; scripture }): TemplateUsage` — counts graphic/scripture row `templateId`, song row and `ShowSong` `lyricTemplateId`/`introTemplateId`/`outroTemplateId`, hotcards, song library defaults, scripture settings; ignores tombstones. `PROTECTED_TEMPLATE_IDS = ["lyric-default"]`.
- Route `GET /api/templates/:id/usage` in `server/src/templateRoutes.ts`, `registerTemplateRoutes(app)` (also hosts the draft-preview routes, P2b.11).
- Client `apps/operator/src/app/design/edit/templateUsage.ts`: `fetchTemplateUsage(id): Promise<TemplateUsage | null>` (null in cloud mode or on failure); `templateDeleteConfirm(name: string, u: TemplateUsage | null): { blocked: boolean; title: string; message: string; confirmLabel: string }`. Used by the designer header (P2b.12) and the Designs list (P1.14).
- `TemplateSchema.role?: "graphic" | "lyric" | "scripture" | "title"` (schema P1.8); the "Used for" select in the designer's Template tab sets it (P2b.9).
- Create routes (the list pages navigate; the editors implement): `/hotcards/edit?new=1` (P2b.25), `/design/stage/edit?new=1` (P2b.17), `/songs/edit?id=<id>&paste=1` (P2a.20 reads `paste=1`), `/slides/edit?id=<id>` (P3.15). "New template" stays plan 1's `NewTemplateDialog` (P1.14).
- Draft preview (P2b.11): `DRAFT_PREFIX = "__draft__"`, `isDraftTemplateId(id)`; a draft template can only ever be on `preview` (guard in `channels.ts`).

## 9. Slide editor pieces and the slides adapter — owner P2a (adapter bodies: P3)

Deck-mode pieces, `apps/operator/src/app/songs/edit/slides/index.ts` (P2a.19). Plan 3 imports them from `@/app/songs/edit/slides`:
```tsx
type SlideCard = { id: string; templateId: string | null; data: Record<string, string>; caption?: string; group?: { label: string; color: string } | null; badge?: string };
function SlideThumbGrid(p: { slides: SlideCard[]; selectedId: string | null; onSelect(id: string): void;
  onReorder?(from: number, to: number): void; onAdd?(): void; addLabel?: string; menuItems?(id: string): MenuItem[];
  minCardWidth?: number /* 200 */; emptyText?: string }): JSX.Element;
type SlideField = { key: string; label: string; multiline?: boolean };
function slideFieldsFor(template: Pick<Template, "fields"> | null | undefined): SlideField[];
   // template text fields → multiline; time/number → single line; color/image/video are not SlideFields
function SlideTextEditor(p: { heading: string; fields: SlideField[]; value: Record<string, string>;
  onChange(next: Record<string, string>): void; budget?: SlideBudget; autoFocus?: boolean }): JSX.Element;   // multi-field
function EditorFrame(p: { header: ReactNode; left: ReactNode; main: ReactNode; right?: ReactNode;
  leftWidth?: string /* "26%" */; rightWidth?: string /* "300px" */ }): JSX.Element;
const sectionKindColor: Record<SectionKind, string>;      // no red/green
function sectionChipTextColor(bg: string): string;
```
Songs use `fields=[{ key: "text", label: "Lyrics", multiline: true }]`. Decks use plan 3's `DeckSlideFields` (`apps/operator/src/app/slides/edit/DeckSlideFields.tsx`, P3.15): `SlideTextEditor` over `slideFieldsFor(template)` plus the existing `lib/FieldInput.tsx` for the remaining (image/colour/video) fields.

Slides adapter `apps/operator/src/lib/slidesRowView.ts` — created with stub bodies by P2a.2; ownership passes to P3 at P3.13, which replaces the bodies and keeps every signature. `RowLike` and `AirState` come from P2a (`lib/rowLike.ts`, `lib/rowAirState.ts`); `Deck`, `SlidesRowView` from `@overlaysys/core` (P3.1).
```ts
export const slidesAddItemEnabled: boolean;                                           // stub false
export function useDeckCache(): Record<string, Deck>;                                 // stub: frozen {}  → P3: useStore(s => s.deckCache)
export function useDeckFor(row: RowLike): Deck | null | undefined;                    // stub undefined   → P3: useDeck(row.deckId)
export function slidesRowViewFor(row: RowLike, deck: Deck | null | undefined): SlidesRowView | null;   // stub null → P3: core slidesRowView for kind "slides"
export function slidesAirState(row: RowLike, channelStates: Record<string, ChannelState>): AirState;  // stub null
export function slidesThumbState(row: RowLike, position: number, channelStates: Record<string, ChannelState>): "live" | "cued" | null; // stub null
export function slidesThumbMessages(showId: string, row: RowLike, position: number, target: "preview" | "program-live"): ClientMessage[] | null; // stub null
export function slidesRowTakeMessages(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage[] | null; // stub null; cue → preview, take → row.channelHint ?? "program"
export function slidesStripNotice(row: RowLike, view: SlidesRowView, channelStates: Record<string, ChannelState>): string | null; // stub null → P3: SLIDES_END_OF_DECK / missing deck / skipped slides
export function slidesKeyChannel(channelStates: Record<string, ChannelState>): "program" | null;      // stub null
export function slidesAdvanceMessage(delta: 1 | -1): ClientMessage | null;                            // stub null
export function slidesBlankMessage(): ClientMessage | null;                                           // stub null (B while keyMode is "slides")
```
No `slidesPvwTakeMessages`: the server's `takePvwToPgm` carries a slides session (P3.5), so the generic `take_pvw_to_pgm` is right.

Show-editor slot `apps/operator/src/app/shows/edit/forms/SlidesItemForm.tsx` — created as a placeholder by P2a.18; ownership passes to P3 at P3.16:
```tsx
function SlidesItemForm(p: ItemFormProps<RowLike>): JSX.Element;          // placeholder "Slides decks aren't available yet" → P3: <SlidesRowInspector>
function SlidesAddFlow(p: { open: boolean; onClose(): void; onAdd(row: RowLike): void }): JSX.Element | null;  // placeholder null → P3: DeckPicker + "One-off slides for this show"
```
The show editor's `+ Add item` menu shows "Slides" (disabled with reason "Needs Slides decks" while `slidesAddItemEnabled` is false, and "Coming soon" while `slidesAddFlowReady` — exported from `SlidesItemForm.tsx`, added by P2a.17 fix1 — is false; P3.16 sets it true) and opens `SlidesAddFlow`.

`ItemFormProps` lives in `apps/operator/src/app/shows/edit/forms/types.ts` (P2a.18 fix1): `type ItemFormProps<R> = { row: R; show: Show; onChange(next: R): void }`. `onChange` receives the whole edited row (same id, unknown keys kept). P3.16 imports it from there for `SlidesItemForm` and drops the placeholder's local `SlidesItemFormProps`.

## 10. Live palette commands — owner P2a

`apps/operator/src/lib/liveCommands.ts` (P2a.16):
```ts
type PaletteCommand = { id: string; label: string; group: "On air"; keywords: string[];
  confirm: { title: string; message: string; confirmLabel: string }; messages(): ClientMessage[] };
function liveCommands(s: { channelStates; hotcards: HotcardMeta[]; hotcardCache: Record<string, Hotcard>; currentProjectId: string; show: Show | null }): PaletteCommand[];
```
Ids: `take-pvw` "Take preview to program", `clear-program` "Clear program", `clear-preview` "Clear preview", `clear-all` "Clear all outputs", `hotcard-cue:<id>` "Cue hotcard <name>" (→ preview), `hotcard-take:<id>` "Take hotcard <name>" (→ `hotcardRoute(hint, "take")`); current project only; every one has a `confirm` (D17c). The command palette (P2b.24) maps them into `PaletteEntry` extras with `toPaletteEntry(cmd, send)`, runs `confirm` before sending, and adds none in cloud mode. The palette defines no on-air verbs of its own.

## 11. List metadata — owner P1.8

`show_list` items `updatedAt?`, `totalLengthSec?`; operator `ShowMeta` gains `scheduledFor?`, `updatedAt?`, `totalLengthSec?`; `TemplateMeta` = `Pick<Template, "id" | "name" | "size" | "defaultChannel" | "role" | "updatedAt">`; `StageLayoutMeta.updatedAt?`; `Song.createdAt?` and `SongMeta.createdAt?`; song library rows `createdAt?`, `lastUsed?`. `createdAt` is stamped only for new ids (decks follow the same rule).

## 12. Cloud sync — owner P3.6, P3.7

New sync entities `decks` and `pcoItemMappings` (JSON-payload tables `overlaysys.decks`, `overlaysys.pco_item_mappings`, in `OPTIONAL_TABLES`). New cloud columns `overlaysys.shows.extra jsonb` (every show-level field other than the columned ones: `sections`, `songs`, `scheduledFor`, `sermonNotes`, future keys) and `overlaysys.hotcards.hotkey text` (`"F1".."F12"`, `"none"` = deliberately unassigned). A missing table or column is skipped quietly (one `console.info` per process). Helpers `isMissingTableError`, `isMissingColumnError`, `showExtra`, `hotkeyToColumn`, `hotkeyFromColumn` (`packages/supabase/src/optionalColumns.ts`); `keepLocalSections` (`server/src/fsStorageAdapter.ts`). Migrations are written to `docs/cloud-slides-sync-migration.md` and never applied from this repo.

## 13. Naming

- Library page and nav: **"Designs"** (spec Goals 4), tabs "Graphics" and "Stage layouts"; one item is a "template" ("New template", "Delete template?"). This supersedes D11's "Templates" page name. P1.14's page title and P2b.22's nav label use "Designs".
- Slides: page "Slides", items "decks" ("New deck"), row kind label "Slides" in add menus.
- Live tab and page title "Live". Verbs Cue / Take / Clear. "Sermon notes", "Speech-to-text", "Auto-advance (STT)".
- Nav order in Library (P2b.22 `areas.ts`): Shows, Songs, Slides, Designs, Hotcards, Planning Center.

## 14. Companion — owner P2b.30–32

Action, feedback and option ids are never renamed. P2b.34 adds action `set_stage_layout` and variables `<c>_stage_layout`, `<c>_stage_layout_reason` (§16). Reserved for P3.21: action ids `slides_advance`, `slides_blank`, `slides_end`; feedback `slides_on_air`; variables `<c>_slides_deck`, `<c>_slide_n`, `<c>_slide_count`. HELP.md tables are regenerated with P2b.32's `gen:help`.

## 16. Stage screens choose their layout dynamically (spec section of the same name; controller addition approved by the owner)

| Piece | Owner |
|---|---|
| Schema and pure resolver (`packages/core/src/stageLayoutRules.ts`, `channelConfig.ts`, `show.ts`) | P1.22 |
| Server resolution, manual override state, protocol, broadcast | P2b.33 |
| Settings → Channels default + type rules editor | P2b.18 |
| Live drawer (layout + reason + picker per stage screen) and the row editors' "Stage screens" section | P2a.22 |
| "Stage screens" on slides rows | P3.22 |
| Companion action and variables | P2b.34 |

```ts
type StageRuleKind = "song" | "scripture" | "slides" | "graphic" | "video";
ChannelConfig.layoutId?: string                                   // stage: now the screen's DEFAULT layout (meaning unchanged)
ChannelConfig.layoutRules?: Partial<Record<StageRuleKind, string /* layoutId */>>
<every row kind>.stageLayouts?: Record<string /* stage channel id */, string /* layoutId */>   // item override, incl. SlidesRow
type StageLayoutReason = "manual" | "item" | `rule:${StageRuleKind}` | "default";
resolveStageLayout(i: { manual?: string | null; rowOverride?: string; rules?: ChannelConfig["layoutRules"];
  default?: string; liveRowKind?: string | null }): { layoutId: string | undefined; reason: StageLayoutReason }
  // precedence: manual > item > type rule > default; empty strings are unset
type StageLayoutStatus = { channel: string; layoutId: string | undefined; reason: StageLayoutReason; manual: string | null };
// protocol (P2b.33): client { type: "set_stage_layout"; channel: string; layoutId: string | null }  (null = automatic)
//                    server { type: "stage_layout_status"; screens: StageLayoutStatus[] }  (on connect and on change)
```
- The manual override is in-memory server state per stage channel (`server/src/stageLayoutOverride.ts`), cleared when the output that screen follows takes a row with a different `liveRow` id; slide/section changes inside the same row don't clear it.
- `stageFeedHub` resolves with `resolveStageLayout`, then loads the layout with `stageLayouts.loadStageLayout(id)` — P2b.33 renames the server's existing id→layout loader from `resolveStageLayout` so the two names never collide. A designer preview (`stage_layout_preview`) still wins over everything.
- Migration: none needed. A stored stage config keeps `layoutId` as its default and has no `layoutRules`, so nothing changes until rules are added.
- Operator: `useStageLayoutStatus()`, `reasonLabel`, `setStageLayoutMessage` (`apps/operator/src/lib/stageLayoutStatus.ts`) and `StageScreensField` (`apps/operator/src/app/shows/edit/forms/StageScreensField.tsx`), both P2a.22; plan 3's slides inspector reuses `StageScreensField`.

## 15. Resolution log (proposals → decisions)

| Proposal | Decision |
|---|---|
| `awaitAck` / `useConnection` proposed by P2a.6 and P2b.1/P2b.3 | One owner: P1.6 (runs earliest). Names in §7: `sendAndAwaitAck`, `requestOne`, `AckError`, `ackErrorText`, `useConnection`. P2a.6 moved to P1.6/P1.8; P2b.1 and P2b.3 consume. `match.id` is optional (STT config has no id). |
| `OfflineState` (P1.6 and P2b.1) | P1.6 in `packages/ui`, with P2b's `variant` and copy (`offlineCopy`). |
| `PageFrame` (P2b.2) vs `PageBody variant` (P1.1) | `PageBody variant: "form" \| "wide" \| "list"` (P1.1) with P2b's widths (760 / 1100 / full) and 24 px padding. `PageFrame`/`pageFrame.ts` are not created. `docTitle` stays with P2b.2. |
| `templatesFor` / `inferTemplateRole` (P2a.6) vs `templatesFor` / `templateRole` (P1.8) | P1.8, generic over `T` with `recentIds?` (from P2a). Name `templateRole`. |
| `songExportFileName` (P2a.8) vs `exportFileName` (P1.11) | `exportFileName("song", song)` only. |
| `FileDrop` + `acceptsFile(name, accept: string[])` (P2b.28) vs P1.3 | P1.3's `packages/ui` `FileDrop`, `acceptsFile(name, mime, accept: string)`. P2b.28 and P2a.21 use it. |
| editor-kit `roundTo` / `formatNumber` (P2b.4) vs P1.3 | P1.3 owns; editor-kit `numberFormat.ts` re-exports. Half-away-from-zero rounding moves into P1.3's tests. |
| NumberInput `precision` (P2b) | Added to P1.3. |
| Template usage: P1.14 (`templateUsage.ts`, `templateUsageRoute.ts`, `templateUsageClient.ts`) vs P2b.12 | P2b.12 owns (runs earlier, richer shape, protected ids). P1.14 consumes `fetchTemplateUsage` + `templateDeleteConfirm`; it creates no server file and adds no `index.ts` line. |
| Slide editor pieces: P2a.19 (`EditorFrame`, `SlideThumbGrid`, `SlideTextEditor`, `sectionKindColor`) vs P3 C5 (`EditorFrame`, `SlideThumbList`, `SlideFieldsEditor`, path `songs/edit/components`) | P2a's names and path. `SlideTextEditor` is multi-field; P2a adds `slideFieldsFor(template)` and `EditorFrame.right`. P3 owns `DeckSlideFields` built on them. |
| `slidesRowView` placeholder (P2a.3 stub in `lib/slidesRowView.ts`) vs P3 C4 (core `slidesRowView`) | Core `slidesRowView(row, deck)` is P3.1's; the operator adapter in `lib/slidesRowView.ts` uses distinct names (`slidesRowViewFor`, …) and imports core types (P2a.2 waits for P3.1). Signatures in §9. `slidesPvwTakeMessages` dropped. |
| `SlidesItemForm.tsx` handoff | §9; adds `SlidesAddFlow` so P3 never edits P2a's show-editor page. |
| P1: `migrateHeaderRows(show, headers)` | Accepted (§4). |
| P1: section helpers keep display order; `orderRowsBySection`, `insertRow`, `moveSection`; `addSection` returns `{ show, section }` | Accepted (§4). P2a's song-draft op is renamed `addSongSection` so it never shadows core `addSection`. |
| P1: LibraryList `headerActions` | Accepted (§3). |
| P1: `--text-dim #aaaab0`, `--text-muted #98989e` and the extra tokens | Accepted (§1). |
| P1: list-meta fields | Accepted (§11). |
| P2b: `RowSourceRef.pcoArrangement` | Assigned to P1.17 (owner of `show.ts`). |
| P2b: delete-usage helper and `?new=1` routes for P1's lists | §8. P1.14 waits for P2b.12 and P2b.17; P1.15 waits for P2b.25. |
| P2b: "Designs" naming | Accepted (§13). |
| P2b: one-line edits in unowned files (`server/src/index.ts`, `templates.ts`, `channels.ts`, shell components, `timer/page.tsx`) | Shared-file rule (execution-order doc): additive, marked, merge order fixed. Shell components and `timer/page.tsx` are assigned to P2b. |
| P2b: palette on-air verbs (P2b.24) vs `liveCommands` (P2a.16) | P2a owns the verbs (§10); P2b.24 maps them. |
| P3 C1–C3 (DeckSlide `label`, Deck `convertedFromSongId`, SlidesRow `channelHint`/`lengthSecManual`) | Accepted (§6). |
| P3 C4 adapter | Revised as §9. |
| P3 C5 deck-mode components | Renamed to P2a's (§9). |
| P3 C6 `/slides` nav slot | P2b.22 adds the entry itself (owner of `areas.ts`); P3.14 doesn't edit `areas.ts`. The /pco mount is `pco/importOptions.ts` + `pco/PcoItemRow.tsx` (P2b.26 files). Companion ids reserved (§14). |
| P3 C7 shared server files | Shared-file rule and merge order (execution-order doc). P3.3 also adds `reloadDecks()`/`reloadItemMappings()` to `server/src/index.ts` (was missing). |
| P3 C8 converted pointer | Accepted (§6); P3.20 makes the mount edit in P2a's song editor and P1's songs list (`songs/page.tsx`, not a P2a file). |
| P3 `slidesSession` channel field, cloud `shows.extra` | Accepted (§6, §12). |
| `importPlan.ts` edited by P1.19, P2b.27, P3.11 | Merge order P1.19 → P2b.27 → P3.11. |
| `packages/core/src/index.ts` | Append-only: one export line per new module. |
| Controller addition: stage screens choose their layout dynamically | §16; core P1.22, server P2b.33, settings P2b.18, Live and row editors P2a.22, slides rows P3.22, Companion P2b.34. Core function keeps the requested name `resolveStageLayout`; the server's existing loader of that name becomes `loadStageLayout`. |
| `/projects` still on `ManagementList` | P2b.29 converts it to `LibraryList`; P1.16 then deletes `EntityList` and `ManagementList` (no adapter). |
| P2a.18 additive props on its show-editor pieces (recorded in fix1) | All optional. `SongPickerDialog` `single?` (click/Enter picks one), `recentIds?`, `title?`. `TemplateSelect` `emptyLabel?` (empty first option), `style?`; a `""` value shows as "None". `ItemCommonFields` `outputHint?`. `ScriptureRowModal` `changePassageOf?: ScriptureRow` (opens at step 1, title "Edit scripture"; the caller keeps id/length/notes via `applyPassage`). `VideoRowModal.tsx` also exports `TransitionField` and `probeDuration`. `ItemFormProps` in `forms/types.ts` (§9). |
| `VideoInput` `resolveUrl` (packages/editor-kit, P2b-owned) | P2a.18 added `resolveUrl?: (v: string) => string` (preview `<video src>` only; the field still shows `value`) in a marked `[P2a.18]` block. Controller ruling: it stays; P2b.9 keeps it and only adds the lucide `FolderOpen` icon. |
