# Redesign execution order (plans 1, 2a, 2b, 3)

**Inputs:** spec `docs/superpowers/specs/2026-10-28-ui-redesign-and-slides-design.md`; contracts `2026-10-28-redesign-contracts.md` (the single source of truth for names, signatures and owners); plans `…-1-foundation.md` (P1), `…-2a-live-shows-songs.md` (P2a), `…-2b-designers-settings-library.md` (P2b), `…-3-slides-sync.md` (P3); fix plan `<scratch>/uxreview/FIX-PLAN.md` (229 IDs). `<scratch>` = `/private/tmp/claude-501/-Users-mitchellpeck-WebstormProjects-OverlaySys/d399ff93-4d07-4c2a-8df1-56307d1cb584/scratchpad`.

Task ids: `P1.6` = plan 1 Task 6. 99 tasks in all: P1 has 22 (Tasks 21 dev asset proxy and 22 stage layout rules were added in reconciliation), P2a has 21 (Task 6 moved to P1.6/P1.8, Task 22 stage screens added), P2b has 34 (Tasks 33 server stage layouts and 34 Companion stage layout added), P3 has 22 (Task 22 stage screens on slides rows added).

Blockers LIVE-1, LIVE-2, LM-1, LM-2, LM-3, SHOWS-1 and SONGS-1 are done on main; the plans only keep their behaviour.

## 1. Waves

A task starts when every task it depends on has merged. Tasks in one wave are independent of each other. The wave number is the length of the longest dependency chain to the task, so a task may start earlier than its wave if its own dependencies are in.

| Wave | Tasks |
|---|---|
| 1 | P1.1, P1.8, P1.11, P1.17, P1.21, P2a.1, P2a.7, P2a.9, P2a.10, P2b.2, P2b.5, P2b.15, P2b.30, P3.1 |
| 2 | P1.2, P1.10, P1.18, P1.22, P2a.8, P2b.13, P2b.31, P3.2, P3.5, P3.7, P3.8 |
| 3 | P1.3, P1.4, P1.5, P1.19, P2a.2, P2a.5, P2a.19, P2b.14, P3.3, P3.10 |
| 4 | P1.6, P1.7, P1.9, P1.20, P2a.3, P2a.12, P2a.14, P2a.21, P2b.4, P2b.12, P2b.22, P2b.26, P2b.27, P2b.28, P3.4, P3.6 |
| 5 | P1.12, P1.13, P2a.4, P2a.11, P2a.15, P2a.20, P2b.1, P2b.3, P2b.6, P2b.16, P2b.23, P2b.32, P2b.33, P3.9, P3.11, P3.12, P3.13 |
| 6 | P2a.13, P2a.17, P2b.7, P2b.17, P2b.18, P2b.19, P2b.20, P2b.21, P2b.25, P2b.29, P2b.34, P3.14, P3.21 |
| 7 | P1.14, P1.15, P2a.16, P2a.18, P2b.8, P3.15, P3.19, P3.20 |
| 8 | P1.16, P2a.22, P2b.9, P2b.11, P2b.24, P3.16, P3.18 |
| 9 | P2b.10, P3.17, P3.22 |
| 10 | FINAL (integration and verification, below) |

**10 waves** (9 build waves + the final integration task).

**Critical path (9 tasks, two chains tie):**
- `P1.1 → P1.2 → P1.3 → P2b.4 → P2b.6 → P2b.7 → P2b.8 → P2b.9 → P2b.10` (kit → editor-kit on the kit → the designer chain).
- `P1.17 / P3.1 → P3.8 → P2a.2 → P2a.3 → P2a.11 → P2a.17 → P2a.18 → P3.16 → P3.17 / P3.22` (sections + slides row type → Live logic → rundown → show editor → slides rows in the show editor). `P2a.18 → P2a.22 → P3.22` ties with it.

