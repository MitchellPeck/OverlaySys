# UI Overhaul — Phase 2: App Shell (two-tier Live/Prep)

**Date:** 2026-07-14
**Status:** Design — awaiting review
**Scope of this spec:** Phase 2 of the UI redesign. Covers the app shell:
the two-tier Live/Prep structure, the persistent sidebar, the workspace
toggle, the top bar, and a ⌘K command palette — plus migrating the ~11 routes
off their per-page `AppHeader`/`PageShell` onto the shell. Phase 1 (theme +
primitives) is complete and merged on branch `feat/ui-overhaul`. Phase 3 (Live
workspace redesign) and Phase 4 (Prep workspace redesign) get their own specs.

---

## Background

OverlaySys is a live broadcast graphics operator tool. Phase 1 rebuilt the
theme token layer and `packages/ui` primitives to match Ovation OS (slate-dark
base, Geist, indigo brand / emerald positive, red reserved for on-air). This
phase gives the app its new navigational skeleton.

**Current shell (what this replaces):**
- `apps/operator/src/app/components/AppHeader.tsx` — a two-row header: brand +
  a flat `NAV_LINKS` horizontal nav + status pills + account (top row), and an
  optional sub-header with page title/context + `ProjectSwitcher` + actions.
  `NAV_LINKS` carries a `hideInCloud` flag on the desktop-only live surfaces
  (Show, Timer, STT).
- `apps/operator/src/app/components/PageShell.tsx` — `PageShell` (fixed grid,
  header row + scrollable body) and `PageBody` (padding/maxWidth).
- Each of ~11 route files renders its own `<PageShell><AppHeader …/><PageBody>…`
  (account, channels, data, design/edit, hotcards/edit, page[show], shows/edit,
  songs/edit, stt, timer, and the `ManagementList` component used by index
  pages).
- `useGlobalShortcuts` (show page) claims bare keys for live operation:
  ↑/↓, Enter, Space, Esc, ⌘/Ctrl+Enter, and in song mode C/B/T, `.`, and
  **0–9** (verse jumps).

## Decisions locked during brainstorming

- **Navigation model:** two-tier — a **Live** workspace and a **Prep**
  workspace, with a clear toggle. (Set in Phase 1.)
- **Route → workspace mapping** (confirmed):
  - **Live:** Show (`/`), Timer (`/timer`), Scripture (`/stt`), Channels
    (`/channels`).
  - **Prep:** Projects (`/projects`), Shows (`/shows`), Songs (`/songs`),
    Design (`/design`), Hotcards (`/hotcards`), Data (`/data`).
  - Account is chrome (account menu), present in both.
- **Shell layout:** persistent left **sidebar** (Option A), always present:
  brand mark → LIVE/PREP toggle → active workspace's destinations → account
  pinned at the bottom. A top bar carries page title/context + `ProjectSwitcher`
  + status pills. Consistent across both workspaces.
- **Keyboard:** full **⌘K command palette** (navigation + a few global
  actions) plus a workspace-toggle shortcut. Meta-combos only, to avoid the
  live bare-key shortcuts.

## Goals (this phase)

- Introduce the two-tier Live/Prep shell as the global frame for every route.
- One source of truth (`workspaces.ts`) for workspaces, destinations, routes,
  icons, defaults, cloud gating, and route→workspace resolution.
- Persistent sidebar + workspace toggle + top bar (title/context, project
  switcher, status pills, account).
- ⌘K command palette, data-driven from `workspaces.ts`.
- Migrate all ~11 routes onto the shell; delete `AppHeader`/`PageShell`.

## Non-goals (this phase)

- No change to what any page *does* — page body logic is untouched.
- No redesign of the Live Show screen's internal 3-panel layout (Phase 3) or
  the Prep management screens' internals (Phase 4).
- No new in-app actions in the palette beyond navigation + workspace toggle +
  open-account. (Palette action surface stays small.)
- No light theme.

---

## Design

### 1. Workspace model — `workspaces.ts`

New file `apps/operator/src/app/shell/workspaces.ts`. Single source of truth,
replacing `NAV_LINKS`.

