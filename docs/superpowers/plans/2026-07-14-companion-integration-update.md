# Companion Integration Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the accidentally-deleted Bitfocus Companion module and extend it with per-row content-field variables and a one-press "select next show" action backed by a structured show date.

**Architecture:** Restore `packages/companion-module/` verbatim from `056f1a8^`, then layer three additive features: (A) dynamic `rundown_<n>_field_<key>` variables projected from the loaded show's rows; (B) an optional `scheduledFor` date on shows plumbed through core → ws-protocol → server → operator UI; and a pure `pickNextShow` selector the module calls to load the soonest upcoming show. All new logic is pure and unit-tested; the wall-clock lives only at the module edge.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces, `@companion-module/base` ~1.14.1, Next.js (operator UI).

## Global Constraints

- Companion SDK pinned to `@companion-module/base` `~1.14.1` (matches Companion 4.3). Do not bump.
- Show dates are date-only ISO strings `YYYY-MM-DD` (no time, no zone).
- Name-parsed date formats supported: `M/D/YY` and `M/D/YYYY` (1- or 2-digit month/day). Two-digit years map to `2000+YY`.
- `RUNDOWN_LIMIT` is 40 — dynamic row variables cover rows 1..40 only.
- Variable-id key sanitization: lowercase, collapse each run of non-`[a-z0-9]` to a single `_`, trim leading/trailing `_`.
- New protocol/schema fields are **optional** and backfill-free — existing JSON and existing clients must keep parsing.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Restore the deleted Companion module

**Files:**
- Restore (whole dir): `packages/companion-module/` from git object `056f1a8^`

**Interfaces:**
- Produces: the entire module — `src/{index,connection,state,actions,feedbacks,variables,presets,labels,config,types}.ts`, `src/__tests__/*.test.ts`, `companion/{manifest.json,HELP.md}`, `package.json`, `build.mjs`, `tsconfig.json`. Later tasks modify `variables.ts`, `actions.ts`, `index.ts`, `types.ts`, `presets.ts`, and `companion/HELP.md`.

- [ ] **Step 1: Restore the directory from before the deletion**

Run:
```bash
cd /Users/mitchellpeck/WebstormProjects/OverlaySys
git checkout 056f1a8^ -- packages/companion-module
```

- [ ] **Step 2: Confirm the tree is whole**

Run:
```bash
ls packages/companion-module/src packages/companion-module/src/__tests__ packages/companion-module/companion
```
Expected: `src` lists `actions.ts config.ts connection.ts feedbacks.ts index.ts labels.ts presets.ts state.ts types.ts variables.ts`; `__tests__` lists `actions.test.ts feedbacks.test.ts labels.test.ts state.test.ts variables.test.ts`; `companion` lists `HELP.md manifest.json`.

- [ ] **Step 3: Re-link the workspace package**

Run:
```bash
pnpm install
```
Expected: install completes; `@overlaysys/companion-module` is linked (no "missing workspace project" error).

- [ ] **Step 4: Typecheck the restored module**

Run:
```bash
pnpm --filter @overlaysys/companion-module typecheck
```
Expected: exits 0, no TS errors.

- [ ] **Step 5: Run the restored test suite and confirm green**

Run:
```bash
npx vitest run packages/companion-module
```
Expected: all suites pass (`state`, `variables`, `feedbacks`, `actions`, `labels`).

- [ ] **Step 6: Commit**