Keep these chains staffed first; everything else has slack. P1.14, P1.15 and P1.16 are deliberately late (they wait for P2b's `?new=1` routes and `/projects`), but nothing waits on them.

### Per-task dependencies

Hard dependencies and merge-order dependencies (a file edited by two tasks) are both listed. Generated from `<scratch>/reconcile/deps.py`.

| Task | Title | Depends on | Wave |
|---|---|---|---|
| P1.1 | Charcoal palette, kind colours, globals and page frame | — | 1 |
| P1.2 | Buttons, fields, tooltip and kind bar | P1.1 | 2 |
| P1.3 | Value controls — NumberInput, SegmentedControl, Switch/Checkbox, FileDrop | P1.2 | 3 |
| P1.4 | Menu and useContextMenu | P1.2 | 3 |
| P1.5 | Dialogs and toasts (replaces window.confirm) | P1.2 | 3 |
| P1.6 | Save and connection kit — SaveBar, awaitAck, useConnection, OfflineState | P1.2, P1.5 | 4 |
| P1.7 | Unsaved-changes guard on the app dialog | P1.5 | 4 |
| P1.8 | List metadata, song createdAt and template roles | — | 1 |
| P1.9 | LibraryList | P1.1, P1.2, P1.3, P1.4, P1.5 | 4 |
| P1.10 | TemplateThumbnail | P1.1 | 2 |
| P1.11 | List formatting and export file names | — | 1 |
| P1.12 | /shows | P1.5, P1.6, P1.8, P1.9, P1.11 | 5 |
| P1.13 | /songs | P1.5, P1.6, P1.8, P1.9, P1.11 | 5 |
| P1.14 | /design — Graphics and Stage layouts | P1.5, P1.6, P1.8, P1.9, P1.10, P1.11, P2b.12, P2b.17 | 7 |
| P1.15 | /hotcards | P1.5, P1.6, P1.9, P1.11, P2b.25 | 7 |
| P1.16 | Retire EntityList and ManagementList | P1.12, P1.13, P1.14, P1.15, P2b.29 | 8 |
| P1.17 | Show schema — sections, sectionId, pass-through | — | 1 |
| P1.18 | Section helpers | P1.17 | 2 |
| P1.19 | Planning Center headers import as sections | P1.17, P1.18 | 3 |
| P1.20 | One-time header migration with backups | P1.17, P1.18, P1.19 | 4 |
| P1.21 | Dev asset proxy and dev badge (WS0.3) | — | 1 |
| P1.22 | Stage layout rules — schema and resolver (spec "Stage screens choose their layout dynamically") | P1.17 | 2 |
| P2a.1 | Cue always targets preview for rundown rows (controller addition) | — | 1 |
| P2a.2 | Air-state and key logic for Live (WS1/WS2 logic) | P3.1, P3.8 | 3 |
| P2a.3 | Row view model, sections grouping and "next" row | P1.1, P1.18, P2a.1, P2a.2 | 4 |
| P2a.4 | Thumbnail strip model and click rule | P2a.1, P2a.3 | 5 |
| P2a.5 | Show editor logic and length parsing | P1.18 | 3 |
| P2a.7 | Core song parsers: headerless lyrics, ChordPro, empty-section warnings | — | 1 |
| P2a.8 | Paste and file-import routing, chord detection, export round trip | P1.11, P2a.7 | 2 |
| P2a.9 | Song draft operations | — | 1 |
| P2a.10 | Sermon notes import keeps the title out of the points | — | 1 |
| P2a.11 | Shared sectioned rundown list | P1.2, P1.4, P1.6, P2a.3, P2a.5 | 5 |
| P2a.12 | Air zone: fixed monitors, tally, air controls | P1.2, P1.5, P2a.2 | 4 |
| P2a.13 | Selected-item region: thumbnail strip and item bar | P1.5, P1.10, P2a.3, P2a.4, P2a.12, P2a.19 | 6 |
| P2a.14 | Song and scripture take controls restyled | P1.3, P2a.2 | 4 |
| P2a.15 | Right drawer: timers, stage, hotcards | P1.3, P1.6, P2a.1 | 5 |
| P2a.16 | Live page assembly, shortcuts, show picker, palette commands | P1.9, P2a.2, P2a.11, P2a.12, P2a.13, P2a.14, P2a.15 | 7 |
| P2a.17 | Show editor shell: sectioned list, header, save model | P1.6, P1.7, P1.18, P2a.5, P2a.11 | 6 |
| P2a.18 | Show editor item forms with live thumbnail | P1.8, P1.10, P2a.4, P2a.5, P2a.17 | 7 |
| P2a.19 | Reusable slide editor pieces (deck mode) | P1.1, P1.2, P1.10 | 3 |
| P2a.20 | Song editor rebuild | P1.3, P1.6, P1.7, P1.8, P1.11, P2a.9, P2a.19 | 5 |
| P2a.21 | Paste panel and import-from-file | P1.3, P1.5, P2a.8 | 4 |
| P2a.22 | Stage screens on Live and in every row's editor | P1.22, P2a.15, P2a.18, P2b.33 | 8 |
| P2b.1 | Connection banner with Retry | P1.6, P1.11 | 5 |
| P2b.2 | Document title | — | 1 |
| P2b.3 | Settings save model (`settingsDraft`, `useSettingsDraft`) | P1.6, P1.7 | 5 |
| P2b.4 | editor-kit on the UI kit: number formatting, FieldRow, FontWeightSelect | P1.3 | 4 |
| P2b.5 | Custom bezier easing plays on output | — | 1 |
| P2b.6 | Designer keys: Space doesn't pan and play at once; Esc and pasteboard deselect | P2b.4 | 5 |
| P2b.7 | Whole-pixel geometry and the kit NumberInput in the inspector | P1.3, P2b.6 | 6 |
| P2b.8 | Designer chrome and layout in the new look (layers / canvas / inspector / timeline) | P1.6, P2b.2, P2b.7 | 7 |
| P2b.9 | Inspector rebuild: no overflow, consistent sections, multi-line text, Fields panel | P1.8, P2b.8 | 8 |
| P2b.10 | Timeline: ruler ticks, grouped tracks, labels, missing-out warning | P2b.9 | 9 |
| P2b.11 | "Preview on PVW" for the unsaved draft (preview channel only) | P1.8, P2b.8, P2b.12, P3.5 | 8 |
| P2b.12 | Template usage on delete; built-in protection | P1.5 | 4 |
| P2b.13 | Stage layout schema additions and D8 built-ins readable at 10 m | P1.8 | 2 |
| P2b.14 | Stage widgets on output: captions, overtime, fit floor, content-kind captions, video and flash | P2b.13 | 3 |
| P2b.15 | Renderer "PREVIEW" corner tag while a layout is previewed | — | 1 |
| P2b.16 | Stage editor controls on the kit; one-step commits; new widgets cascade | P2b.4, P2b.13 | 5 |
| P2b.17 | Stage layout designer page: chrome, read-only built-ins, New "Start from", preview switch | P2b.3, P2b.16 | 6 |
| P2b.18 | Settings › Channels: honest dirty state, compact cards, Kind-first create, explicit save | P1.1, P1.22, P2b.1, P2b.2, P2b.3 | 6 |
| P2b.19 | Settings › Stage monitor: SaveBar, guard, presets panel | P1.1, P2b.1, P2b.2, P2b.3 | 6 |
| P2b.20 | Settings › Scripture and Speech-to-text: one save model, honest loading, titles | P1.1, P2b.1, P2b.2, P2b.3 | 6 |
| P2b.21 | Settings › Integrations, Connection, and /account | P1.1, P2b.1, P2b.2, P2b.3 | 6 |
| P2b.22 | Shell navigation: glossary, labels at all widths, project switcher scope, Live tab colour | P1.1, P1.2, P1.3, P1.4, P1.5 | 4 |
| P2b.23 | Not-found page, skip link, account menu, status popovers, desktop toasts | P2b.22 | 5 |
| P2b.24 | Command palette: ranking, library items, guarded on-air verbs | P1.5, P2a.16 | 8 |
| P2b.25 | Hotcard editor rebuild: guard, header, template preview, project field, create flow | P1.8, P1.10, P2b.3 | 6 |
| P2b.26 | /pco page rebuild | P1.5, P1.19 | 4 |
| P2b.27 | Linked PCO songs follow that week's sequence | P1.17, P1.19 | 4 |
| P2b.28 | /data page: file pickers, tabs, bundle import plan, CSV clarity | P1.3, P1.5, P2b.2 | 4 |
| P2b.29 | /projects: LibraryList, rename rules, counts, custom fields, current pill, Unassigned | P1.9, P2b.1, P2b.2 | 6 |
| P2b.30 | Companion rows and channels: index presets, readable pickers, default channel | — | 1 |
| P2b.31 | Companion hotcards: Take and Cue, preset category | P2b.30 | 2 |
| P2b.32 | Companion HELP.md generated from definitions; naming | P2b.22, P2b.31 | 5 |
| P2b.33 | Stage screens resolve their layout on the server; manual switch | P1.22, P3.4, P3.10 | 5 |
| P2b.34 | Companion "Set stage layout" and the current-layout variable | P2b.32, P2b.33 | 6 |
| P3.1 | Deck schema and pure slide resolvers | — | 1 |
| P3.2 | PCO item mappings and deck suggestion (core) | P3.1 | 2 |
| P3.3 | Server storage for decks and PCO mappings | P3.1, P3.2 | 3 |
| P3.4 | Wire protocol for decks, slides and convert, plus deck CRUD handlers | P1.8, P3.1, P3.3 | 4 |
| P3.5 | Live slides engine | P3.1 | 2 |
| P3.6 | Sync entities for decks and PCO mappings | P3.2, P3.3 | 4 |
| P3.7 | Shows keep sections and slides through the cloud; hotcard hotkey round-trip | P1.17 | 2 |
| P3.8 | `SlidesRow` in the `RundownRow` union | P1.17, P3.1 | 2 |
| P3.9 | Slides take/advance handlers | P3.4, P3.5, P3.8 | 5 |
| P3.10 | Stage monitor current and next for slides | P3.5, P3.8 | 3 |
| P3.11 | PCO "Import as Slides" on the server | P1.19, P2b.27, P3.2, P3.3, P3.8 | 5 |
| P3.12 | Convert a song to a slide deck (core and server) | P3.3, P3.4, P3.8 | 5 |
| P3.13 | Operator store, `useWs`, `useDeck`, Live helpers and the slides adapter bodies | P1.8, P2a.2, P3.4, P3.8 | 5 |
| P3.14 | /slides library page, New deck dialog with licensing, Library nav entry | P1.5, P1.8, P1.9, P1.10, P2b.22, P3.13 | 6 |
| P3.15 | Deck editor | P1.6, P1.7, P2a.19, P3.14 | 7 |
| P3.16 | Slides rows in the show editor | P2a.17, P2a.18, P3.13 | 8 |
| P3.17 | One-off local slides and "Save to library" | P3.16 | 9 |
| P3.18 | Live integration (verification of the adapter in plan 2a's Live) | P2a.13, P2a.16, P3.13 | 8 |
| P3.19 | /pco "Import as Slides" UI | P2b.26, P3.11, P3.14 | 7 |
| P3.20 | "Convert to slide deck" UI | P1.13, P2a.20, P3.12, P3.14 | 7 |
| P3.21 | Companion slides next and previous | P2b.32, P3.4, P3.5 | 6 |
| P3.22 | Stage screens on slides rows | P1.22, P2a.22, P3.16 | 9 |

Notes on edges that cross plans:
- **P3.1 and P3.8 before P2a.2.** The Live adapter stub (`lib/slidesRowView.ts`) imports core slides types, and P3.8's one-line `case "slides"` placeholders in `onAir.ts`, `rowAirState.ts`, `stageMode.ts` and `StageArea.tsx` land before P2a rewrites those files.
- **P2a.2 before P3.13**, **P2a.18 before P3.16**: plan 3 replaces the bodies of the adapter and `SlidesItemForm.tsx` that 2a created.
- **P2b.12 before P1.14** (template usage), **P2b.17 before P1.14** and **P2b.25 before P1.15** (`?new=1` routes), **P2b.29 before P1.16** (`/projects` off `ManagementList`).
- **P2a.16 before P2b.24** (palette maps `liveCommands`; only its on-air commit strictly needs it).
- **P1.22 before P2b.18, P2b.33, P2a.22, P3.22**; **P3.4 and P3.10 before P2b.33** (shared `ws.ts`, protocol and `stageFeedHub.ts`).

## 2. File ownership

One owner per file. A non-owner may make an additive edit only where §3 lists it.

### 2.1 By area

| Area | Owner |
|---|---|
| `packages/ui/**` (tokens, kit, LibraryList, OfflineState) | P1 |
| `apps/operator/src/app/globals.css`, `app/layout.tsx`, `app/components/PageShell.tsx`, `app/components/pageBody.ts` | P1 |
| `apps/operator/src/lib/{awaitAck,useConnection,useUnsavedGuard,unsavedGuardFlow,templateRoles,listFormat,exportName,devProxy,dialog}.ts(x)`, `lib/thumbnails/**` | P1 |
| List pages `app/{shows,songs,hotcards,design}/page.tsx`, `app/songs/librarySearch.ts`, `app/design/NewTemplateDialog.tsx` | P1 |
| `packages/core/src/{show.ts, sections.ts, song.ts (createdAt), template.ts (role), stageLayoutRules.ts, channelConfig.ts (layoutRules), pco/headerSections.ts}` | P1 |
| `server/src/{shows.ts, songs.ts, songLibraryRoute.ts, pco/headerMigration.ts}`, `server/src/templates.ts` (meta) | P1 |
| `apps/renderer/vite.config.ts`, `apps/operator/next.config.mjs` | P1 (P1.21) |
| Live: `app/page.tsx`, `app/components/{Monitors,OnAirStrip,ChannelPreview,Rundown,StageArea,SongModePanel,SongTakeStrip,ScriptureTakeStrip,TakePanel,MediaTransportStrip,ConsoleBottomBar,ChannelDots,ChannelWindowSettingsPopover,TimersRail,TimerPanel,StageTimersSection,ActiveTimersPanel,StagePanel,ShowPicker,HotcardsPanel,ScriptureRowModal,ScriptureSlideEditor,ScriptureIntroEditor,VideoRowModal,VideoThumb}.tsx`, `components/rundown/**`, `components/live/**`, `app/hooks/{useGlobalShortcuts,useLivePrefs}.ts` | P2a |
| `apps/operator/src/lib/{onAir,shortcutGuards,songNav,rowAirState,rowData,stageMode,mediaTime,mediaTake,rowLength,notesImport,slideBreaks,songChannel,channelDotModel,airRoute,rowLike,rowView,liveNext,thumbClick,textOverflow,liveCommands,stageLayoutStatus}.ts` | P2a |
| `app/shows/edit/**` (except `forms/SlidesItemForm.tsx`), `app/songs/edit/**`, `app/songs/{PasteLyricsModal,ImportFromFileModal}.tsx`, `app/songs/{pasteLyrics,songImport}.ts` | P2a |
| `packages/core/src/{songParser,sectionEmit,parsePlainLyrics,songSelectParser,chordPro,sermonNotes}.ts` | P2a |
| Shell `app/shell/**`, `app/not-found.tsx`, `app/components/{AccountMenu,CloudSignInButton,ProjectSwitcher,SyncStatusPill}.tsx`, `app/timer/page.tsx` | P2b |
| Settings `app/settings/**`, `app/account/**`, `lib/{scriptureSettings,scriptureClient,stageSettingsClient,editorStore,stage*}.ts` (stageDesigner guard helpers: read-only for P1.7) | P2b |
| Designers `app/design/edit/**`, `app/design/stage/**`, `packages/editor-kit/**`, `packages/template-engine/src/{gsap-timeline,cubicBezier}.ts` | P2b |
| Stage output `packages/stage-widgets/**`, `packages/core/src/stageLayout.ts`, `apps/renderer/src/**` | P2b |
| `server/src/{templateUsage,templateRoutes,templateDrafts,stageLayoutOverride,stageLayouts}.ts` | P2b |
| Library integrations `app/hotcards/edit/**`, `app/pco/**` (except plan 3's own `ImportAsSlides.tsx`, `slidesImport.ts`), `app/data/**`, `app/projects/**`, `lib/{csv,pcoClient,pcoFieldRefill}.ts`, `server/src/pco/**` (except `headerMigration.ts`), `packages/companion-module/**` | P2b |
| Slides core `packages/core/src/{deck,slides,slidesRowOps,slidesMapping,slidesConvert,channel}.ts`; sync `packages/core/src/{storageAdapter,syncEngine}.ts`, `packages/supabase/**`, `server/src/{fsStorageAdapter,cloudSync}.ts`, `apps/operator/src/lib/cloudData.ts`, `docs/cloud-*-migration.md` | P3 |
| `server/src/{decksStore,decks,decksConvert,slidesSession,slidesHandlers}.ts`, `server/src/pco/{itemMappings,slidesImport}.ts` | P3 |
| `apps/operator/src/app/slides/**`, `apps/operator/src/app/pco/{ImportAsSlides.tsx,slidesImport.ts}`, `apps/operator/src/lib/{slidesLive,useWs}.ts`, `apps/operator/src/lib/store.ts` | P3 |
| Handed over: `apps/operator/src/lib/slidesRowView.ts` (P2a.2 creates stubs → P3 from P3.13); `apps/operator/src/app/shows/edit/forms/SlidesItemForm.tsx` (P2a.18 creates placeholders → P3 from P3.16) | P2a → P3 |

### 2.2 Shared files and their merge order

| File | Owner | Edits, in merge order |
|---|---|---|
| `server/src/pco/importPlan.ts` (+test) | P2b | **P1.19** (headers → sections) → **P2b.27** (EXTRA-2, link branches only) → **P3.11** (slides kind, carry-over, remember). Each touches only its named branch. |
| `server/src/pco/routes.ts` | P2b | P2b (as needed) → **P3.11** (`slidesSuggestions`, item-mapping routes) |
| `server/src/ws.ts` | — (no redesign owner) | **P3.4** (one delegating case group) → **P2b.33** (`set_stage_layout`) |
| `packages/ws-protocol/src/index.ts` | — | **P1.8** (`show_list`/`template_list` optional fields) → **P3.4** (deck/slides/convert messages) → **P2b.33** (stage layout messages) |
| `server/src/channels.ts` | — | **P3.5** (slides-session hooks in `take`, `clear`, `takePvwToPgm`) → **P2b.11** (draft-off-preview guard, placed at the top of `take`/`takePvwToPgm`) |
| `server/src/stageFeed.ts`, `server/src/stageFeedHub.ts` | P3 | **P3.8** (placeholders) → **P3.10** (slides current/next, `decks` input) → **P2b.33** (layout resolution) |
| `server/src/index.ts` | — | **P1.20** (start header migration), **P2b.12** (`registerTemplateRoutes`), **P3.3** (`reloadDecks`, `reloadItemMappings` after `reloadShows`). Independent lines; on conflict keep all. |
| `server/src/templates.ts` | P1 | **P1.8** (meta `role`/`updatedAt`) → **P2b.11** (`getTemplate` draft fallback) |
| `packages/core/src/show.ts` | P1 | **P1.17** (sections, passthrough, `pcoArrangement`) → **P1.22** (`stageLayouts` on rows) → **P3.8** (`SlidesRowSchema`) |
| `packages/core/src/stageLayout.ts` | P2b | **P1.8** (`StageLayoutMetaSchema.updatedAt`) → **P2b.13** |
| `packages/core/src/channelConfig.ts` | P1 (for this redesign) | **P1.22** (`layoutRules`) |
| `apps/operator/src/lib/store.ts` | P3 | **P1.8** (`ShowMeta` fields) → **P3.13** (decks) |
| `apps/operator/src/lib/{onAir,rowAirState,stageMode}.ts`, `app/components/StageArea.tsx` | P2a | **P3.8** (one `case "slides"` placeholder each) → **P2a.2 / P2a.13** (rewrite, keep the case) |
| `apps/operator/src/app/songs/page.tsx` | P1 | **P1.13** → **P3.20** ("Convert to slide deck…" menu item) |
| `apps/operator/src/app/songs/edit/page.tsx` | P2a | **P2a.20** → **P3.20** (⋯ item, converted-to notice in `SongNotFound`) |
| `apps/operator/src/app/pco/{importOptions.ts, PcoItemRow.tsx}` | P2b | **P2b.26** → **P3.19** (`"slides"` option, `<ImportAsSlides>`) |
| `packages/companion-module/src/{actions,presets,feedbacks,variables}.ts`, `companion/HELP.md` | P2b | **P2b.30 → P2b.31 → P2b.32** → **P2b.34** and **P3.21** (any order between those two; regenerate HELP.md with `gen:help` after the second) |
| `packages/core/src/bundle.ts` | — | **P3.8** only |
| `packages/core/src/index.ts`, `packages/core/src/pco/index.ts`, `packages/ui/src/index.ts` | append-only | One `export * from "./x";` line per new module: P1.18 (`sections`), P1.19 (`pco/headerSections`), P1.22 (`stageLayoutRules`), P2a.7 (`chordPro`), P3.1 (`deck`, `slides`), P3.2 (`slidesMapping`), P3.12 (`slidesConvert`), P3.16 (`slidesRowOps`); P1.2–P1.9 add kit exports. On conflict keep every line. |
| `pnpm-lock.yaml` | — | **P1.2** (lucide-react in `packages/ui`) → **P2b.4** (`@overlaysys/ui` in editor-kit). On conflict re-run `pnpm install`; never hand-merge. |
| `packages/editor-kit/src/VideoInput.tsx` | P2b | **P2b.9** makes P2a's requested change (lucide `FolderOpen`, caller's `resolveUrl`) |

## 3. The rule for shared files

1. **One owner.** Every file has exactly one owner (§2). Only the tasks named in §2.2 may edit a file they don't own.
2. **Additive only.** A non-owner edit adds code; it never renames, reorders, reformats or deletes the owner's code (the one sanctioned rename is P2b.33's `stageLayouts.resolveStageLayout` → `loadStageLayout`, in a file P2b owns).
3. **Marked blocks.** A non-owner edit sits between `// [P3.5] <purpose>` and `// [/P3.5]` (or one trailing `// [P3.5]` comment for a single line), so a reviewer can see whose it is and a later rewrite can keep it.
4. **Merge order.** Edits to the same file merge in the order of §2.2. A later task rebases onto the earlier one; if the earlier task isn't merged yet, the later edit waits (the wave table already encodes this).
5. **Owner rewrites keep the blocks.** When an owner rewrites a file that holds another plan's block (P2a.2 over P3.8's placeholders), it keeps the behaviour, moves it to the right place, and says so in its commit message.
6. **Contracts first.** If an edit needs a name or signature not in the contracts file, change the contracts file in the same commit.
7. **Append-only files** (`index.ts` barrels): one export line per module; keep every line on conflict.

