# Operator UI Simplification — Design

**Date:** 2026-10-20
**Status:** Draft — awaiting review

## Goal

Make the operator app feel simple instead of convoluted, both in how you get
around it and on the Show page you run a service from. During a show the
operator stays on **one screen** where taking, timers, hotcards and channel
state are all within reach. Prep and setup are one deliberate step away.

### What the user said

- The whole app feels convoluted, both the shell/navigation and the Show page.
- All four pain points apply:
  - **Too many places:** 11 destinations, plus a Live/Prep toggle, plus a
    project switcher.
  - **Show page is busy:** three dense columns, a transport strip, and a
    layout that reshuffles in song mode.
  - **Live tools are scattered:** Timer, STT, Channels and Hotcards each have
    their own page.
  - **Visual noise:** emoji icons, many pills, and lots of small controls
    that all look equally important.
- A single operator runs the show on a big monitor (1440p or wider).

### Decisions made during brainstorming

- Live screen layout: **Console**. Everything is visible at once in fixed
  regions (option A of three).
- Navigation: **three top-level tabs, Live · Library · Settings**, shown in
  the top bar. Live gets the full width with no sidebar (option B of two).
- The visual rules (see *Visual system*) and adding `lucide-react` were both
  approved.
- Manual take becomes a "Quick take" mode with three buttons.
- `/channels` and `/stt` move under `/settings`, with redirects.
- Timers are created from a popover in the console.

### Assumptions (confirmed)

- **Success means:** one screen for the whole live show, and a stable layout.
  Song mode changes what is *inside* a region, never where the regions are.
- **Prep stays page-based** but gets simpler to navigate.
- **No behaviour changes.** This is layout, navigation and visual hierarchy
  only. The WebSocket protocol, store, take/playback logic and keybindings
  stay as they are.
- **Setup moves to Settings.** STT and Channels configuration live there; the
  Live screen keeps only compact status and controls.
- **The cloud/web build stays without Live**, as it is today.

### Non-goals

- Rewriting the inside of editors (Show, Song, Design and Hotcard editors keep
  how they work now; they only sit inside the new frame).
- New features, keyboard remapping, or responsive layouts for small screens.
- Changing the renderer or the desktop app's windows.

## Current state (why it feels convoluted)

- `AppShell` = a 200px `Sidebar` (logo, `WorkspaceToggle`, per-workspace nav
  using emoji glyphs, `AccountMenu`) + a header (title, context,
  `ProjectSwitcher`, page actions, `StatusPills`).
- `workspaces.ts` defines **Live** (`/`, `/timer`, `/stt`, `/channels`) and
  **Prep** (`/projects`, `/shows`, `/songs`, `/design`, `/hotcards`, `/data`,
  `/pco`).
- The Show page (`app/page.tsx`) is a three-column grid: Rundown | Take
  controls | Channels. In song mode it collapses to two columns and adds a
  horizontal "Channels & Preview" strip along the bottom.
- **There are two separate take areas:**
  - `Rundown` contains the controls for the selected row (Cue/Take,
    `SongTakeStrip`, `ScriptureTakeStrip`) and also has `HotcardsPanel` on
    the bottom.
  - `TakePanel` is a separate manual take tool: pick any template, fill in its
    fields, then use one of seven large buttons.
  - Each shows its own keyboard hints, and they contradict each other.

## Design

### 1. Shell and information architecture

**Top bar** (one 40px row, replacing both `Sidebar` and the old header):

```
[ LIVE | LIBRARY | SETTINGS ]  <Show picker (Live only)>  <Project switcher>  <page title/actions>   ● Server :port  ● STT  ● Synced
```

- `AreaTabs` is a segmented control. Live is red (`onair`) when active;
  Library and Settings use the brand colour.
- `PageChrome` keeps feeding the title, context and actions slots.
- `AccountMenu` moves from the sidebar footer into Settings, as the Account
  section.
- `StatusPills` becomes `StatusDot`s. A pill appears only for warnings and
  errors (for example, STT error or connection closed).

**Areas and routes** (existing URLs are kept wherever possible):

| Area | Sub-nav | Routes |
|---|---|---|
| Live | none (full width) | `/` |
| Library | Shows, Songs, Designs, Hotcards | `/shows`, `/songs`, `/design`, `/hotcards` (each `/edit` route stays under its parent) |
| Settings | Channels, Speech-to-text, Planning Center, Data, Projects, Account | `/settings/channels`, `/settings/stt`, `/pco`, `/data`, `/projects`, `/account` |

- Redirects: `/timer` → `/`, `/channels` → `/settings/channels`, `/stt` →
  `/settings/stt`.