```bash
git add packages/companion-module
git commit -m "revert(companion): restore module deleted by 056f1a8

The '056f1a8 chore: remove unused tests' squash actually deleted the whole
module. Restore it verbatim from 056f1a8^ before extending it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add optional `scheduledFor` to the Show schema

**Files:**
- Modify: `packages/core/src/show.ts` (ShowSchema object, after `updatedAt`)
- Test: `packages/core/src/show.test.ts`

**Interfaces:**
- Produces: `Show.scheduledFor?: string` — consumed by Tasks 3, 4, 5, 6.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/show.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ShowSchema } from "./show";

describe("Show scheduledFor", () => {
  it("round-trips an ISO scheduledFor date", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "5/17/26 Service",
      projectId: "p1",
      rows: [],
      songs: [],
      scheduledFor: "2026-05-17",
    });
    expect(show.scheduledFor).toBe("2026-05-17");
  });

  it("leaves scheduledFor undefined when absent", () => {
    const show = ShowSchema.parse({
      id: "s2",
      name: "Untitled",
      projectId: "p1",
      rows: [],
      songs: [],
    });
    expect(show.scheduledFor).toBeUndefined();
  });
});
```
(If `describe`/`it`/`expect` are already imported at the top of the file, do not re-import — just add the `describe` block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/show.test.ts -t "scheduledFor"`
Expected: FAIL — `scheduledFor` is stripped (unknown key) so `toBe("2026-05-17")` fails.

- [ ] **Step 3: Add the field**

In `packages/core/src/show.ts`, inside the `z.object({ ... })` passed to `ShowSchema`'s `z.preprocess`, immediately after the `updatedAt: z.string().optional(),` line, add:
```ts
    /**
     * Optional service date, date-only ISO `YYYY-MM-DD`. Drives "next show"
     * selection on control surfaces. Optional/backfill-free: shows saved before
     * this field simply have no value and fall back to name-parsed dates.
     */
    scheduledFor: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/show.test.ts -t "scheduledFor"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/show.ts packages/core/src/show.test.ts
git commit -m "feat(core): optional scheduledFor date on Show

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Core date helpers — `resolveShowDate`, `pickNextShow`, `toISODate`

**Files:**
- Create: `packages/core/src/showSchedule.ts`
- Create: `packages/core/src/showSchedule.test.ts`
- Modify: `packages/core/src/index.ts` (add export)

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `resolveShowDate(input: { name: string; scheduledFor?: string }): string | null`
  - `pickNextShow(shows: { id: string; name: string; scheduledFor?: string }[], todayISO: string): string | null`
  - `toISODate(d: Date): string`
  These are consumed by the Companion module in Task 6.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/showSchedule.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveShowDate, pickNextShow, toISODate } from "./showSchedule";

describe("resolveShowDate", () => {
  it("prefers a valid scheduledFor over the name", () => {
    expect(
      resolveShowDate({ name: "1/2/24 Service", scheduledFor: "2026-05-17" }),
    ).toBe("2026-05-17");
  });

  it("parses M/D/YY from the name", () => {
    expect(resolveShowDate({ name: "5/17/26 Service" })).toBe("2026-05-17");
  });

  it("parses M/D/YYYY from the name", () => {
    expect(resolveShowDate({ name: "Christmas 12/1/2026" })).toBe("2026-12-01");
  });

  it("falls back to the name when scheduledFor is malformed", () => {
    expect(
      resolveShowDate({ name: "5/17/26 Service", scheduledFor: "not-a-date" }),
    ).toBe("2026-05-17");
  });

  it("returns null when neither source has a date", () => {
    expect(resolveShowDate({ name: "Sunday Gathering" })).toBeNull();
  });

  it("rejects impossible month/day in the name", () => {
    expect(resolveShowDate({ name: "13/40/26" })).toBeNull();
  });
});

describe("pickNextShow", () => {
  const shows = [
    { id: "past", name: "1/1/20 Old", scheduledFor: undefined },
    { id: "soon", name: "Soonest", scheduledFor: "2026-07-20" },
    { id: "later", name: "7/27/26 Later" },
    { id: "nodate", name: "No Date Here" },
  ];

  it("selects the soonest show on or after today", () => {
    expect(pickNextShow(shows, "2026-07-14")).toBe("soon");
  });

  it("includes a show scheduled exactly today", () => {
    expect(pickNextShow(shows, "2026-07-20")).toBe("soon");
  });

  it("returns null when every dated show is in the past", () => {
    expect(pickNextShow(shows, "2027-01-01")).toBeNull();
  });

  it("breaks ties by input order", () => {
    const tied = [
      { id: "b", name: "B", scheduledFor: "2026-08-01" },
      { id: "a", name: "A", scheduledFor: "2026-08-01" },
    ];
    expect(pickNextShow(tied, "2026-07-01")).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(pickNextShow([], "2026-07-14")).toBeNull();
  });
});