## 4. Final integration and verification task (FINAL)

**Depends on:** every task in waves 1–9. **Owner:** the controller (or one integrating agent on main after the last merge).

- [ ] **Step 1: Full checks.** `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @overlaysys/operator build:cloud`, `pnpm --filter @overlaysys/companion-module build`. All exit 0. Then `rg -n "window\.(confirm|prompt)|EntityList|ManagementList|PageFrame|songExportFileName|inferTemplateRole|slidesPvwTakeMessages" apps packages --glob '!**/dist/**'` → no matches; `rg -n "\[P[123][ab]?\.[0-9]+\]" server packages apps --glob '!**/dist/**'` lists only the marked blocks §2.2 allows.
- [ ] **Step 2: Contract sanity.** Run `rg -n "export (function|const|type|class) <name>\b"` for every exported contract name in `2026-10-28-redesign-contracts.md` §2–§16 across `apps packages server`: each is defined exactly once, in the module the contracts name.
- [ ] **Step 3: Screenshot pass against the review findings.** Start the shared stack (server :4000, operator :3000, renderer :3001) on a copy of the uxreview data plus seeded decks. From `<scratch>/uxreview/`, re-run every area script (`live-*.mjs`, `shows-*.mjs`, `songs-*.mjs`, `gd-*.mjs`, `stage-*.mjs`, `lm-*.mjs`, `shell-*.mjs`) with `OUT=shots/after/final`, at 1024×768, 1280×800, 1440×900 and 1920×1080. For each screen, open its findings file (`findings/*.md`) and tick every ID in §7 for that area: the "after" shot must show the fix or the planned rebuild; record any regression as a new finding. Add the Slides screens (`/slides`, deck editor, show-editor slides row, Live slides strip, /pco Import as Slides, Convert dialog) and the stage-screen layout UI (Settings → Channels rules, Live drawer). Measurements to repeat on every page: no horizontal overflow at 1024; no row action taller than 28 px; "⋯" visible without hover; no visible ids; muted text ≥ 4.5:1 (`contrast.test.ts` passes).
- [ ] **Step 4: End-to-end service run (mocked externals).** Script `<scratch>/uxreview/e2e-service.mjs`:
  1. **PCO import (mocked).** Point the PCO client at `server/src/pco/__fixtures__` (no real credentials). Import a plan with headers "Gathering", "Word", "Response": headers become sections, never rows; a linked song follows that week's sequence (EXTRA-2) without saving the library song; one item ("Gloria Patri") is imported **as Slides** with "Remember" on, onto a seeded public-domain deck.
  2. **Re-import** the same plan: sections and the operator's manual moves are kept; "Gloria Patri" is pre-selected as Slides from the remembered mapping; a title differing only by a number ("Psalm 23" vs "Psalm 100") is not.
  3. **Show editor:** add a section, drag a row across sections, add a one-off slides row and "Save to library" (licensing: own), set a scripture row's "Stage screens" override, save with ⌘S; stop the server mid-save once and confirm "Not saved: Not connected to the server." and the draft stays dirty.
  4. **Convert** a placeholder song used by one upcoming and one past show; the upcoming row becomes a slides row in the same section; Undo restores it.
  5. **Live:** walk the rundown top to bottom on preview and a test program channel (never the shared Program): Cue always lands on PVW; Take promotes song, scripture and slides sessions; thumbnails jump to the clicked slide; Space through the deck to "End of deck · Space again to clear" and once more to clear; B blanks; Esc Esc clears; the stage screen following program switches layout by rule (song → Lyrics, scripture → Scripture), by the item override, and by a manual switch that resets when the next row goes live; Companion (module test harness) `slides_advance` and `set_stage_layout` act the same.
  6. **Cloud sync (mocked).** Run `sync()` against the in-memory adapter used by `syncEngine.test.ts`, then against a fake Supabase client **without** the `decks` table and the `shows.extra` / `hotcards.hotkey` columns: decks, mappings, sections, slides rows and hotkeys survive a push/pull round trip on the migrated fake; on the unmigrated fake nothing local is lost and no sync error is reported (one info log each).
  7. **Data safety.** Before the run, copy `data/`; afterwards every pre-existing show, song, template, hotcard, stage layout and settings file still parses; header migration wrote exactly one `.pre-sections.bak` per changed show; a stage channel without rules renders exactly as before.
