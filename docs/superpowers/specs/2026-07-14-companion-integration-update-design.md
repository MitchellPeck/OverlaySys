# Companion Integration Update — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Depends on:** [2026-05-12 Companion Integration design](./2026-05-12-companion-integration-design.md)

## Context

The Bitfocus Companion module (`packages/companion-module/`) was fully built out
under the original companion-integration design. It was then **accidentally
deleted** by commit `056f1a8` ("chore(companion-module): remove unused tests and
action definitions") — a mislabeled squash whose diff actually removed the entire
module (all `src/`, tests, `companion/manifest.json`, `HELP.md`, `package.json`,
`build.mjs`, `tsconfig.json`) bundled with a large batch of unrelated operator /
cloud-sync changes. The module last existed complete at `056f1a8^`. It is absent
from both `feat/ui-overhaul` (current branch) and `feat/companion-integration`.

Two operator-facing gaps motivate this update:

1. **Rundown row content fields aren't reachable.** The only per-row variable is
   `rundown_<n>_name`, which resolves to the row's *label* — for a graphic row
   that's the template name (e.g. "Section Intro"), not the row's actual content.
   The operator wants the row's `data` field values (`title`, `subtitle`, …) as
   variables so a Stream Deck button can display them.
2. **No one-press "next show" selection.** Selecting a show today requires
   choosing it explicitly via the `load_show` action's dropdown. The operator
   wants a single button that selects the soonest show scheduled today or in the
   future. Shows currently have **no structured date** — the date lives only
   inside the show name string (e.g. `"5/17/26 Service"`).

## Goals

- Restore the deleted Companion module verbatim and get it building and green.
- Expose each loaded-show row's content fields as Companion variables, addressable
  by field key (`rundown_<n>_field_title`).
- Add a structured, optional show date, and a "Select next show" Companion action
  that picks the soonest upcoming show (date field, falling back to a date parsed
  from the show name).

## Non-goals (v1)

- No changes to on-air / PGM take/clear behavior.
- The operator-UI date control is a minimal native date input, not a redesign.
- No "next show preview" variable — the selection is action-only (deferred, YAGNI).
- No field variables for the currently on-air content beyond what already exists
  (`<c>_data_<i>_key/value`); this change is about the **rundown** (loaded show).

## Work is additive on the current branch

Work happens on `feat/ui-overhaul`. The restore and all new files are additive, so
they do not conflict with the unrelated in-progress changes already in the working
tree. The restore lands as its own isolated commit so the accidental deletion is
cleanly reverted and independently reviewable.

---

## Part 0 — Restore

Recover `packages/companion-module/` at its `056f1a8^` contents, verbatim:

```
packages/companion-module/
  package.json  build.mjs  tsconfig.json  README.md
  companion/manifest.json  companion/HELP.md
  src/{index,connection,state,actions,feedbacks,variables,presets,labels,config,types}.ts
  src/__tests__/{state,variables,feedbacks,actions,labels}.test.ts
```

Restore mechanism: `git checkout 056f1a8^ -- packages/companion-module`. Then
`pnpm install` (re-link the workspace package), run typecheck, and run the module's
vitest suite. **Gate:** typecheck clean and all restored tests pass before any
feature work. This is committed separately from the feature commits.

---

## Part A — Per-row content-field variables

### Behavior

For the loaded show, expose each **graphic** row's `data` entries as variables:

- **`rundown_<n>_field_<key>`** — value of the row's `data[<key>]` for row `n`
  (1-based, `n` = 1..`RUNDOWN_LIMIT`). `<key>` is the raw data key **sanitized**
  for a Companion variable id: lowercased, every run of non-`[a-z0-9]` characters
  collapsed to a single `_`, leading/trailing `_` trimmed. Example: a graphic row
  whose `data` is `{ title: "Welcome", subtitle: "Good morning" }` yields
  `rundown_1_field_title = "Welcome"` and `rundown_1_field_subtitle = "Good morning"`.
- **`rundown_<n>_template_name`** — the row's template name (raw), kept distinct
  from `rundown_<n>_name` (the display label).
- **Scripture** rows additionally get `rundown_<n>_field_reference` = the row's
  `reference`. **Song** rows expose no field variables (they carry no `data`; the
  song title is already available via `rundown_<n>_name`).

Sanitization collisions (two distinct keys mapping to the same sanitized id) are
possible but rare; last-writer-wins, and this is noted in `HELP.md`. Template field
keys in practice are simple identifiers.

### Why dynamic definitions

The set of field keys is show-dependent, so the variable **definitions** must be
regenerated whenever the loaded show's rows change. The module already regenerates
action/feedback *definitions* on dropdown-source changes via `mutatesDropdownSources`
+ `refreshDefinitions`; variable definitions are currently static
(`setVariableDefinitions(variableDefinitions(this.channels))` only in `refreshAll`).

Changes:

- `variableDefinitions(channels, state)` — take `state` as a second argument and
  append the dynamic `rundown_<n>_field_<key>` / `rundown_<n>_template_name`
  definitions derived from the loaded show in `state.showCache`. When no show is
  loaded, it emits only the base definitions (current behavior).
- `index.ts` — call `setVariableDefinitions(variableDefinitions(this.channels,
  this.state))` not only in `refreshAll` but also whenever the loaded show's rows
  change. The trigger set is exactly the events that change the loaded show: the
  `show` message for the loaded show id, `local_load_show`, and
  `local_clear_loaded_show`. A small helper (e.g. `mutatesRundownVariables(evt,
  state)`) gates this, mirroring `mutatesDropdownSources`.
- `projectVariables(state, channels)` — emit values for the dynamic ids. It walks
  the loaded show's rows the same way `variableDefinitions` does, so ids and values
  stay in lockstep. A shared internal helper (e.g. `rundownFieldEntries(state)`
  returning `{ id, name, value }[]`) is used by both the definition and value paths
  to guarantee they never drift.

### Tests (`variables.test.ts`)

- Graphic row `data` → correctly named/sanitized field variables and values.
- `rundown_<n>_template_name` resolves via the templates list; empty when unknown.
- Scripture row → `rundown_<n>_field_reference`; song row → no field vars.
- No loaded show → no dynamic field variables emitted.
- Key sanitization (spaces, punctuation, mixed case) and collision behavior.

---

## Part B — Structured show date + "Select next show"

### B1. Core (`@overlaysys/core`)

- **`ShowSchema`** (`show.ts`): add `scheduledFor: z.string().optional()` — an ISO
  calendar date `YYYY-MM-DD` (date only, no time/zone). Optional and backfill-free:
  existing shows simply have no value. Writers set it when the operator picks a date.
- **New `showSchedule.ts`** (pure, tested):
  - `resolveShowDate(input: { name: string; scheduledFor?: string }): string | null`
    — returns a `YYYY-MM-DD` string or `null`. Prefers `scheduledFor` when present
    and valid; otherwise parses the **name** for a date. Supported name formats:
    `M/D/YY`, `M/D/YYYY` (with `1`- or `2`-digit month/day). Two-digit years map to
    `2000+YY`. Returns `null` when neither source yields a valid date.
  - `pickNextShow(shows: { id: string; name: string; scheduledFor?: string }[],
    todayISO: string): string | null` — resolves each show's date, keeps those with
    a resolved date `>= todayISO`, returns the `id` of the one with the **soonest**
    date. Ties (same date) break by input order (stable). Returns `null` when none
    qualify.
- Export both from `core/src/index.ts`.

### B2. Protocol + server

- **ws-protocol** (`index.ts`): add `scheduledFor: z.string().optional()` to the
  `show_list` meta object. Additive/optional → no client breakage.
- **server** (`shows.ts` `listShowMetas`): include `scheduledFor: s.scheduledFor`
  in each meta. No other server change; `save_show` already round-trips the full
  `Show` (now including the new field via the schema).

### B3. Operator UI

In the shows editor (`apps/operator/src/app/shows/edit/page.tsx`): a minimal native
`<input type="date">` bound to the show's `scheduledFor`, persisted on save like the
other show fields. No layout redesign; place it near the show name.

### B4. Companion module

- **`ShowMeta`** (`types.ts`): add `scheduledFor?: string`. The `state.ts` reducer
  stores it from `show_list` (it already maps `id`/`name`/`projectId`/`rowCount`).
- **`select_next_show` action** (no inputs): resolves the target show id from
  `state.shows` via a pure helper and, when one is found, runs the **same flow as
  `load_show`** — push a `local_load_show` local event and a `get_show` message,
  and persist the selected `loadedShowId` to config. When none qualifies: no-op plus
  `this.log('warn', …)`.
  - Testability: selection needs "today," but the state cache has no clock and the
    reducer/`dispatchAction` must stay pure. A pure `resolveSelectNextShow(shows,
    todayISO): { messages; localEvents } ` (or a thin wrapper over `pickNextShow`
    that returns the load-flow result) is unit-tested with injected `todayISO`.
    `index.ts` computes `todayISO` from `new Date()` at click time and calls it,
    keeping the clock at the edge and the logic pure. `dispatchAction` delegates the
    `select_next_show` case to this helper (index injects `todayISO`).
- **Preset**: add a "Select Next Show" button to the preset set (`presets.ts`),
  bound to `select_next_show`.

### Tests

- **Core `showSchedule.test.ts`:** `resolveShowDate` across name formats
  (`5/17/26`, `12/1/2026`, single-digit, non-date names → null), `scheduledFor`
  precedence over name, invalid `scheduledFor` → name fallback. `pickNextShow`:
  soonest-future selection, today included, all-past → null, tie-break by order,
  mixed field/name-derived dates, empty list.
- **Module:** `select_next_show` dispatch given a set of show metas + a fixed
  `todayISO` produces the correct `get_show` + `local_load_show` for the soonest
  upcoming show, and a no-op when none qualify.

---

## File-change summary

| Area | File | Change |
|------|------|--------|
| Restore | `packages/companion-module/**` | recover verbatim from `056f1a8^` |
| Core | `packages/core/src/show.ts` | add optional `scheduledFor` to `ShowSchema` |
| Core | `packages/core/src/showSchedule.ts` (new) | `resolveShowDate`, `pickNextShow` (+ test) |
| Core | `packages/core/src/index.ts` | export the above |
| Protocol | `packages/ws-protocol/src/index.ts` | add `scheduledFor?` to `show_list` meta |
| Server | `server/src/shows.ts` | include `scheduledFor` in `listShowMetas` |
| Operator | `apps/operator/src/app/shows/edit/page.tsx` | native date input bound to `scheduledFor` |
| Module | `src/types.ts` | `ShowMeta.scheduledFor?`; store in reducer (`state.ts`) |
| Module | `src/variables.ts` | dynamic `rundown_<n>_field_<key>` + `_template_name` |
| Module | `src/index.ts` | pass `state` to `variableDefinitions`; regen defs on loaded-show change; `select_next_show` clock injection |
| Module | `src/actions.ts` | `select_next_show` action + dispatch |
| Module | `src/presets.ts` | "Select Next Show" preset |
| Docs | `packages/companion-module/companion/HELP.md` | document new variables + action |

## Open questions deferred to implementation

- Whether to expose scripture rows' additional fields (translation, attribution)
  beyond `reference` — starting with `reference` only.
- Additional name date formats (e.g. `YYYY-MM-DD` or `Month D, YYYY` in names) if
  real show names use them; `M/D/YY[YY]` covers current data.