describe("toISODate", () => {
  it("formats local Y-M-D with zero padding", () => {
    // Month is 0-based in Date; 2026-03-05.
    expect(toISODate(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/showSchedule.test.ts`
Expected: FAIL — cannot resolve `./showSchedule`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/showSchedule.ts`:
```ts
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/;

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject days that overflow the given month (handles Feb + 30/31-day months).
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as a local `YYYY-MM-DD` calendar date. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIsoDate(s: string): string | null {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYmd(year, month, day)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseNameDate(name: string): string | null {
  const m = NAME_DATE_RE.exec(name);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const rawYear = m[3]!;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Resolves a show's date as `YYYY-MM-DD`, preferring a valid `scheduledFor`
 * and otherwise parsing a `M/D/YY` or `M/D/YYYY` date out of the name.
 * Returns `null` when neither source yields a valid date.
 */
export function resolveShowDate(input: {
  name: string;
  scheduledFor?: string;
}): string | null {
  if (input.scheduledFor) {
    const iso = parseIsoDate(input.scheduledFor);
    if (iso) return iso;
  }
  return parseNameDate(input.name);
}

/**
 * Returns the id of the show with the soonest resolved date on or after
 * `todayISO` (a `YYYY-MM-DD` string). Ties break by input order. Shows with no
 * resolvable date, or a date before today, are ignored. Returns `null` when
 * nothing qualifies.
 */
export function pickNextShow(
  shows: { id: string; name: string; scheduledFor?: string }[],
  todayISO: string,
): string | null {
  let bestId: string | null = null;
  let bestDate: string | null = null;
  for (const show of shows) {
    const date = resolveShowDate(show);
    if (date === null || date < todayISO) continue;
    // Strict `<` so the first show at a given date wins the tie.
    if (bestDate === null || date < bestDate) {
      bestDate = date;
      bestId = show.id;
    }
  }
  return bestId;
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/index.ts`, after the `export * from "./show";` line, add:
```ts
export * from "./showSchedule";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/src/showSchedule.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/showSchedule.ts packages/core/src/showSchedule.test.ts packages/core/src/index.ts
git commit -m "feat(core): resolveShowDate + pickNextShow date helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Plumb `scheduledFor` through protocol + server `show_list`

**Files:**
- Modify: `packages/ws-protocol/src/index.ts:239-248` (`show_list` message shape)
- Modify: `server/src/shows.ts:29-39` (`listShowMetas`)
- Create: `packages/ws-protocol/src/schema.test.ts`

**Interfaces:**
- Consumes: `Show.scheduledFor` (Task 2).
- Produces: `show_list` messages now carry `shows[].scheduledFor?: string` — consumed by the module reducer in Task 6.

- [ ] **Step 1: Write the failing test**

Create `packages/ws-protocol/src/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decodeServer, encode } from "./index";

describe("show_list scheduledFor", () => {
  it("decodes a show_list entry carrying scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [
        { id: "s1", name: "5/17/26", projectId: "p1", rowCount: 3, scheduledFor: "2026-05-17" },
      ],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBe("2026-05-17");
  });

  it("decodes a show_list entry without scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [{ id: "s2", name: "Untitled", projectId: "p1", rowCount: 0 }],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ws-protocol/src/schema.test.ts`
Expected: FAIL — `encode(...)` is a TS error because `scheduledFor` isn't in the `show_list` shape (or the decoded value is `undefined`).

- [ ] **Step 3: Add `scheduledFor` to the protocol shape**

In `packages/ws-protocol/src/index.ts`, in the `show_list` message object (the `shows: z.array(z.object({ ... }))`), add `scheduledFor` after `rowCount`:
```ts
  z.object({
    type: z.literal("show_list"),
    shows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        projectId: z.string(),
        rowCount: z.number(),
        scheduledFor: z.string().optional(),
      }),
    ),
  }),
```

- [ ] **Step 4: Include `scheduledFor` in the server's meta list**

In `server/src/shows.ts`, update `listShowMetas`:

Change the return type annotation:
```ts
export async function listShowMetas(): Promise<
  { id: string; name: string; projectId: string; rowCount: number; scheduledFor?: string }[]
> {
```
And add the field to the mapped object (after `rowCount: s.rows.length,`):
```ts
    scheduledFor: s.scheduledFor,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/ws-protocol/src/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the server**

Run: `pnpm --filter @overlaysys/server typecheck`
Expected: exits 0. (If the server package name differs, use the name from `server/package.json`.)

- [ ] **Step 7: Commit**

```bash
git add packages/ws-protocol/src/index.ts packages/ws-protocol/src/schema.test.ts server/src/shows.ts
git commit -m "feat(protocol): carry scheduledFor in show_list metas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Operator UI — show date picker

**Files:**
- Modify: `apps/operator/src/app/shows/edit/page.tsx:442-444` (AppHeader context, after the name input)

**Interfaces:**
- Consumes: `Show.scheduledFor` (Task 2), the local `update(recipe)` helper (defined at `page.tsx:188`), and `colors`.
- Produces: operator can set/clear a show's date; persisted via the existing `save_show` path.

- [ ] **Step 1: Add a native date input beside the show name**

In `apps/operator/src/app/shows/edit/page.tsx`, immediately after the show-name `<input>` closes (the `/>` on the line following `onChange={(e) => update((s) => { s.name = e.target.value; })}`) and before `<span style={{ color: colors.textDim, fontSize: 11 }}>{draft.id}</span>`, insert:
```tsx
            <input
              type="date"
              value={draft.scheduledFor ?? ""}
              onChange={(e) =>
                update((s) => {
                  const v = e.target.value;
                  if (v) s.scheduledFor = v;
                  else delete s.scheduledFor;
                })
              }
              title="Service date (used by Companion 'select next show')"
              style={{
                background: "transparent",
                border: `1px solid ${colors.border ?? "transparent"}`,
                color: colors.text,
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            />
```
Note: a native `<input type="date">` emits/consumes exactly `YYYY-MM-DD`, matching `scheduledFor`. If `colors.border` does not exist on the theme object, use `"transparent"` directly.

- [ ] **Step 2: Typecheck the operator app**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: exits 0. (Use the operator package's real name from `apps/operator/package.json` if different.)

- [ ] **Step 3: Manual smoke (build only) to confirm it compiles in the page**

Run: `npx tsc --noEmit -p apps/operator/tsconfig.json`
Expected: exits 0 (no errors introduced in `shows/edit/page.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/shows/edit/page.tsx
git commit -m "feat(operator): service date picker on show editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Module — `select_next_show` action + preset

**Files:**
- Modify: `packages/companion-module/src/types.ts` (`ShowMeta`)
- Modify: `packages/companion-module/src/actions.ts` (ActionId union, `selectNextShowResult`, `actionDefinitions`)
- Modify: `packages/companion-module/src/index.ts` (`runAction`)
- Modify: `packages/companion-module/src/presets.ts` (new preset)
- Test: `packages/companion-module/src/__tests__/actions.test.ts`

**Interfaces:**
- Consumes: `pickNextShow`, `toISODate` (Task 3); `ShowMeta` metas now carry `scheduledFor` (Task 4); existing `DispatchResult`, `LocalEvent`, `CompanionState`.
- Produces: `selectNextShowResult(state: CompanionState, todayISO: string): DispatchResult` and an action id `"select_next_show"`.

- [ ] **Step 1: Add `scheduledFor` to `ShowMeta`**

In `packages/companion-module/src/types.ts`, extend the `ShowMeta` interface:
```ts
export interface ShowMeta {
  id: string;
  name: string;
  rowCount: number;
  scheduledFor?: string;
}
```
(The `state.ts` reducer already assigns the whole `show_list` array to `state.shows`, so no reducer change is needed — the field flows through once the type allows it.)

- [ ] **Step 2: Write the failing test**

Add to `packages/companion-module/src/__tests__/actions.test.ts` (reuse the file's existing `initialState` import; if it imports from `../types`, keep that):
```ts
import { selectNextShowResult } from "../actions";
import { initialState } from "../types";

describe("selectNextShowResult", () => {
  function stateWithShows() {
    const s = initialState();
    s.shows = [
      { id: "past", name: "1/1/20 Old", rowCount: 0 },
      { id: "soon", name: "Soonest", rowCount: 2, scheduledFor: "2026-07-20" },
      { id: "later", name: "7/27/26 Later", rowCount: 1 },
    ];
    return s;
  }

  it("loads the soonest upcoming show", () => {
    const { messages, localEvents } = selectNextShowResult(
      stateWithShows(),
      "2026-07-14",
    );
    expect(localEvents).toEqual([{ type: "local_load_show", showId: "soon" }]);
    expect(messages).toEqual([{ type: "get_show", showId: "soon" }]);
  });

  it("is a no-op when nothing is scheduled today or later", () => {
    const { messages, localEvents } = selectNextShowResult(
      stateWithShows(),
      "2027-01-01",
    );
    expect(messages).toEqual([]);
    expect(localEvents).toEqual([]);
  });
});
```
(If `describe`/`it`/`expect` are auto-globals in this suite, omit any vitest import; match the file's existing style.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/companion-module -t "selectNextShowResult"`
Expected: FAIL — `selectNextShowResult` is not exported.

- [ ] **Step 4: Implement `selectNextShowResult` and register the action**

In `packages/companion-module/src/actions.ts`:

Add to the imports at the top (there is already a `import type { RundownRow } from "@overlaysys/core";` line — extend it):
```ts
import type { RundownRow } from "@overlaysys/core";
import { pickNextShow } from "@overlaysys/core";
```

Add `"select_next_show"` to the `ActionId` union (after `"clear_loaded_show"`):
```ts
  | "clear_loaded_show"
  | "select_next_show"
```

Add the pure helper (place it just above `export function dispatchAction`):
```ts
/**
 * Resolves the soonest show scheduled today or later and returns the load-show
 * dispatch for it. `todayISO` is injected by the caller so this stays pure and
 * testable; the wall-clock lives at the module edge (index.ts). No qualifying
 * show → empty result (caller logs a warning).
 */
export function selectNextShowResult(
  state: CompanionState,
  todayISO: string,
): DispatchResult {
  const showId = pickNextShow(state.shows, todayISO);
  if (!showId) return { messages: [], localEvents: [] };
  return {
    messages: [{ type: "get_show", showId }],
    localEvents: [{ type: "local_load_show", showId }],
  };
}
```

Register the action definition. In `actionDefinitions`'s returned object, right after the `clear_loaded_show: { ... },` entry, add:
```ts
    select_next_show: {
      name: "Select next show (soonest today or later)",
      options: [],
      callback: wrap("select_next_show"),
    },
```

- [ ] **Step 5: Wire the clock at the edge in `index.ts`**

In `packages/companion-module/src/index.ts`:

Extend the actions import to also pull the helper:
```ts
import {
  dispatchAction,
  selectNextShowResult,
  actionDefinitions,
  type ActionId,
  type ActionOptions,
} from "./actions.js";
```
Add a core import near the other imports:
```ts
import { toISODate } from "@overlaysys/core";
```

In `runAction`, at the very top of the method body (before the existing `const { messages, localEvents } = dispatchAction(...)` line), add:
```ts
    if (id === "select_next_show") {
      const todayISO = toISODate(new Date());
      const { messages, localEvents } = selectNextShowResult(
        this.state,
        todayISO,
      );
      for (const e of localEvents) this.applyEvent(e);
      for (const m of messages) this.connection?.send(m);
      const loaded = localEvents.find((e) => e.type === "local_load_show");
      if (loaded && loaded.type === "local_load_show") {
        this.currentConfig = {
          ...this.currentConfig,
          loadedShowId: loaded.showId,
        };
        this.saveConfig(this.currentConfig);
      } else {
        this.log("warn", "select_next_show: no show scheduled today or later");
      }
      return;
    }
```

- [ ] **Step 6: Add a preset button**

In `packages/companion-module/src/presets.ts`, add before the final `return presets;` (place it in the existing style; a "Master" category button is fine):
```ts
  presets["select_next_show"] = {
    type: "button",
    category: "Master",
    name: "Select Next Show",
    style: { text: "NEXT\\nSHOW", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "select_next_show", options: {} }], up: [] },
    ],
    feedbacks: [],
  };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/companion-module -t "selectNextShowResult"`
Expected: PASS.

- [ ] **Step 8: Typecheck the module**

Run: `pnpm --filter @overlaysys/companion-module typecheck`
Expected: exits 0 (confirms the `runAction` `select_next_show` branch, preset, and definition all type-check).

- [ ] **Step 9: Commit**

```bash
git add packages/companion-module/src/types.ts packages/companion-module/src/actions.ts packages/companion-module/src/index.ts packages/companion-module/src/presets.ts packages/companion-module/src/__tests__/actions.test.ts
git commit -m "feat(companion): select-next-show action + preset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Module — per-row content-field variables

**Files:**
- Modify: `packages/companion-module/src/variables.ts` (`variableDefinitions`, `projectVariables`, new `rundownFieldEntries`)
- Modify: `packages/companion-module/src/index.ts` (`refreshAll`, `applyEvent`, new `mutatesRundownVariables`)
- Test: `packages/companion-module/src/__tests__/variables.test.ts`

**Interfaces:**
- Consumes: `CompanionState`, `RUNDOWN_LIMIT`, `state.showCache`, `state.templates`.
- Produces: `rundownFieldEntries(state: CompanionState): { id: string; name: string; value: string }[]`; `variableDefinitions(channels, state?)` now appends the dynamic defs; `projectVariables` now emits their values.

- [ ] **Step 1: Write the failing test**

Add to `packages/companion-module/src/__tests__/variables.test.ts` (match the file's existing helpers for constructing state and its `projectVariables`/`variableDefinitions` imports):
```ts
import { rundownFieldEntries } from "../variables";

describe("rundown field variables", () => {
  function stateWithLoadedShow() {
    const s = initialState();
    s.templates = [{ id: "tpl1", name: "Section Intro", size: { w: 1920, h: 1080 } }];
    const show = {
      id: "show1",
      name: "Demo",
      projectId: "p1",
      songs: [],
      rows: [
        {
          kind: "graphic" as const,
          id: "r1",
          templateId: "tpl1",
          data: { title: "Welcome", "Sub Title": "Good morning" },
        },
        {
          kind: "scripture" as const,
          id: "r2",
          reference: "John 3:16",
          translation: "kjv",
          slides: [{ id: "sl1", verses: [{ book: "John", chapter: 3, verse: 16, text: "x" }] }],
          templateId: "tpl1",
        },
      ],
    };
    s.showCache.set("show1", show);
    s.loadedShowId = "show1";
    return s;
  }

  it("exposes graphic row data fields by sanitized key", () => {
    const entries = rundownFieldEntries(stateWithLoadedShow());
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.value]));
    expect(byId["rundown_1_field_title"]).toBe("Welcome");
    expect(byId["rundown_1_field_sub_title"]).toBe("Good morning");
    expect(byId["rundown_1_template_name"]).toBe("Section Intro");
  });

  it("exposes scripture reference and no data fields for it", () => {
    const entries = rundownFieldEntries(stateWithLoadedShow());
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.value]));
    expect(byId["rundown_2_field_reference"]).toBe("John 3:16");
  });

  it("emits nothing when no show is loaded", () => {
    expect(rundownFieldEntries(initialState())).toEqual([]);
  });

  it("projectVariables includes the dynamic field values", () => {
    const vars = projectVariables(stateWithLoadedShow(), ["program"]);
    expect(vars["rundown_1_field_title"]).toBe("Welcome");
  });

  it("variableDefinitions includes the dynamic field ids when state is given", () => {
    const defs = variableDefinitions(["program"], stateWithLoadedShow());
    expect(defs.some((d) => d.variableId === "rundown_1_field_title")).toBe(true);
  });
});
```
(Use the file's existing `initialState`, `projectVariables`, and `variableDefinitions` imports; add only `rundownFieldEntries`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/companion-module -t "rundown field variables"`
Expected: FAIL — `rundownFieldEntries` is not exported (and `variableDefinitions` rejects a 2nd arg).

- [ ] **Step 3: Implement the field-entry projection**

In `packages/companion-module/src/variables.ts`, add near the top (after the existing imports):
```ts
function sanitizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface RundownFieldEntry {
  id: string;
  name: string;
  value: string;
}

/**
 * Per-row content-field variables for the loaded show: graphic rows expose each
 * `data[key]` as `rundown_<n>_field_<key>` (key sanitized) plus
 * `rundown_<n>_template_name`; scripture rows expose `rundown_<n>_field_reference`.
 * Definitions and values both derive from this list so they never drift.
 */
export function rundownFieldEntries(state: CompanionState): RundownFieldEntry[] {
  const entries: RundownFieldEntry[] = [];
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  if (!show) return entries;
  const count = Math.min(show.rows.length, RUNDOWN_LIMIT);
  for (let i = 0; i < count; i++) {
    const row = show.rows[i]!;
    const n = i + 1;
    if (row.kind === "graphic") {
      const tpl = state.templates.find((t) => t.id === row.templateId);
      entries.push({
        id: `rundown_${n}_template_name`,
        name: `Rundown row ${n} template name`,
        value: tpl?.name ?? row.templateId,
      });
      for (const [rawKey, value] of Object.entries(row.data)) {
        const key = sanitizeKey(rawKey);
        if (!key) continue;
        entries.push({
          id: `rundown_${n}_field_${key}`,
          name: `Rundown row ${n} field ${rawKey}`,
          value,
        });
      }
    } else if (row.kind === "scripture") {
      entries.push({
        id: `rundown_${n}_field_reference`,
        name: `Rundown row ${n} reference`,
        value: row.reference,
      });
    }
  }
  return entries;
}
```

- [ ] **Step 4: Append dynamic definitions and values**

Still in `variables.ts`:

Change the signature of `variableDefinitions` to accept optional state:
```ts
export function variableDefinitions(
  channels: string[],
  state?: CompanionState,
): VariableDefinition[] {
```
Then, immediately before its final `return defs;`, add:
```ts
  if (state) {
    for (const e of rundownFieldEntries(state)) {
      defs.push({ variableId: e.id, name: e.name });
    }
  }
```

In `projectVariables`, immediately before its final `return out;`, add:
```ts
  for (const e of rundownFieldEntries(state)) {
    out[e.id] = e.value;
  }
```

- [ ] **Step 5: Regenerate definitions when the loaded show changes**

In `packages/companion-module/src/index.ts`:

In `refreshAll`, change the variable-definitions call to pass state:
```ts
    this.setVariableDefinitions(variableDefinitions(this.channels, this.state));
```

In `applyEvent`, after the existing `if (mutatesDropdownSources(evt)) { this.refreshDefinitions(); }` block and before `this.refreshDynamic();`, add:
```ts
    if (mutatesRundownVariables(evt, this.state)) {
      this.setVariableDefinitions(
        variableDefinitions(this.channels, this.state),
      );
    }
```

Add the gate helper next to `mutatesDropdownSources` (bottom of the file):
```ts
/**
 * True when an event changes the loaded show's rows, so the dynamic
 * `rundown_<n>_field_*` variable *definitions* must be regenerated. `state` is
 * post-apply, so a `show` upsert is only relevant when it is the loaded show.
 */
function mutatesRundownVariables(
  evt: ReducerEvent,
  state: CompanionState,
): boolean {
  switch (evt.type) {
    case "local_load_show":
    case "local_clear_loaded_show":
      return true;
    case "show":
      return evt.show.id === state.loadedShowId;
    default:
      return false;
  }
}
```
Ensure `CompanionState` is imported in `index.ts` — it already is via `import { initialState, type CompanionState } from "./types.js";`.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run packages/companion-module -t "rundown field variables"`
Expected: PASS.

- [ ] **Step 7: Run the full module suite to confirm nothing regressed**

Run: `npx vitest run packages/companion-module`
Expected: all suites pass (existing `variableDefinitions(channels)` one-arg calls still compile because `state` is optional).

- [ ] **Step 8: Typecheck the module**

Run: `pnpm --filter @overlaysys/companion-module typecheck`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add packages/companion-module/src/variables.ts packages/companion-module/src/index.ts packages/companion-module/src/__tests__/variables.test.ts
git commit -m "feat(companion): per-row content-field variables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Document the new variables and action in HELP.md

**Files:**
- Modify: `packages/companion-module/companion/HELP.md`

**Interfaces:**
- Consumes: the variables/action delivered in Tasks 6–7.
- Produces: user-facing docs (no code).

- [ ] **Step 1: Add documentation sections**

In `packages/companion-module/companion/HELP.md`, add a "What's new" style section (place it near the existing actions/variables reference — match the file's heading style):
```markdown
## Select next show

The **Select next show (soonest today or later)** action loads the show whose
service date is the soonest on or after today, then resets the row cursor — the
same as picking it via **Load show**, but with no dropdown. A show's date comes
from its `scheduledFor` field (set in the operator's show editor); if that is
empty, the date is parsed from the show name (`M/D/YY` or `M/D/YYYY`, e.g.
"5/17/26 Service"). If nothing is scheduled today or later, the button does
nothing and logs a warning. A ready-to-use **Select Next Show** preset button is
included.

## Rundown row content fields

For the loaded show, each row exposes its content as variables:

- `rundown_<n>_field_<key>` — a graphic row's `data` value, addressable by field
  key. The key is lowercased with non-alphanumeric runs collapsed to `_` (e.g. a
  `Sub Title` field becomes `rundown_3_field_sub_title`). Use these to put the
  actual title/subtitle on a button instead of the template name.
- `rundown_<n>_template_name` — the row's template name (e.g. "Section Intro").
- `rundown_<n>_field_reference` — a scripture row's reference (e.g. "John 3:16").

`<n>` is the 1-based row number, up to 40. These update whenever the loaded show
changes. If two field keys sanitize to the same id, the later one wins.
```

- [ ] **Step 2: Commit**

```bash
git add packages/companion-module/companion/HELP.md
git commit -m "docs(companion): document next-show action + row-field variables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full test sweep**

Run:
```bash
npx vitest run packages/core packages/ws-protocol packages/companion-module
```
Expected: all pass.

- [ ] **Typecheck the touched packages**

Run:
```bash
pnpm --filter @overlaysys/core typecheck
pnpm --filter @overlaysys/companion-module typecheck
pnpm --filter @overlaysys/operator typecheck
pnpm --filter @overlaysys/server typecheck
```
Expected: each exits 0. (Substitute the real package names from each `package.json` if they differ.)

- [ ] **Module bundles**

Run: `pnpm --filter @overlaysys/companion-module build`
Expected: `node build.mjs` completes and emits the bundle without error.