- [ ] **Step 5: Coverage.** `python3 -I <scratch>/reconcile/checkcov.py docs/superpowers/plans/2026-10-28-redesign-execution-order.md <scratch>/uxreview/FIX-PLAN.md docs/superpowers/plans` exits 0, and every spec section in §6 has its tasks merged.
- [ ] **Step 6: Report** to the owner: the decisions still open (§8), the deferred D22/D21/D18 items, and the release note for D8 (built-in stage layouts change at the next render) and dynamic stage layouts.

## 5. Contract name check (done during reconciliation)

Every contract name was grepped across the four plans after the edits. Each name below appears with one signature, in the owning plan's Interfaces block, and only as a consumer elsewhere: `sendAndAwaitAck`, `requestOne`, `AckError`, `ackErrorText`, `useConnection`, `OfflineState`, `offlineCopy`, `templatesFor`, `templateRole`, `exportFileName`, `PageBody` (`variant: "form" | "wide" | "list"`), `composeDocTitle`, `TemplateUsage`, `fetchTemplateUsage`, `templateDeleteConfirm`, `NumberInput` (`precision`), `FileDrop`/`acceptsFile` (string accept), `addSection` (→ `{ show, section }`), `addSongSection`, `migrateHeaderRows(show, headers)`, `pcoArrangement`, `EditorFrame` (`right?`), `SlideThumbGrid`, `SlideTextEditor`, `slideFieldsFor`, `DeckSlideFields`, `slidesRowView` (core) vs `slidesRowViewFor` (adapter), `slidesThumbMessages(showId, row, position, target)`, `slidesRowTakeMessages`, `SlidesItemForm`, `SlidesAddFlow`, `liveCommands`/`PaletteCommand`/`toPaletteEntry`, `resolveStageLayout`, `StageLayoutStatus`, `StageScreensField`. Retired names that no longer appear as definitions: `awaitAck(…)` (the module keeps the file name `awaitAck.ts`), `connectionView` in P2a, `inferTemplateRole`, `songExportFileName`, `PageFrame`, `pageFrame.ts`, `SlideThumbList`, `SlideFieldsEditor`, `slidesPvwTakeMessages`, `templateUsageRoute.ts`, `templateUsageClient.ts`, `data/FileDrop.tsx`.