```ts
export type WorkspaceId = "live" | "prep";

export type Destination = {
  route: string;        // e.g. "/timer"
  label: string;        // e.g. "Timer"
  icon: string;         // glyph/short id the sidebar + palette render
  desktopOnly?: boolean;// hidden in cloud build (all Live destinations are)
};

export type Workspace = {
  id: WorkspaceId;
  label: string;        // "Live" | "Prep"
  defaultRoute: string; // where the toggle lands if no last-visited route
  destinations: Destination[];
};

export const WORKSPACES: Record<WorkspaceId, Workspace>;

// Live: Show(/), Timer(/timer), Scripture(/stt), Channels(/channels) — all desktopOnly
// Prep: Projects(/projects), Shows(/shows), Songs(/songs), Design(/design),
//       Hotcards(/hotcards), Data(/data)

/** Resolve which workspace a pathname belongs to. Longest-prefix match against
 *  all destination routes; "/" matches Live's Show exactly. Unknown → "prep". */
export function routeToWorkspace(pathname: string): WorkspaceId;

/** Destinations for a workspace, filtered for cloud mode (drops desktopOnly). */
export function destinationsFor(id: WorkspaceId, cloud: boolean): Destination[];
```

- Cloud gating centralizes here: in cloud mode Live's destinations are all
  `desktopOnly`, so the Live workspace is empty and the toggle is not rendered
  (cloud is Prep-only).
- `routeToWorkspace` uses longest-prefix matching so `/shows/edit` resolves to
  Prep via `/shows`. `/` matches Show (Live) exactly (not as a prefix of every
  route).

### 2. `AppShell` — the global frame

New `apps/operator/src/app/shell/AppShell.tsx`, a client component mounted once
in the layout wrapper (alongside `CloudBoot` in `layout.tsx`) so it frames all
pages.

Structure (fixed, fills viewport):
- **Sidebar** (`Sidebar.tsx`): brand mark (gradient square + "OverlaySys") →
  `WorkspaceToggle` → the active workspace's destinations (from
  `destinationsFor`, active item highlighted; Show/live-active item uses the
  on-air red edge, other active items use indigo) → spacer → `AccountMenu`
  pinned at bottom. Hidden entirely if there are zero destinations (cloud edge
  cases aside, Prep always has some).
- **Top bar**: left = page title/context provided by the active page via
  `PageChrome` (below) + `ProjectSwitcher`; right = status pills
  (`SyncStatusPill`, STT status, connection pill) — these move verbatim out of
  `AppHeader`. In cloud mode the local-only pills are suppressed (as today).
- **Body slot**: renders `{children}` (the page). Edge-to-edge, no default
  padding — padded/centered pages opt in via `PageBody`.
- **`CommandPalette`** mounted here (section 4).

Active workspace is **derived** from the current route via
`routeToWorkspace(usePathname())` — not stored in state.

### 3. `PageChrome` + page migration

New `apps/operator/src/app/shell/PageChrome.tsx`. A page renders it near the top
of its body to declare its top-bar content; it renders `null` and pushes
`{title, context, actions}` into a React context that `AppShell`'s top bar
reads.

```tsx
export function PageChrome(props: {
  title?: ReactNode; context?: ReactNode; actions?: ReactNode;
}): null;
```

- Backed by `ShellChromeContext` (provider in `AppShell`, setter used by
  `PageChrome` via effect; clears on unmount so stale chrome never lingers).
- **Per-page migration** (mechanical): replace
  `<PageShell><AppHeader title=… context=… actions=…/><PageBody>…</PageBody></PageShell>`
  with `<><PageChrome title=… context=… actions=…/><PageBody>…</PageBody></>`.
  The pages: `account`, `channels`, `data`, `design/edit`, `hotcards/edit`,
  `shows/edit`, `songs/edit`, `stt`, `timer`, the show page (`/`), and the
  `ManagementList` component.
- **Show page (`/`)** special case: it's full-bleed (its own 3-panel grid, no
  `PageBody`). It renders `<PageChrome title=… />` for the top bar and its grid
  fills the shell body slot edge-to-edge. Its internal layout is unchanged
  (Phase 3 territory).
- After all pages are migrated, **delete** `AppHeader.tsx` and `PageShell.tsx`.
  `PageBody` is retained (moved to the shell folder or kept in place) — it's
  still used inside the body slot.

### 4. Command palette — `CommandPalette.tsx`

New `apps/operator/src/app/shell/CommandPalette.tsx`, mounted in `AppShell`.

