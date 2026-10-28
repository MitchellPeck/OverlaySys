# Redesign shared contracts (plans 1–3)

Spec: `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md`.
The four plans — `2026-10-28-redesign-1-foundation.md`,
`…-2a-live-shows-songs.md`, `…-2b-designers-settings-library.md`,
`…-3-slides-sync.md` — must use exactly these names. Plan 1 creates
everything in §1–§5; plans 2a, 2b and 3 consume them. A plan that needs a
change to a contract edits this file in the same commit and says so.

## 1. Tokens (`packages/ui/src/tokens.ts`, `apps/operator/src/app/globals.css`)

CSS variables (values are starting points from the spec; plan 1 may tune
while keeping `contrast.test.ts` AA rules passing):

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
| `--text-dim` | `#a0a0a6` | `textDim` |
| `--text-muted` | `#8e8e94` | `textMuted` |
| `--accent` | `#4f7cff` (selection / primary) | `accent` |
| `--onair` | `#e5484d` (program / live) | `onair` |
| `--ok` | `#30a46c` (preview / next) | `ok` |
| `--warn` | `#f5b942` | `warn` |
| `--danger` | `#e5484d` | `danger` |

Item-kind colours, exported as `kindColor: Record<ItemKind, string>` with
`type ItemKind = "graphic" | "song" | "slides" | "scripture" | "video" | "section"`:
graphic `#60a5fa`, song `#f5b942`, slides `#34d399`, scripture `#f472b6`,
video `#a78bfa`, section `#8e8e94`.

Existing token keys keep working (aliases) until plans 2a/2b remove their users.

## 2. UI kit components (`packages/ui/src/*`, exported from `index.ts`)

- `Button` — `variant: "primary" | "secondary" | "ghost" | "danger" | "onair"`, `size: "sm" | "md"`, plus native props. (`onair` = red Take.)
- `IconButton` — requires `aria-label`.
- `Input`, `Textarea`, `Select` (restyled, same props as today).
- `NumberInput` — `{ value: number; onCommit(v: number): void; min?; max?; step?; int?: boolean; suffix?: string }`; draft text, commits on blur/Enter, Esc reverts.
- `SegmentedControl<T extends string>` — `{ value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange(v: T): void; size? }`.
- `Switch` — `{ checked; onChange(b); label? }`; `Checkbox` same shape.
- `Menu` — `{ items: MenuItem[]; anchor: { x: number; y: number } | HTMLElement; onClose(): void }`, `type MenuItem = { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean | string /* reason → tooltip */; shortcut?: string; onSelect(): void } | { separator: true }`. Keyboard: arrows, Enter, Esc.
- `useContextMenu()` → `{ open(e: React.MouseEvent | HTMLElement, items: MenuItem[]): void; menu: ReactNode }`.
- `Dialog` + `useConfirm()` → `confirm({ title, message, confirmLabel, danger? }): Promise<boolean>` (replaces `window.confirm` everywhere incl. `useUnsavedGuard`).
- `Toast` + `useToast()` → `toast({ message, tone?: "info" | "ok" | "warn" | "error", action?: { label; onClick } })`.
- `Tooltip` — `{ content: ReactNode; children }`.
- `KindBar` — `{ kind: ItemKind }` thin 3px vertical bar.
- `SaveBar` — `{ dirty: boolean; saving: boolean; onSave(); onRevert(); disabledReason?: string }` (unsaved dot + Revert + Save ⌘S) — used by every editor and settings page.

## 3. Shared library list (`packages/ui/src/LibraryList.tsx`)