## 6. Spec coverage

| Spec section | Tasks |
|---|---|
| Why / Goals 1 (one coherent look) | P1.1–P1.7, then every screen task in P2a/P2b/P3 |
| Goals 2 / Live (option B) | P2a.1–P2a.4, P2a.11–P2a.16 |
| Goals 3 / Rundown rows and sections | P1.17–P1.20, P2a.3, P2a.5, P2a.11, P2a.17 |
| Goals 4 / Shared library list (incl. Designs grid, delete-when-used) | P1.9, P1.10, P1.12–P1.16, P2b.12, P2b.29, P3.14 |
| Goals 5 / Slides decks | P3.1–P3.5, P3.8–P3.20, P2a.2 (adapter), P2a.18 (slot), P2a.19 (deck-mode pieces) |
| Goals 6 (all ready for Sunday, no scope cuts) | §1 waves; FINAL |
| Non-goals (cloud parity: build compiles, desktop-only screens hidden) | `build:cloud` in P2a.16–P2a.20, P2b.11 (hidden in cloud), P2b.24 (no on-air verbs in cloud), FINAL step 1 |
| Anti-goals: wrong thing on air | P2a.1 (Cue → preview), P2a.4 (click rule), P2a.16 (Esc Esc), P2b.11 (draft never off preview), P3.9 (missing deck refuses), P2b.24/P2a.16 (palette confirm) |
| Anti-goals: data loss | P1.17 (passthrough), P1.20 (backups), P2b.13 (stored layouts unchanged), P3.7 (cloud keeps fields), P1.22 (no stage migration needed), FINAL step 4.7 |
| Anti-goals: liturgy writing CCLI usage | P3.5, P3.14 |
| Constraints (monorepo, Vitest logic-only, screenshots) | every plan's Global Constraints |
| Visual system | P1.1–P1.5, contracts §1–§2 |
| Shell | P2b.1, P2b.2, P2b.22, P2b.23, P2b.24; P1.1 (labels at all widths) |
| Editors: show editor | P2a.17, P2a.18 |
| Editors: song editor and deck mode | P2a.19, P2a.20, P2a.21, P3.15 |
| Editors: graphics designer (incl. Preview on PVW) | P2b.4–P2b.12 |
| Editors: stage layout designer, Settings, Hotcards, Planning Center, Data | P2b.13–P2b.21, P2b.25–P2b.29 |
| Stage screens choose their layout dynamically (SPEC-STAGE-DYN) | P1.22 (schema, resolver), P2b.33 (server, manual override, protocol), P2b.18 (Settings rules), P2a.22 (Live drawer, row "Stage screens"), P3.22 (slides rows), P2b.34 (Companion) |
| Cloud sync | P3.6, P3.7, P1.17 (passthrough) |
| Relation to the fix plan | §7 (229 IDs) |
| Delivery (stages) | §1 waves: stage 1 ≈ P1, stage 2 ≈ P2a/P2b, stage 3 ≈ P3, overlapping where files don't collide |
| Left to the builder | decided in contracts (§1 tuned tokens, §5 thumbnails via the engine, §6 schemas, P2a.15 drawer) |