- **Open:** ⌘/Ctrl+K, from anywhere including when an input is focused (meta
  combo types nothing). **Close:** Esc or backdrop click.
- **Contents:** every destination across both workspaces (via
  `destinationsFor`, cloud-filtered), each labeled with its workspace, plus a
  few global actions: "Switch to Live/Prep" and "Open account". Data-driven
  from `workspaces.ts` so it never drifts from the sidebar.
- **Interaction:** a text input fuzzy-filters by label (pure
  `fuzzyMatch(query, label)` helper, unit-tested); ↑/↓ move the highlight;
  Enter navigates (Next router `push`) / runs the action; Esc closes.
- Built on the existing `Modal`/overlay primitive where it fits, or a small
  custom centered overlay if the palette needs tighter keyboard control.

### 5. Workspace toggle — `WorkspaceToggle.tsx`

New `apps/operator/src/app/shell/WorkspaceToggle.tsx`. A segmented LIVE|PREP
control in the sidebar. LIVE segment active = on-air red; PREP segment active =
indigo. Clicking a segment navigates to that workspace's **last-visited route**
(persisted per workspace in `localStorage`, defaulting to `defaultRoute`);
toggling back returns you where you were. Not rendered in cloud mode (Prep-only).

- Last-visited persistence: `AppShell` records the current route into
  `localStorage` keyed by its resolved workspace on each navigation; the toggle
  reads it. Keys: `overlaysys:lastRoute:live` / `:prep`.

### 6. Keyboard integration

- New global listener (in `AppShell`) handles **meta-combos only**, so the live
  bare-key shortcuts in `useGlobalShortcuts` are untouched:
  - ⌘/Ctrl+K → open palette.
  - ⌘/Ctrl+Shift+L → toggle workspace (same nav behavior as the toggle button).
- The palette's ↑/↓/Enter/Esc are active only while it is open.

---

## Testing & acceptance

- **Unit tests (pure, node harness):**
  - `workspaces.test.ts`: `routeToWorkspace` for each destination route,
    nested routes (`/shows/edit` → prep), `/` → live, unknown → prep;
    `destinationsFor` filters `desktopOnly` when `cloud=true`; default routes
    and destination lists are correct.
  - `fuzzyMatch` (palette filter): matches subsequences, filters
    correctly, case-insensitive, empty query returns all.
- **Regression:** `pnpm typecheck` + `pnpm test` green. Confirm no remaining
  imports of `AppHeader`/`PageShell` after deletion (grep).
- **Visual / interactive (real-app boot, no jsdom — as Phase 1):** run the
  operator; for every route confirm 200 + it renders inside the shell with the
  sidebar; the active destination is highlighted; the toggle switches
  workspaces and lands on the right route; ⌘K opens the palette, filters,
  navigates, and Esc closes; on-air red vs indigo selection read correctly.
  Driven via the `/run` skill.

## Acceptance criteria (checklist)

- [ ] `workspaces.ts` is the single source of truth; `NAV_LINKS` removed.
- [ ] `AppShell` mounted globally; sidebar + toggle + top bar + palette present.
- [ ] All ~11 routes migrated to `PageChrome`; render inside the shell.
- [ ] Show page renders full-bleed in the body slot; internals unchanged.
- [ ] Workspace derived from route; toggle lands on last-visited/default route.
- [ ] ⌘K palette navigates across both workspaces; ⌘/Ctrl+Shift+L toggles;
      live bare-key shortcuts still work.
- [ ] Cloud mode: Prep-only, no toggle, no Live destinations.
- [ ] `AppHeader.tsx` + `PageShell.tsx` deleted; no dangling imports.
- [ ] Unit tests for `routeToWorkspace`/`destinationsFor`/`fuzzyMatch` pass;
      `pnpm typecheck` + `pnpm test` green; visual walk clean.

## Risks

- **Broad migration (11 pages).** Mitigated by the mechanical `PageChrome`
  swap and per-page boot verification; page body logic is untouched.
- **Chrome-context staleness** (a page's title lingering after navigation).
  Mitigated by clearing chrome on `PageChrome` unmount.
- **Shortcut collision.** Mitigated by handling meta-combos only; the bare-key
  live shortcuts and the 0–9 verse jumps are never intercepted.
- **`ProjectSwitcher`/status pills relocation.** They move verbatim from
  `AppHeader`; behavior unchanged, only their parent differs.