```ts
type SortSpec<T> = { id: string; label: string; compare(a: T, b: T): number };
type FilterSpec<T> = { id: string; label: string; options: { value: string; label: string }[]; test(item: T, value: string): boolean };
type Column<T> = { id: string; label: string; width?: string; render(item: T): ReactNode; align?: "left" | "right" };
type LibraryListProps<T> = {
  items: T[];
  getId(item: T): string;
  primary(item: T): ReactNode;          // name (line 1)
  secondary?(item: T): ReactNode;       // muted line 2
  kind?(item: T): ItemKind;             // KindBar
  columns?: Column<T>[];
  searchText(item: T): string;          // haystack for search
  sorts: SortSpec<T>[];
  defaultSort: string;                  // SortSpec id
  filters?: FilterSpec<T>[];
  menuItems(item: T): MenuItem[];       // context menu + "⋯" button
  onOpen(item: T): void;                // click / Enter
  primaryAction?: { label: string; onClick(): void; disabledReason?: string };
  views?: { grid?: { renderCard(item: T): ReactNode; minCardWidth?: number } }; // enables list/grid toggle
  storageKey: string;                   // persists sort/filter/view per page
  emptyState: { title: string; body?: string; action?: { label: string; onClick(): void } };
  loading?: boolean; error?: string | null;
};
```
Full width; no hover-only actions; keyboard ↑/↓, Enter opens, typing focuses search; right-click and "⋯" open the menu.

Default sorts (spec): Shows `date-desc` (show date, then updatedAt); Songs `added-desc` (createdAt; fallback updatedAt for songs without createdAt); Designs `edited-desc`; others `name-asc`.

## 4. Sections (core `packages/core/src/show.ts`)

```ts
ShowSection = { id: string; name: string }
Show.sections?: ShowSection[]            // display order of sections
RundownRow.sectionId?: string            // every row kind; undefined = "no section" (rendered before the first section)
```
Row order in `Show.rows` stays authoritative; a section's members are the rows with its id in `rows` order; moving a row between sections changes `sectionId` (and its position in `rows`). Helpers in `packages/core/src/sections.ts`:
`groupRowsBySection(show): { section: ShowSection | null; rows: RundownRow[] }[]`, `moveRow(show, rowId, toSectionId: string | null, toIndex: number): Show`, `addSection(show, name, afterSectionId?)`, `renameSection`, `deleteSection(show, id, mode: "keep-rows" | "delete-rows")`, `sectionLength(rows): number | null` (sum of `lengthSec`, null if none have one).

Show schema must pass unknown keys through (`.passthrough()` on Show and every row schema) so an older client can't strip `sections`/`sectionId`/future fields on re-save.

PCO header migration: `migrateHeaderRows(show): { show; changed: boolean }` turns PCO-sourced graphic rows that came from header items into sections (rows after a header get its `sectionId`). Server runs it once at load with a backup copy of each changed show file (`<file>.pre-sections.bak`). Re-import maps headers to sections.

## 5. Thumbnails

`packages/ui` stays render-agnostic. Plan 1 adds `apps/operator/src/lib/thumbnails/TemplateThumbnail.tsx`:
`{ templateId: string; data: Record<string,string>; width: number }` — mounts the template engine statically at its final frame, scaled; memoised per (templateId, data hash). Used by Designs grid, show editor preview, Live thumbnail strip, song/deck editors.

## 6. Slides decks (plan 3 owns; plan 2a leaves a slot)

```ts
Deck = { id; name; tags: string[]; defaultTemplateId: string; licensing: { kind: "ccli"; ccliNumber?: string } | { kind: "public-domain" } | { kind: "own" };
         slides: DeckSlide[]; createdAt; updatedAt; deletedAt? }
DeckSlide = { id: string; templateId?: string /* override */; data: Record<string,string> }
SlidesRow = { kind: "slides"; id; deckId?: string; slideIds?: string[] /* subset/order, repeats allowed */;
              templateId?: string /* row override */; fieldOverrides?: Record<string /*slideId*/, Record<string,string>>;
              localSlides?: DeckSlide[] /* one-off, no deck */; sectionId?; notes?; lengthSec?; sourceRef?; sermonNotesId? }
```
Template precedence: slide.templateId → row.templateId → deck.defaultTemplateId.
Plan 2a's Live thumbnail strip and rundown render `kind: "slides"` rows through a `slidesRowView(row, deck)` adapter that plan 3 provides; plan 2a renders a placeholder until it exists.