## 7. Fix-plan coverage

Every one of the 229 FIX-PLAN IDs. "Tasks" lists every task whose section names the ID (generated by `<scratch>/reconcile/coverage.py` from the plans as edited). "Status" is `planned`, `done on main`, `superseded by rebuild in …` or `deferred: reason (Dn)`; a row can have both tasks and a status when part of the finding is deferred or already done.

Verify with:

```bash
python3 -I <scratch>/reconcile/checkcov.py \
  docs/superpowers/plans/2026-10-28-redesign-execution-order.md \
  <scratch>/uxreview/FIX-PLAN.md docs/superpowers/plans
# FIX-PLAN ids: 229  table rows: 229  with a task: 224  status only: 5
```

| ID | Tasks | Status / note |
|---|---|---|
| EXTRA-1 | P2b.5 | planned |
| EXTRA-2 | P1.19, P2b.27 | planned |
| GD-1 | P2b.6 | planned |
| GD-10 | P2b.7, P2b.9 | planned |
| GD-11 | P1.3, P2b.4, P2b.9 | planned |
| GD-12 | P2b.9 | planned |
| GD-13 | P2b.10 | planned |
| GD-14 | P2b.10 | auto out-fade deferred: D21 (warning only) |
| GD-15 | P1.14 | planned |
| GD-16 | P1.14 | planned |
| GD-17 | P1.14 | list thumbnails superseded by rebuild in P1.14 (Designs grid); editor-header id in P2b.8 |
| GD-18 | P1.14 | planned |
| GD-19 | P2b.8, P2b.22 | planned |
| GD-2 | P2b.9 | planned |
| GD-20 | P2b.8 | planned |
| GD-21 | P2b.4, P2b.9 | planned |
| GD-22 | P2b.9 | planned |
| GD-23 | P2b.9 | planned |
| GD-24 | P1.7, P2b.8 | planned |
| GD-25 | P2b.8 | planned |
| GD-26 | — | deferred: D22 (multi-edit is a feature, enrichment backlog) |
| GD-27 | P2b.9 | planned |
| GD-28 | P1.11, P1.14 | planned |
| GD-29 | P1.3, P1.14 | planned |
| GD-3 | P1.3, P2b.4, P2b.7 | planned |
| GD-30 | P1.14 | planned |
| GD-4 | P1.14, P2b.12 | planned |
| GD-5 | P2b.8, P2b.10 | planned |
| GD-6 | P2b.10 | planned |
| GD-7 | P2b.9 | planned |
| GD-8 | P2b.6, P2b.9 | planned |
| GD-9 | P2b.9 | planned |
| LIVE-1 | — | done on main (e819d90); Esc path kept in P2a.16 |
| LIVE-10 | P2a.2, P2a.16 | planned |
| LIVE-11 | P2a.14, P2a.15 | planned |
| LIVE-12 | P2a.3, P2a.11 | planned |
| LIVE-13 | P2a.15 | planned |
| LIVE-14 | P2a.2, P2a.12, P2a.13 | planned |
| LIVE-15 | P1.1, P1.2, P2a.12 | planned |
| LIVE-16 | P1.2 | planned |
| LIVE-17 | P2a.15 | planned |
| LIVE-18 | P1.5, P2a.16 | planned |
| LIVE-19 | P2a.2, P2a.11 | planned |
| LIVE-2 | — | done on main (e819d90); kept in P2a.12 |
| LIVE-20 | P2a.16 | planned |
| LIVE-21 | P2a.15 | planned |
| LIVE-22 | P2a.2, P2a.16 | planned |
| LIVE-23 | P2a.3, P2a.14 | planned |
| LIVE-24 | P2a.13 | planned |
| LIVE-25 | P2a.15 | planned |
| LIVE-26 | P2a.15 | planned |
| LIVE-27 | P2a.13 | planned |
| LIVE-28 | P1.21 | planned |
| LIVE-29 | P2a.13 | planned |
| LIVE-3 | P2a.13 | auto-shrink deferred: D21 (warnings only) |
| LIVE-30 | P2a.12 | planned |
| LIVE-31 | P2a.12 | planned |
| LIVE-32 | P1.21 | planned |
| LIVE-33 | P2a.11 | superseded by rebuild in P2a.11 (next row replaces Up next) |
| LIVE-34 | P2a.12 | planned |
| LIVE-35 | P1.5 | planned |
| LIVE-4 | P2a.12 | planned |
| LIVE-5 | P2a.13, P2a.14 | superseded by rebuild in P2a.13 (thumbnail strip) and P2a.14 |
| LIVE-6 | P2a.2, P2a.12 | planned |
| LIVE-7 | P2a.13 | planned |
| LIVE-8 | P2a.11, P2a.16 | planned |
| LIVE-9 | P2a.2, P2a.13, P2a.16 | planned |
| LM-1 | — | done on main (6a0d118 and earlier); F-keys kept in P2a.15, P2a.16, P2b.25 |
| LM-10 | P2b.26 | planned |
| LM-11 | P1.8, P1.19, P2b.26 | planned |
| LM-12 | P2b.30 | planned |
| LM-13 | P2b.30 | planned |
| LM-14 | P2b.30 | planned |
| LM-15 | P2b.30 | planned |
| LM-16 | P2b.31 | planned |
| LM-17 | P2b.32 | planned |
| LM-18 | P2b.32 | planned |
| LM-19 | P2b.26 | planned |
| LM-2 | — | done on main (ca75738); rule extended to rows in P2a.1 |
| LM-20 | P2b.26 | planned |
| LM-21 | P2b.28 | planned |
| LM-22 | P2b.28 | planned |
| LM-23 | P2b.28 | planned |
| LM-24 | P2b.28 | planned |
| LM-25 | P2b.22, P2b.25 | planned |
| LM-26 | P1.15, P2b.25 | planned |
| LM-27 | P1.5, P2b.29 | planned |
| LM-28 | P2b.29 | planned |
| LM-29 | P2b.29 | planned |
| LM-3 | P2b.21 | done on main; P2b.21 finishes the Integrations Disconnect |
| LM-30 | P1.15, P1.16 | planned |
| LM-31 | P2b.25 | planned |
| LM-32 | P2b.29 | planned |
| LM-33 | P2b.2 | planned |
| LM-34 | P2b.23 | planned |
| LM-4 | P1.9, P1.15, P1.16 | planned |
| LM-5 | P2b.25 | planned |
| LM-6 | P1.8, P2b.25 | planned |
| LM-7 | P2b.28, P2b.29 | planned |
| LM-8 | P2b.28 | planned |
| LM-9 | P1.3, P2b.28 | planned |
| SHOWS-1 | P2a.17 | done on main; guard kept in P2a.17 |
| SHOWS-10 | P2a.5, P2a.17 | planned |
| SHOWS-11 | P1.21, P2a.18, P2b.9 | "Choose from library" media browser deferred: D22; 404 in P1.21 |
| SHOWS-12 | P2a.18 | planned |
| SHOWS-13 | P2a.10 | planned |
| SHOWS-14 | P2a.17 | planned |
| SHOWS-15 | P2a.17 | planned |
| SHOWS-16 | P1.5, P2a.5, P2a.17 | planned |
| SHOWS-17 | P1.12 | planned |
| SHOWS-18 | P1.12, P1.16 | planned |
| SHOWS-19 | P2a.18 | planned |
| SHOWS-2 | P1.6, P2a.17 | planned |
| SHOWS-20 | P2a.18 | planned |
| SHOWS-21 | P1.8, P2a.18 | planned |
| SHOWS-22 | P1.12, P2a.17, P2b.22 | planned |
| SHOWS-23 | P1.12, P2a.17 | planned |
| SHOWS-24 | P1.1, P2a.18, P2b.9 | planned |
| SHOWS-25 | P2a.18 | planned |
| SHOWS-26 | P2a.17 | planned |
| SHOWS-27 | P2a.18 | planned |
| SHOWS-28 | P1.6, P2a.17 | planned |
| SHOWS-3 | P2a.5, P2a.17 | planned |
| SHOWS-4 | P1.8, P2a.18 | planned |
| SHOWS-5 | P2a.5, P2a.18 | planned |
| SHOWS-6 | P2a.17 | D15 superseded by rebuild (P2a.17) |
| SHOWS-7 | P2a.18 | D15 superseded by rebuild (P2a.11, P2a.18) |
| SHOWS-8 | P2a.18 | planned |
| SHOWS-9 | P2a.5 | planned |
| SONGS-1 | P2a.7, P2a.21 | done on main (parser); paste warning in P2a.7/8/21 |
| SONGS-10 | P2a.8, P2a.21 | planned |
| SONGS-11 | P2a.20 | D16 superseded by rebuild (P2a.20) |
| SONGS-12 | P2a.20 | planned |
| SONGS-13 | P2a.20 | planned |
| SONGS-14 | P2a.20 | planned |
| SONGS-15 | P2a.9, P2a.20 | planned |
| SONGS-16 | P1.6, P2a.20 | planned |
| SONGS-17 | P1.7 | planned |
| SONGS-18 | P2a.20 | planned |
| SONGS-19 | P2a.20 | planned |
| SONGS-2 | P2a.9, P2a.20 | planned |
| SONGS-20 | P2a.20 | planned |
| SONGS-21 | P2a.20 | planned |
| SONGS-22 | P1.13, P1.16 | planned |
| SONGS-23 | P1.13 | planned |
| SONGS-24 | P2a.21 | planned |
| SONGS-25 | P1.13 | planned |
| SONGS-26 | P1.5, P1.13 | planned |
| SONGS-27 | P1.13 | planned |
| SONGS-28 | P2a.20 | planned |
| SONGS-29 | P2a.21 | planned |
| SONGS-3 | P2a.7, P2a.21 | planned |
| SONGS-30 | P1.13 | planned |
| SONGS-31 | P1.13 | planned |
| SONGS-32 | P2a.20 | planned |
| SONGS-33 | P1.5 | planned |
| SONGS-4 | P2a.7, P2a.8, P2a.21 | planned |
| SONGS-5 | P2a.9, P2a.20 | planned |
| SONGS-6 | P2a.20 | planned |
| SONGS-7 | P1.13 | planned |
| SONGS-8 | P1.8, P2a.20 | planned |
| SONGS-9 | P2a.8, P2a.21 | planned |
| SS-1 | P1.1, P2b.2 | planned |
| SS-10 | P1.2, P2b.18, P2b.21 | planned |
| SS-11 | P1.2, P2b.18, P2b.20 | planned |
| SS-12 | P1.1, P2b.2, P2b.19, P2b.20 | planned |
| SS-13 | P1.3, P2b.21, P2b.28 | planned |
| SS-14 | P2b.21 | planned |
| SS-15 | P2b.21 | planned |
| SS-16 | P1.16, P2b.18, P2b.20, P2b.22, P2b.28 | planned |
| SS-17 | P1.12, P1.15, P2b.22 | planned |
| SS-18 | P2b.18 | planned |
| SS-19 | P1.1, P2b.23 | planned |
| SS-2 | P1.9, P1.16, P2b.29 | planned |
| SS-20 | P2b.23 | planned |
| SS-21 | P2b.21 | quick fix only; IA regroup deferred: D18 |
| SS-22 | P2b.21 | planned |
| SS-23 | P2b.29 | planned |
| SS-24 | P2b.1, P2b.22 | planned |
| SS-25 | P2b.2 | planned |
| SS-26 | P2b.20 | planned |
| SS-27 | P2b.23 | planned |
| SS-28 | P2b.23 | planned |
| SS-29 | P1.5, P2b.23 | planned |
| SS-3 | P1.1 | planned |
| SS-30 | P1.21 | planned |
| SS-4 | P1.6, P2a.15, P2b.1, P2b.20 | planned |
| SS-5 | P2b.20, P2b.22 | planned |
| SS-6 | P1.6, P2b.3, P2b.19, P2b.20 | planned |
| SS-7 | P2b.24 | planned |
| SS-8 | P1.1, P2b.20 | planned |
| SS-9 | P2b.18, P2b.19, P2b.21 | planned |
| STAGE-1 | P2b.13 | planned |
| STAGE-10 | P2b.13, P2b.14 | planned |
| STAGE-11 | P1.3, P2b.4, P2b.16 | planned |
| STAGE-12 | P2b.16 | planned |
| STAGE-13 | P2b.17 | planned |
| STAGE-14 | P1.3, P2b.4, P2b.16 | planned |
| STAGE-15 | P2b.4, P2b.16 | planned |
| STAGE-16 | P2b.16 | planned |
| STAGE-17 | P2b.17, P2b.22 | planned |
| STAGE-18 | P2b.17 | planned |
| STAGE-19 | P2b.17 | planned |
| STAGE-2 | P2b.13 | planned |
| STAGE-20 | P1.3, P2b.15, P2b.17 | planned |
| STAGE-21 | P1.7, P2b.17 | planned |
| STAGE-22 | P2b.17 | planned |
| STAGE-23 | P2b.17 | planned |
| STAGE-24 | P1.14 | planned |
| STAGE-25 | P1.14 | planned |
| STAGE-26 | P1.14 | live stage-layout thumbnails deferred: D22; list part in P1.14 |
| STAGE-27 | P1.14, P1.16 | planned |
| STAGE-28 | P2b.18 | planned |
| STAGE-29 | P1.6, P2b.18 | planned |
| STAGE-3 | P2b.13 | planned |
| STAGE-30 | P2b.18 | planned |
| STAGE-31 | P2b.18 | planned |
| STAGE-32 | P2b.18 | planned |
| STAGE-33 | P1.6, P2b.3, P2b.19 | planned |
| STAGE-34 | P2b.19 | planned |
| STAGE-35 | P2b.19 | planned |
| STAGE-36 | P2b.19 | planned |
| STAGE-37 | P2b.19 | planned |
| STAGE-4 | P2b.13, P2b.14 | planned |
| STAGE-5 | P2b.14 | planned |
| STAGE-6 | P2b.13 | planned |
| STAGE-7 | P2b.13 | planned |
| STAGE-8 | P2b.14 | planned |
| STAGE-9 | P2b.14 | planned |

| Controller addition | Tasks | Status |
|---|---|---|
| SPEC-STAGE-DYN (stage screens choose their layout dynamically) | P1.22, P2b.18, P2b.33, P2b.34, P2a.22, P3.22 | planned (contracts §16) |
| Row Cue → preview | P2a.1 | planned |

## 8. Decisions only the owner can make

1. **Manual stage-layout override survives a server restart?** Planned as in-memory (a restart returns every stage screen to automatic). Persisting it is a small change in P2b.33 if the owner prefers.
2. **Core name `resolveStageLayout`.** Kept as requested; the server's existing `stageLayouts.resolveStageLayout` (id → layout loader) is renamed `loadStageLayout` in P2b.33. Say if the core function should take a different name instead.
3. **Merge timing of the list pages.** P1.14 (Designs) and P1.15 (Hotcards) wait for P2b's `?new=1` editor routes, so the old list pages stay in place until wave 7. The alternative (ship the new lists early with the old create flows, switch later) costs one extra edit per page.