- Library and Settings render a ~160px left sub-nav. Live has none.
- `shell/workspaces.ts` becomes `shell/areas.ts`, the single source of truth
  for the tabs, sub-navs, command palette entries, route → area resolution,
  the cloud filter and last-route-per-area persistence. A sub-nav entry can
  belong to an area without its route sharing a prefix, so `/pco` and `/data`
  resolve to Settings by an explicit list, not by prefix.
- `Destination.icon` changes from an emoji string to a lucide icon component.
- ⌘⇧L: when not on Live, go to Live; when on Live, go back to the last
  non-Live route.
- **Cloud build:** the Live tab is hidden. Library and Settings show
  everything except the desktop-only entries (Channels, Speech-to-text,
  Planning Center). `/` still redirects to `/shows`.

**What happens to today's Live pages:**
- **Timer:** the page is removed. `TimerPanel` (create/configure) opens as a
  popover from "+ New" in the console's Timers panel. `ActiveTimersPanel`
  appears in compact form on the right rail.
- **Channels:**
  - The console bottom bar shows each channel's state as a `StatusDot`.
  - Clicking a dot opens a menu with the channel window settings popover
    (`ChannelWindowSettingsPopover`), Clear, and Open renderer.
  - Creating channels and per-project overrides move to `/settings/channels`.
- **STT:** the full page moves to `/settings/stt` unchanged. The top-bar STT
  dot's menu offers Start/Stop and a link to settings.

### 2. Live console

A fixed grid that doesn't move when the mode changes:

```
┌──────────────────────────── top bar ────────────────────────────┐
├──────────────┬──────────────────────────────┬──────────────────┤
│ Rundown      │ PVW monitor  │  PGM monitor  │ Timers  (+ New)  │
│ (~320px)     ├──────────────────────────────┤                  │
│              │ Stage area                   ├──────────────────┤
│              │ (selected-row controls /     │ Hotcards         │
│              │  song mode / Quick take)     │ (~300px)         │
├──────────────┴──────────────────────────────┴──────────────────┤
│ Transport strip                     ● Program  ● Preview  ● Stage│
└────────────────────────────────────────────────────────────────┘
```

**Rundown (left)**
- Only the list: section headers, row number, title, and a quiet
  right-aligned type tag.
- Row state is shown with a left colour bar and a tint: red for on air
  (program), green for cued (preview), a brand-colour outline for selected.
- Row actions (edit, image preview and so on) appear on hover/focus only.
- The take strips, `HotcardsPanel` and the hint paragraph are removed from
  `Rundown`.
- Selection stays in the store as it is today, so the stage area can read it.

**Monitors (centre top)**
- Large PVW and PGM monitors reuse `ChannelPreview` (the mini-renderer).
- PGM gets a 2px `onair` ring and a "PGM" label; PVW gets a 1px `ok` ring.
- While song mode is active, the monitors shrink (about 40% of their normal
  height) so the song panel has room. The grid itself does not change.

**Stage area (centre bottom)**
- A new `StageArea` component picks its content from the selected row and the
  song sessions:

  | State | Content |
  |---|---|
  | A song session is live on PGM or PVW | `SongModePanel` (heading "Song mode · PGM", or "Song mode · PVW (cued)") |
  | Song row selected | `SongTakeStrip` |
  | Scripture row selected | `ScriptureTakeStrip` + "Edit slides…" |
  | Graphic or video row selected | Row title, field summary, **Cue** and **Take ⏎** (primary, red) |
  | Nothing selected | Empty state: "Select a rundown item, or use Quick take" |

- The header has a **Quick take** toggle. In Quick take mode the stage area
  shows the `TakePanel` form (template select, the template's fields, channel
  selects), cut down to **Cue**, **Take ⏎** and **Update**. Clearing a channel
  happens from its bottom-bar dot or Esc.
- One keyboard-hint line sits at the bottom of the stage area. Its text comes
  from the existing bindings in `useGlobalShortcuts` (including song-mode
  keys when song mode is active). The bindings themselves are not changed.

**Right rail**
- **Timers:**
  - A compact `ActiveTimersPanel` shows each timer's label, a large monospace
    time, and a thin progress bar.
  - Warning state uses the `warn` colour.
  - "+ New" opens `TimerPanel` in a popover.
- **Hotcards:**
  - `HotcardsPanel` is restyled as a two-column grid of tiles with their F-key
    hints.
  - A hotcard that is currently on air gets the `onair` border, but only
    where the store already knows that; no new state is added for it.
  - Its firing logic is unchanged.

**Bottom bar**
- `MediaTransportStrip` (unchanged logic, restyled to fit one 40px row) on the
  left.
- On the right, one `StatusDot` per channel. Each dot opens a menu with window
  settings, Clear, and Open renderer, positioned with `lib/popoverPosition`.
- This replaces the `ChannelsList` column and the song-mode horizontal strip.

### 3. Visual system (`@overlaysys/ui`)

- Add the **`lucide-react`** dependency and remove emoji from the nav,
  buttons and status indicators.
- **New components:**
  - `StatusDot`: a dot, a label, a tone, and an optional `onClick`/menu.
  - `PanelHeader`: 32px tall, sentence case, 11px semibold `textDim`, with an
    optional right-hand slot. It replaces `ShellPanel` and the hand-rolled
    `<h3>` headers.
  - `AreaTabs`: the Live/Library/Settings control.
- **Spacing:** export `space = { 1: 4, 2: 8, 3: 12, 4: 16 }` and use only
  these values in the shell and console.
- **Colour rules:**
  - `onair` red only for program/on-air state and the primary Take button.
  - "Danger" buttons (Clear) become quiet buttons; the colour is kept for
    destructive actions that can't be undone, such as delete.
  - Pills only for warnings and errors.
- **Labels:** sentence case instead of letter-spaced uppercase, except the
  small PGM/PVW monitor labels.
- Existing tokens and their backward-compatible aliases stay; nothing is
  renamed.

### 4. Library and Settings pages

- Pages render inside the new frame with `PanelHeader` and the spacing scale.
- Inside each page, changes are limited to:
  - swapping emoji for icons,
  - downgrading pills to dots or text,
  - showing row actions on hover in list views (`ManagementList`,
    `EntityList`).
- `/settings/channels` takes the setup content of today's `channels/page.tsx`
  (create channel, rows, background editor, project overrides) unchanged.
- `/settings/stt` is today's `stt/page.tsx`, moved.

## Error handling and edge cases

- **Server disconnected:**
  - The top-bar server dot turns red with a "Disconnected" pill.
  - Take buttons are disabled, using the existing `takesDisabled` logic.
  - The console layout stays where it is.
- **No show loaded:** the console shows an empty state in the Rundown with the
  show picker. The monitors and right rail still render.
- **Selected row deleted or the show changes:** the stage area falls back to
  its empty state.
- **A song session starts while another row is selected:** the song panel
  takes priority, as it does today.
- **Old bookmarks:** these all redirect: `/timer`, `/channels`, `/stt`.
  Last-route keys stored under the old `overlaysys:lastRoute:live|prep` names
  are ignored, and the new keys are `overlaysys:lastRoute:<area>`.

## Testing

- **Unit:** `areas.test.ts` replaces `workspaces.test.ts`. It covers:
  - route → area resolution, including `/pco` and `/data` → Settings and
    `/shows/edit` → Library,
  - the cloud filter,
  - last-route keys,
  - the redirect map.
- **Unit:** `StageArea` content selection as a pure function
  (`stageModeFor(selectedRow, songSessions, quickTake)`), tested for every
  row in the table above.
- **Existing tests:** all still pass, including `popoverPosition.test.ts`.
- **Build:** typecheck and build for `apps/operator` and `apps/desktop`.
- **Manual checklist** in the running desktop app at 1440p and 1920p:
  - Each row type: graphic, song, scripture, video.
  - Song mode start/advance/end on PGM and on PVW.
  - Every global and song-mode hotkey.
  - Creating and running a timer from the popover.
  - Firing hotcards and their F-keys.
  - Each channel dot's menu: window settings, Clear, Open renderer.
  - Quick take: cue, take and update.
  - Redirects.
  - The cloud build: no Live tab, and `/` → `/shows`.

## Rollout (phases, each shippable)

1. **Foundations:** `lucide-react`, `space`, `StatusDot`, `PanelHeader`,
   `AreaTabs` in `@overlaysys/ui`. No visible layout change.
2. **Shell:** `areas.ts`, the new top bar, Library/Settings sub-navs, the
   `/settings/*` moves and redirects, `Sidebar` and `WorkspaceToggle`
   removed.
3. **Live console:**
   - the new grid,
   - `StageArea` (pulled out of `Rundown`), with Quick take,
   - the right rail (timers popover, hotcard grid),
   - the bottom bar (transport and channel dots),
   - `/timer` removed, and `ChannelsList` retired from the Show page.
4. **Polish:** apply the visual rules across Library and Settings pages.

**Prerequisite:** the in-progress, uncommitted work on `ChannelStatus.tsx`,
`ChannelWindowSettingsPopover.tsx` and `lib/popoverPosition.ts` lands before
phase 3, because the channel-dot menus reuse it.

## Open questions

None at this time.
