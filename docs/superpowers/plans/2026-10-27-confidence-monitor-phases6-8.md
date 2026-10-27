# Confidence Monitor — Phases 6–8 (Stage Timers, Item Countdown, PCO Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage monitors show timers that need no graphic template, an automatic "current item" countdown that runs into red overtime, and (optionally) the service position and item timing from Planning Center Services Live.

**Architecture:** A server-memory timer list (`server/src/timers.ts`) is mutated only through a pure core reducer (`reduceTimers`). It is broadcast to operator/Companion as `timers_state` and folded into every `stage_feed` ahead of graphic-template timers. Rows gain `lengthSec` (imported from PCO `length`). The existing `channels.onLiveRow` hook starts a single `"current-item"` countdown when a row with a length goes to air. A polling loop (`server/src/pco/pcoLiveSync.ts`) maps PCO Live through a pure `mapPcoLive` into `StageFeed.service`. While it runs it drives the item timer itself and suppresses the take-based auto-start.

**Tech Stack:** TypeScript, zod 3, Fastify + `ws`, React 19 + Vite renderer, Next 15 operator, `@companion-module/base`, Vitest 4 (node env, logic tests only).

**Spec:** `docs/superpowers/specs/2026-10-27-stage-timers-pco-live-design.md` (extends `docs/superpowers/specs/2026-10-22-confidence-monitor-design.md`)

## Global Constraints

- Timers live in server memory only; a server restart drops them.
- At most one timer with `source` `"item"` or `"pco"`; its id is always `"current-item"` (`CURRENT_ITEM_TIMER_ID`).
- The server never ticks timers: every consumer computes the display from `anchor` / `pausedAt` (+ server-time offset in the renderer, as today).
- Graphic-template timers on program output keep clamping at zero; overtime (`+M:SS`, red) applies only to stage timers whose `overtime` is true.
- Feed timer order: current item timer → manual timers in creation order → graphic timers (followed channel first, as today). `firstActive` therefore picks the item timer when one exists.
- `lengthSec` is a non-negative integer on every row kind; PCO `length` of 0 or missing → absent.
- Re-import refreshes `lengthSec` from PCO unless the row has `lengthSecManual: true`.
- Stage settings additions: `autoItemTimer` default `true`, `itemTimerOvertime` default `true`. Existing `data/settings/stage.json` files must parse unchanged.
- Timer widget prop defaults: `warnBelowSec` 60, `warnColor` `#ffb703`, `overColor` `#ef233c`, `showLabel` false.
- PCO Live is read-only (no writes to PCO, no auto-takes), polled every 5000 ms, backoff on network error doubling to a 60 000 ms cap, stops on `PcoAuthError`. Runtime only, off by default.
- `PROTOCOL_VERSION` is unchanged (additive messages; old Companion builds drop unknown server types via `decodeServerTolerant`).
- Tests: Vitest node env, logic only; UI verified by `pnpm typecheck`, `pnpm build` and the manual checklist in Task 13.

## Review Focus

- A lyric advance, scripture slide change or song sub-take retakes the same row → the item countdown must not restart. (Task 7 test `same row does not restart`.)
- The same row is taken to two non-preview channels at once (program + a mirror-less second output) → one item timer, started once. (Task 7 test `second channel take of same row is a no-op`.)
- `timer_adjust` pushes a countdown that has not started below zero, or a client sends a huge or negative `durationMs` → duration clamps to `[0, 24 h]` and nothing produces NaN. (Task 1 tests.)
- PCO Live returns no current item (service not started, or ended) while sync is on → the feed shows `status` `notStarted`/`ended`, the PCO item timer is cleared, and the take-based item timer is *not* suppressed. (Task 10 + Task 11 tests.)
- The operator stops PCO Live sync or loads a different show while PCO drives the item timer → the `pco` item timer is cleared; a manual timer is untouched. (Task 11 test.)

---

## File Structure

**Core (`packages/core/src/`)**
- Create `stageTimers.ts` — `StageTimerInstanceSchema`, `CURRENT_ITEM_TIMER_ID`, `reduceTimers`, `timerMs`, `timerPhase`, `stageTimerValue`.
- Modify `timeField.ts` — `formatSignedTime`.
- Modify `stageFeed.ts` — `StageTimer` fields `id`, `source`, `overtime`, `running`; `channel` optional; `StageServiceViewSchema`; `StageFeed.service`.
- Modify `stageLayout.ts` — timer widget sources/props, `rowTitle.prefer`, `serviceProgress` widget.
- Modify `stageSettings.ts` — `autoItemTimer`, `itemTimerOvertime`.
- Modify `show.ts` — `lengthSec`, `lengthSecManual` on every row kind.
- Modify `pco/pcoTypes.ts` — `PcoPlanItem.lengthSec`, PCO Live raw types.
- Create `pco/pcoLive.ts` — `mapPcoLive`, `serviceDeltaSec`.
- Modify `index.ts`.

**Protocol (`packages/ws-protocol/src/index.ts`)** — client `timer_create`, `timer_start`, `timer_pause`, `timer_resume`, `timer_reset`, `timer_delete`, `timer_adjust`, `pco_live_start`, `pco_live_stop`; server `timers_state`, `pco_live_state`.

**Server (`server/src/`)**
- Create `timers.ts` — holder, `onRowTaken`, broadcast message.
- Modify `stageFeed.ts`, `stageFeedHub.ts` — timers + service into the feed.
- Modify `ws.ts` — handlers, wiring, connect-time sends.
- Modify `pco/pcoClient.ts` — `lengthSec` mapping, `getLive`.
- Modify `pco/importPlan.ts` — `lengthSec` on new/re-imported rows.
- Create `pco/pcoLiveSync.ts` — polling loop, state, item-timer driving.
- Create `pco/__fixtures__/live.json` — captured PCO Live response.

**Renderer (`apps/renderer/src/stage/`)** — `stageTime.ts` (`stageTimerView`), `widgets.tsx` (timer, rowTitle, serviceProgress).

**Operator (`apps/operator/src/`)**
- Modify `lib/store.ts`, `lib/useWs.ts` — `stageTimers`, `pcoLive`.
- Create `app/components/StageTimersSection.tsx`; modify `app/components/TimersRail.tsx`.
- Create `lib/rowLength.ts` (+ test) — parse/format the row length input.
- Modify `app/shows/edit/page.tsx` — Length input next to each "Notes set" picker.
- Modify `app/settings/stage/page.tsx` — two toggles.
- Modify `app/components/StagePanel.tsx` — PCO Live toggle + status.

**Companion (`packages/companion-module/src/`)** — `types.ts`, `state.ts`, `actions.ts`, `variables.ts`, `feedbacks.ts`, `index.ts`.

---

# Phase 6 — Standalone timers

### Task 1: Core — timer instance, reducer, display helpers

**Files:**
- Create: `packages/core/src/stageTimers.ts`, `packages/core/src/stageTimers.test.ts`
- Modify: `packages/core/src/timeField.ts`, `packages/core/src/timeField.test.ts` (create if absent), `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `StageTimerInstanceSchema` / `StageTimerInstance` — `{ id: string; label: string (max 60); mode: "countdown" | "countup"; durationMs?: number; anchor: number | null; pausedAt?: number; overtime: boolean; source: "manual" | "item" | "pco"; rowId?: string }`
  - `CURRENT_ITEM_TIMER_ID = "current-item"`, `MAX_TIMER_DURATION_MS = 86_400_000`, `MAX_MANUAL_TIMERS = 20`
  - `TimerAction` =
    `{ type: "create"; id: string; label: string; mode; durationMs?: number; overtime: boolean }`
    `| { type: "start" | "pause" | "resume" | "reset" | "delete"; id: string }`
    `| { type: "adjust"; id: string; deltaMs: number }`
    `| { type: "setItem"; label: string; anchor: number; durationMs?: number; overtime: boolean; source: "item" | "pco"; rowId: string }`
    `| { type: "clearItem"; source?: "item" | "pco" }`
  - `reduceTimers(timers: StageTimerInstance[], a: TimerAction, now: number): StageTimerInstance[]` — returns the same array reference when nothing changed.
  - `timerMs(t: { mode; anchor: number | null; pausedAt?: number; durationMs?: number }, now: number): number` — countdown: remaining ms (negative when over; `durationMs ?? 0` when not started); countup: elapsed ms (0 when not started).
  - `timerPhase(mode, ms: number, overtime: boolean, warnBelowMs: number): "normal" | "warn" | "over"`
  - `stageTimerValue(t: StageTimerInstance, now: number): string` — encoded `TimerValue` for the feed; a not-started timer encodes as paused at its start (`{ a: now + (durationMs ?? 0), p: now }` for countdown, `{ a: now, p: now }` for countup).
  - `formatSignedTime(remainingMs: number, format: TimeFormat): string` in `timeField.ts` — `remainingMs >= 0` → `formatTime(remainingMs)`; negative → `"+" + formatTime(-remainingMs)`.

Reducer rules (the tests pin them):
- `create`: ignored if id exists, or if there are already `MAX_MANUAL_TIMERS` manual timers. `source: "manual"`, `anchor: null`. `durationMs` clamped to `[0, MAX_TIMER_DURATION_MS]`; it is required for countdown and treated as 0 if missing. Label is trimmed and cut to 60 chars, falling back to `"Timer"` if empty.
- `start`: if not started → countdown `anchor = now + durationMs`, countup `anchor = now`. If paused → same as `resume`. If running → unchanged.
- `pause`: running only → `pausedAt = now`.
- `resume`: paused only → `anchor += now - pausedAt`, drop `pausedAt`.
- `reset`: running → restart running from full (countdown `now + durationMs`, countup `now`). Paused or not started → `anchor: null`, no `pausedAt`.
- `adjust`: countdown running/paused → `anchor += deltaMs`. Count-up → `anchor -= deltaMs`, but never later than `pausedAt ?? now`. Not-started countdown → `durationMs = clamp(durationMs + deltaMs, 0, MAX)`.
- `delete`: removes by id (the item timer too).
- `setItem`: replaces any existing `current-item` (in place, keeping its index) or inserts it at index 0. `durationMs` is clamped.
- `clearItem`: removes `current-item`; with `source` given, only if the sources match.
- Unknown id → unchanged reference.

- [ ] **Step 1: Write the failing tests** in `stageTimers.test.ts` (`const NOW = 1_000_000`):

```ts
it("create then start a countdown", () => {
  let t = reduceTimers([], { type: "create", id: "a", label: " Sermon ", mode: "countdown", durationMs: 600_000, overtime: true }, NOW);
  expect(t[0]).toMatchObject({ id: "a", label: "Sermon", anchor: null, source: "manual" });
  t = reduceTimers(t, { type: "start", id: "a" }, NOW);
  expect(t[0]!.anchor).toBe(NOW + 600_000);
});
it("clamps duration to [0, 24h]", () => {
  const t = reduceTimers([], { type: "create", id: "a", label: "x", mode: "countdown", durationMs: 9e12, overtime: false }, NOW);
  expect(t[0]!.durationMs).toBe(86_400_000);
});
it("adjust below zero on a not-started countdown floors at 0", () => {
  let t = reduceTimers([], { type: "create", id: "a", label: "x", mode: "countdown", durationMs: 30_000, overtime: false }, NOW);
  t = reduceTimers(t, { type: "adjust", id: "a", deltaMs: -60_000 }, NOW);
  expect(t[0]!.durationMs).toBe(0);
  expect(Number.isNaN(timerMs(t[0]!, NOW))).toBe(false);
});
it("pause/resume shifts the anchor by the paused span", () => {
  let t = reduceTimers([], { type: "create", id: "a", label: "x", mode: "countdown", durationMs: 60_000, overtime: false }, NOW);
  t = reduceTimers(t, { type: "start", id: "a" }, NOW);
  t = reduceTimers(t, { type: "pause", id: "a" }, NOW + 10_000);
  expect(timerMs(t[0]!, NOW + 99_000)).toBe(50_000);
  t = reduceTimers(t, { type: "resume", id: "a" }, NOW + 20_000);
  expect(t[0]!.anchor).toBe(NOW + 70_000);
});
it("adjust on a paused countdown changes remaining", () => {/* start, pause at +10s, adjust +60s → timerMs = 110_000 */});
it("reset keeps a running timer running from full and stops a paused one", () => {/* … */});
it("countup adjust never moves anchor after now", () => {/* start countup at NOW, adjust +5_000 at NOW+1_000 → anchor NOW-4_000; adjust -10_000 → anchor NOW+1_000 */});
it("refuses a 21st manual timer", () => {/* 20 creates then one more → length 20 */});
it("setItem replaces in place and keeps a single item timer", () => {
  let t = reduceTimers([], { type: "create", id: "m", label: "m", mode: "countup", overtime: false }, NOW);
  t = reduceTimers(t, { type: "setItem", label: "Welcome", anchor: NOW + 300_000, durationMs: 300_000, overtime: true, source: "item", rowId: "r1" }, NOW);
  t = reduceTimers(t, { type: "setItem", label: "Sermon", anchor: NOW + 900_000, durationMs: 900_000, overtime: true, source: "item", rowId: "r2" }, NOW);
  expect(t.map((x) => x.id)).toEqual(["current-item", "m"]);
  expect(t[0]).toMatchObject({ label: "Sermon", rowId: "r2" });
});
it("clearItem with a source only clears a matching item timer", () => {/* setItem source item; clearItem {source:"pco"} → unchanged ref; clearItem {} → removed */});
it("unknown id returns the same array", () => { const t: StageTimerInstance[] = []; expect(reduceTimers(t, { type: "pause", id: "nope" }, NOW)).toBe(t); });
it("timerPhase", () => {
  expect(timerPhase("countdown", 120_000, true, 60_000)).toBe("normal");
  expect(timerPhase("countdown", 59_000, true, 60_000)).toBe("warn");
  expect(timerPhase("countdown", -1_000, true, 60_000)).toBe("over");
  expect(timerPhase("countdown", -1_000, false, 60_000)).toBe("warn");
  expect(timerPhase("countup", 5_000, true, 60_000)).toBe("normal");
});
it("stageTimerValue encodes a not-started countdown as paused at full", () => {
  const t = reduceTimers([], { type: "create", id: "a", label: "x", mode: "countdown", durationMs: 60_000, overtime: false }, NOW);
  expect(decodeTimerValue(stageTimerValue(t[0]!, NOW))).toEqual({ anchor: NOW + 60_000, pausedAt: NOW });
});
```

and in `timeField.test.ts`:

```ts
it("formatSignedTime", () => {
  expect(formatSignedTime(65_000, "M:SS")).toBe("1:05");
  expect(formatSignedTime(-83_000, "M:SS")).toBe("+1:23");
  expect(formatSignedTime(0, "MM:SS")).toBe("00:00");
});
```

Fill in the bodies of the tests sketched with comments, using the values given in them.

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/stageTimers.test.ts packages/core/src/timeField.test.ts`. Expected: FAIL, the module doesn't exist yet.
- [ ] **Step 3: Implement** the Produces list in `stageTimers.ts` and `timeField.ts`, then export both from `index.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): stage timer instances, reducer and signed time`

### Task 2: Core — feed and layout schema for stage timers

**Files:**
- Modify: `packages/core/src/stageFeed.ts`, `packages/core/src/stageLayout.ts`, `packages/core/src/stageFeed.test.ts`, `packages/core/src/stageLayout.test.ts`

**Interfaces:**
- Produces:
  - `StageTimerSchema` gains `id: string`, `source: z.enum(["graphic", "manual", "item", "pco"])`, `overtime: z.boolean()`, `running: z.boolean()`, and `label` now carries the instance label. `channel` becomes `.optional()`.
  - `StageTimerSourceSchema` = `"firstActive" | "currentItem" | { channel: string } | { timerId: string }`.
  - Timer widget props: `{ source (default "firstActive"), warnBelowSec: number ≥ 0 (default 60), warnColor: string (default "#ffb703"), overColor: string (default "#ef233c"), showLabel: boolean (default false) }`.

- [ ] **Step 1: Write failing tests:**
  - `stageLayout.test.ts` "timer widget defaults": parsing `{ kind: "timer", …, props: {} }` yields `{ source: "firstActive", warnBelowSec: 60, warnColor: "#ffb703", overColor: "#ef233c", showLabel: false }`. Sources `"currentItem"` and `{ timerId: "x" }` both parse.
  - "Speaker layout still parses": `SPEAKER_LAYOUT` round-trips through `StageLayoutSchema.parse`.
  - `stageFeed.test.ts` "standalone timer without channel parses": a `StageTimer` with `{ id: "a", source: "manual", overtime: true, running: false, label: "x", mode: "countdown", value: "1" }` and no channel parses.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/stageLayout.test.ts packages/core/src/stageFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema changes.
- [ ] **Step 4: Run** the same command, then `pnpm typecheck`. Expected: tests PASS. Typecheck reports errors in `server/src/stageFeed.ts` (missing fields). Those are fixed in Task 4. Leave them for now, but nothing else should error.
- [ ] **Step 5: Commit** `feat(core): stage timer feed fields and timer widget props`

### Task 3: Protocol + server timer engine + WS handlers

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`, `packages/ws-protocol/src/schema.test.ts`
- Create: `server/src/timers.ts`, `server/src/timers.test.ts`
- Modify: `server/src/ws.ts`

**Interfaces:**
- Consumes: `reduceTimers`, `TimerAction`, `StageTimerInstanceSchema` (Task 1).
- Produces:
  - Client messages: `timer_create { label: string max 60; mode; durationMs?: number; overtime?: boolean (default true) }`, `timer_start | timer_pause | timer_resume | timer_reset | timer_delete { id: string }`, `timer_adjust { id: string; deltaMs: number }`.
  - Server message: `timers_state { timers: StageTimerInstance[] }`.
  - `server/src/timers.ts`: `getTimers(): StageTimerInstance[]`, `dispatchTimers(a: TimerAction, now?: number): void`, `createTimer(input: { label; mode; durationMs?; overtime }): string` (server-generated `randomUUID()` id, returns it), `subscribeTimers(l: (t: StageTimerInstance[]) => void): () => void`, `timersStateMessage(): ServerMessage`, `_resetForTest(): void`. Same listener pattern as `stageState.ts` (`commit` skips the same reference; a throwing listener is logged and doesn't stop the others).
  - `ws.ts`: handlers map one-to-one onto `dispatchTimers`/`createTimer`. `subscribeTimers` → `stageFeedHub.invalidateAll()` + `broadcast(timersStateMessage())`. Connect sends `timersStateMessage()` after `stage_state`.

- [ ] **Step 1: Write failing tests**
  - `schema.test.ts`: `timer_adjust` with a non-number `deltaMs` is rejected; `timer_create` without `overtime` decodes with `overtime: true`.
  - `timers.test.ts`: `createTimer` returns an id present in `getTimers()`; a listener fires once per change and not for a no-op (`dispatchTimers({type:"pause", id:"missing"})`); a throwing listener doesn't stop a second listener.
- [ ] **Step 2: Run** `pnpm vitest run packages/ws-protocol server/src/timers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the protocol entries, `timers.ts` and the `ws.ts` wiring.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): stage timer engine and timer_* messages`

### Task 4: Stage timers in the feed

**Files:**
- Modify: `server/src/stageFeed.ts`, `server/src/stageFeed.test.ts`, `server/src/stageFeedHub.ts`

**Interfaces:**
- Consumes: `stageTimerValue`, `CURRENT_ITEM_TIMER_ID` (Task 1); `getTimers` (Task 3).
- Produces: `StageFeedInputs.stageTimers: StageTimerInstance[]`. `buildStageFeed` emits instances first (array order: the reducer already keeps the item timer at index 0), mapped `{ id, label, mode, source, overtime, running: anchor !== null && pausedAt === undefined, value: stageTimerValue(t, now) }`, then the existing graphic timers with `id: \`${channel}:${field.key}\``, `source: "graphic"`, `overtime: false`, `running: decoded.pausedAt === undefined`. The hub passes `timers.getTimers()`.

- [ ] **Step 1: Write failing tests** in `server/src/stageFeed.test.ts`:
  - "item timer, then manual, then graphic": the input has a graphic countdown on program, a manual timer and an item timer. Expect `feed.timers.map(t => t.source)` to equal `["item", "manual", "graphic"]`.
  - "graphic timer ids are channel:field": expect `id` `"program:t1"`, with `overtime` false.
  - "not-started manual timer is not running and shows full duration": `running` false, and the decoded value equals `{ anchor: now + 60_000, pausedAt: now }`.
- [ ] **Step 2: Run** `pnpm vitest run server/src/stageFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, updating every existing `buildStageFeed` call in the tests to pass `stageTimers: []`.
- [ ] **Step 4: Run** `pnpm vitest run server/src/stageFeed.test.ts && pnpm typecheck`. Expected: PASS, with no type errors.
- [ ] **Step 5: Commit** `feat(server): standalone and item timers in the stage feed`

### Task 5: Renderer — timer widget sources, warn/overtime colours

**Files:**
- Modify: `apps/renderer/src/stage/stageTime.ts`, `apps/renderer/src/stage/stageTime.test.ts`, `apps/renderer/src/stage/widgets.tsx`

**Interfaces:**
- Consumes: `timerMs`, `timerPhase`, `formatSignedTime`, `decodeTimerValue` (core).
- Produces:
  - `stageTimerView(t: StageTimer, serverNowMs: number, warnBelowSec: number): { text: string; phase: "normal" | "warn" | "over" }`. Format is `t.format ?? "MM:SS"`. A countdown with `overtime` uses `formatSignedTime`. Everything else keeps the existing clamped `timerDisplay` text.
  - `pickStageTimer(timers: StageTimer[], source: StageTimerSource): StageTimer | undefined`. `"firstActive"` → `timers[0]`; `"currentItem"` → id `current-item`; `{ channel }` → first match on channel; `{ timerId }` → id match.

- [ ] **Step 1: Write failing tests** in `stageTime.test.ts`:
  - `stageTimerView` for a countdown with overtime, 83 s past its anchor → `{ text: "+01:23", phase: "over" }`.
  - The same timer without overtime → `{ text: "00:00", phase: "warn" }`.
  - 30 s remaining with `warnBelowSec` 60 → phase `"warn"`.
  - Paused 10 s before its anchor, evaluated long after → text `"00:10"`.
  - `pickStageTimer` covers each of the four sources, including the `currentItem` miss → `undefined`.
- [ ] **Step 2: Run** `pnpm vitest run apps/renderer/src/stage/stageTime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers. In `widgets.tsx` the `timer` case uses `pickStageTimer` and `stageTimerView`. It overrides `style.color` with `warnColor`/`overColor` by phase, the same way `videoRemaining` does. When `showLabel` is set it renders `t.label` in a small caption above the time (24 px, `#888`, the widget's font).
- [ ] **Step 4: Run** the same test command, then `pnpm --filter @overlaysys/renderer typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): stage timer sources and overtime display`

### Task 6: Operator — Stage timers section; Companion timer controls

**Files:**
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`, `apps/operator/src/app/components/TimersRail.tsx`
- Create: `apps/operator/src/app/components/StageTimersSection.tsx`
- Modify: `packages/companion-module/src/{types,state,actions,variables,feedbacks,index}.ts`, `packages/companion-module/src/__tests__/stage.test.ts`

**Interfaces:**
- Consumes: `timers_state` and `timer_*` messages (Task 3); `timerMs`, `timerPhase`, `formatSignedTime` (Task 1).
- Produces:
  - Operator store `stageTimers: StageTimerInstance[]` + `setStageTimers`. `useWs` handles `timers_state`.
  - `StageTimersSection` sits above `<ActiveTimersPanel />` in `TimersRail`, under a "Stage timers" heading. Each timer row shows the label, a live display (500 ms interval, signed when `overtime`, warn/over colour at a 60 s threshold), and buttons Start/Pause/Resume (whichever applies), Reset, −1 min, +1 min, and Delete. The current item timer is pinned first with a "Current item" badge. Its Delete button is labelled "Clear". The "New stage timer" form has label, countdown/count-up, duration (`parseDuration`; invalid → disabled button), and overtime (default on). It sends `timer_create`.
  - Companion state `timers: StageTimerInstance[]` from `timers_state`. Actions `stage_timer_start | stage_timer_pause | stage_timer_resume | stage_timer_reset | stage_timer_adjust` take the option `timer` (dropdown: `current-item` "Current item" first, then manual timers by label; default `current-item`). `stage_timer_adjust` also takes `amount` (seconds, default 60, negative allowed) and sends `deltaMs = amount * 1000`. Variables `item_timer` (`formatSignedTime(timerMs(t, now), "M:SS")` when the item timer exists and is a countdown with overtime; otherwise `formatTime` clamped; `""` when there's no item timer), `item_timer_label`, `item_overtime` (`"true"`/`"false"`). Feedbacks `item_timer_warning` (phase `warn`, 60 s) and `item_timer_overtime` (phase `over`).
  - Companion `index.ts`: while any timer has `anchor !== null && pausedAt === undefined`, re-project variables and check the two feedbacks every 1000 ms. Clear the interval when none is running and on `destroy()`.

- [ ] **Step 1: Write failing tests** in `packages/companion-module/src/__tests__/stage.test.ts`:
  - `dispatchAction("stage_timer_adjust", { timer: "current-item", amount: -30 })` → `[{ type: "timer_adjust", id: "current-item", deltaMs: -30000 }]`.
  - `stage_timer_start` with no option → id `current-item`.
  - `projectVariables` with an item countdown 83 s over, overtime on → `item_timer` `"+1:23"`, `item_overtime` `"true"`. With no timers → `item_timer` `""`.
  - `feedbackPredicate("item_timer_overtime", …)` is true at 83 s over and false at 10 s remaining.
- [ ] **Step 2: Run** `pnpm vitest run packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement** the Companion parts, then the operator store/useWs/section.
- [ ] **Step 4: Run** `pnpm vitest run packages/companion-module && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: stage timers in the operator Timers rail and Companion`

# Phase 7 — Item length and countdown

### Task 7: Row length, PCO length import, auto item countdown

**Files:**
- Modify: `packages/core/src/show.ts`, `packages/core/src/pco/pcoTypes.ts`, `packages/core/src/stageSettings.ts` (+ `stageSettings.test.ts`)
- Modify: `server/src/pco/pcoClient.ts`, `server/src/pco/pcoClient.test.ts`, `server/src/pco/importPlan.ts`, `server/src/pco/importPlan.test.ts`
- Modify: `server/src/timers.ts`, `server/src/timers.test.ts`, `server/src/ws.ts`

**Interfaces:**
- Consumes: `reduceTimers` `setItem`/`clearItem` (Task 1); `rowTitle(row, songs, templates)` from `server/src/stageFeed.ts`; `loadStageSettings` from `server/src/stageSettings.ts`.
- Produces:
  - Every row schema in `show.ts` gains `lengthSec: z.number().int().nonnegative().optional()` and `lengthSecManual: z.boolean().optional()`.
  - `PcoPlanItemSchema.lengthSec` (optional, same type). `getPlanItems` maps attribute `length`: a positive finite number → `Math.round(length)`, otherwise absent.
  - `importPlan`: new rows get `lengthSec` from the item. When replacing an existing row: if the old row has `lengthSecManual`, keep its `lengthSec` and `lengthSecManual`; otherwise take PCO's value, dropping `lengthSec` when PCO has none. Fold this into the existing `sermonNotesId` carry-over at the `existingIdx >= 0` branch with one helper `carryOver(old: RundownRow, row: RundownRow): RundownRow`.
  - `StageSettingsSchema` gains `autoItemTimer: z.boolean().default(true)` and `itemTimerOvertime: z.boolean().default(true)`.
  - `timers.onRowTaken(source: RowSource, now?: number): Promise<void>`. When `autoItemTimer` is false, or `isItemTimerDriverExternal()` returns true, it does nothing. Otherwise it loads the show and row. If the row has `lengthSec > 0` and the current item timer is missing, has a different `rowId`, or has `source !== "item"`, it dispatches `setItem { label: rowTitle(...), anchor: now + lengthSec*1000, durationMs: lengthSec*1000, overtime: itemTimerOvertime, source: "item", rowId: row.id }`. If the row has the same `rowId`, it does nothing. If the row has no length, it dispatches `clearItem { source: "item" }`. After the await it re-reads the live state, as `stageState.onRowTaken` does.
  - `timers.setItemTimerDriver(fn: () => boolean): void` and `isItemTimerDriverExternal(): boolean`. The default is `() => false`. Task 11 registers PCO Live here, so `timers.ts` doesn't import `pcoLiveSync`.
  - `ws.ts`: the existing `channels.onLiveRow` handler (it already skips `preview`) also calls `timers.onRowTaken(source)` with `.catch(warn)`.

- [ ] **Step 1: Fix the stale test first.** `server/src/pco/importPlan.test.ts` ("persists a client-configured song draft instead of rebuilding it") asserts `saved?.updatedAt` equals `NOW`. But `songs.saveSong` stamps the write time (`stampWrite`, `server/src/songs.ts:44`). Change the assertion to `expect(saved?.updatedAt).toEqual(expect.any(String))`. Run `pnpm vitest run server/src/pco/importPlan.test.ts`. Expected: PASS. Commit `test(pco): song draft import no longer pins updatedAt`.
- [ ] **Step 2: Write failing tests**
  - `pcoClient.test.ts`: an item with `length: 300` → `lengthSec: 300`; `length: 0` and `length: null` → `lengthSec` undefined.
  - `importPlan.test.ts`: a new graphic row from an item with length 300 has `lengthSec: 300`. Re-import with length 420 → 420. Re-import of a row with `lengthSecManual: true, lengthSec: 600` keeps 600. Re-import where PCO has no length drops `lengthSec`. The existing `sermonNotesId` carry-over test still passes.
  - `stageSettings.test.ts`: `{ messagePresets: ["a"] }` parses with `autoItemTimer: true, itemTimerOvertime: true`.
  - `timers.test.ts` (mock `./shows`, `./songs`, `./templates`, `./stageSettings` with `vi.mock`, as `stageState.test.ts` does):
    - `starts an item countdown for a row with a length`: anchor `now + 300_000`, label = the row title, `overtime` true.
    - `same row does not restart`: second call at `now + 5_000` → anchor unchanged.
    - `second channel take of same row is a no-op`: two concurrent `onRowTaken` calls for the same source → one item timer, anchor from the first.
    - `a row without a length clears the item timer`, but leaves a manual timer alone.
    - `setting off does nothing`.
    - `external driver suppresses`: `setItemTimerDriver(() => true)` → no item timer.
- [ ] **Step 3: Run** `pnpm vitest run server/src/pco server/src/timers.test.ts packages/core/src/stageSettings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the Produces list.
- [ ] **Step 5: Run** the same command plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: row length from PCO and automatic item countdown on take`

### Task 8: Operator — row Length input, stage settings toggles

**Files:**
- Create: `apps/operator/src/lib/rowLength.ts`, `apps/operator/src/lib/rowLength.test.ts`
- Modify: `apps/operator/src/app/shows/edit/page.tsx`, `apps/operator/src/app/settings/stage/page.tsx`, `apps/operator/src/lib/stageSettingsClient.ts`

**Interfaces:**
- Produces:
  - `formatRowLength(sec: number | undefined): string`. `undefined` → `""`; otherwise `formatTime(sec*1000, "M:SS")`, or `"H:MM:SS"` when it's an hour or longer.
  - `parseRowLength(text: string): { ok: true; sec: number | undefined } | { ok: false }`. Empty → `{ ok: true, sec: undefined }`. Otherwise `parseDuration`, rounded to whole seconds. Null → `{ ok: false }`.
  - Show editor: a "Length" text input next to each of the four "Notes set" pickers (`page.tsx` around lines 724, 786, 993, 1249). On blur with a valid value it patches `{ lengthSec, lengthSecManual: true }`. On an invalid value it reverts to the last good text. Clearing it sets `lengthSec: undefined, lengthSecManual: true`, so a re-import won't refill it.
  - Settings → Stage monitor: two checkboxes, "Start item countdown when a row with a length is taken" (`autoItemTimer`) and "Item countdown runs into overtime" (`itemTimerOvertime`), saved through the existing PUT.

- [ ] **Step 1: Write failing tests** in `rowLength.test.ts`: `formatRowLength(300)` → `"5:00"`, `formatRowLength(3725)` → `"1:02:05"`, `parseRowLength("")` → `{ ok: true, sec: undefined }`, `parseRowLength("4:30")` → `{ ok: true, sec: 270 }`, `parseRowLength("abc")` → `{ ok: false }`.
- [ ] **Step 2: Run** `pnpm vitest run apps/operator/src/lib/rowLength.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the UI.
- [ ] **Step 4: Run** the test, then `pnpm --filter @overlaysys/operator typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(operator): row length input and item countdown settings`

# Phase 8 — PCO Live

### Task 9: PCO Live fixture + `getLive`

**Files:**
- Create: `server/src/pco/__fixtures__/live.json`, `server/src/pco/__fixtures__/README.md`
- Modify: `packages/core/src/pco/pcoTypes.ts`, `server/src/pco/pcoClient.ts`, `server/src/pco/pcoClient.test.ts`

**Interfaces:**
- Produces:
  - `PcoLiveRawSchema` / `PcoLiveRaw` (core, `pcoTypes.ts`), already normalized out of JSON:API: `{ planTitle: string; items: { id: string; title: string; sequence: number; itemType: PcoItemType; lengthSec?: number }[]; currentItemId: string | null; currentStartedAt: string | null /* ISO */; nextItemId: string | null; serviceEndsAt: string | null /* ISO */ }`.
  - `PcoClient.getLive(serviceTypeId: string, planId: string): Promise<PcoLiveRaw>`. It reuses `getAll`, with at most three requests: the Live resource including current/next item times; the plan's items (`per_page=100`, as `getPlanItems` does, without song/arrangement includes); and the plan times. `serviceEndsAt` is the latest `ends_at` among plan times with `time_type === "service"`.

- [ ] **Step 1: Capture the real response.** You need a PAT (`PCO_APP_ID`/`PCO_SECRET`) and a plan that someone is running in Services Live. Run:
  `curl -s -u "$PCO_APP_ID:$PCO_SECRET" "https://api.planningcenteronline.com/services/v2/service_types/<st>/plans/<plan>/live?include=current_item_time,next_item_time,items"`
  Also capture `/plans/<plan>/plan_times`. Save both into `live.json` as `{ "live": …, "planTimes": … }` with personal names scrubbed. Write down the exact attribute and relationship names you found in `__fixtures__/README.md`.
  **If no live plan is available**, build the fixture from the documented shape. That shape is: Live relationships `current_item_time`/`next_item_time` → `ItemTime { live_start_at, live_end_at }` with relationship `item`, plus `Item { title, sequence, item_type, length }` and `PlanTime { time_type, starts_at, ends_at }`. Mark the README "UNVERIFIED — reconcile against a real capture before release" and tell your reviewer.
- [ ] **Step 2: Write failing tests** in `pcoClient.test.ts`, stubbing routes from the fixture with the existing `stubFetch`:
  - `getLive` maps current/next item ids and `currentStartedAt`, takes `lengthSec` from `length`, and takes `serviceEndsAt` from the service plan time.
  - No `current_item_time` → `currentItemId: null`, `currentStartedAt: null`.
  - 401 → `PcoAuthError`.
- [ ] **Step 3: Run** `pnpm vitest run server/src/pco/pcoClient.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `PcoLiveRawSchema` and `getLive`.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Commit** `feat(pco): read Services Live state`

### Task 10: Core — `StageServiceView`, `mapPcoLive`, layout widgets

**Files:**
- Create: `packages/core/src/pco/pcoLive.ts`, `packages/core/src/pco/pcoLive.test.ts`
- Modify: `packages/core/src/stageFeed.ts`, `packages/core/src/stageLayout.ts`, `packages/core/src/stageLayout.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `PcoLiveRaw` (Task 9).
- Produces:
  - `StageServiceViewSchema` / `StageServiceView`: `{ source: "pco"; planTitle; itemIndex: int ≥ 0; itemCount: int ≥ 0; current: { id: string; title: string; startedAt: number; lengthSec?: number } | null; next: { title: string } | null; laterLengthSec: number; plannedEndAt?: number; status: "live" | "notStarted" | "ended" | "error"; error?: string }`. `StageFeed.service: StageServiceViewSchema.nullable()`. Note `current.id`, which Task 11 uses as the item timer's `rowId`.
  - `mapPcoLive(raw: PcoLiveRaw): StageServiceView`. Header items (`itemType === "header"`) are excluded from `itemCount`, from `itemIndex` and from `laterLengthSec`. With a current item → `status: "live"`, `itemIndex` 1-based among non-header items. With no current item → `"notStarted"`, unless Task 9's README documents a field that marks a finished Live session (e.g. the last item time's `live_end_at` set), in which case that gives `"ended"`. Put the rule in a comment citing the README.
  - `serviceDeltaSec(view: StageServiceView, now: number): number | null`. If `plannedEndAt` is absent or `current` is null → null. Otherwise `currentRemainingSec = current.lengthSec !== undefined ? max(0, (startedAt + lengthSec*1000 - now)/1000) : 0`, projected end = `now + currentRemainingSec*1000 + laterLengthSec*1000`, and the result is `Math.round((projectedEnd - plannedEndAt) / 1000)`. Positive means over.
  - `rowTitle` widget props gain `prefer: z.enum(["rundown", "pco"]).default("rundown")`.
  - New widget kind `serviceProgress`, props `{ showPosition: boolean (true), showEnd: boolean (true), showDelta: boolean (true) }`.

- [ ] **Step 1: Write failing tests** in `pcoLive.test.ts`:
  - live: items `[header, A(300), B(600), C(900)]` with current B → `itemIndex 2`, `itemCount 3`, `laterLengthSec 900`, `current.title "B"`, `next.title "C"`.
  - no current item → `status: "notStarted"` (plus an `"ended"` case if Task 9 found a distinguishing field); `current: null`.
  - missing service plan time → `plannedEndAt` undefined, so `serviceDeltaSec` returns null.
  - current item with no length → `current.lengthSec` undefined; `serviceDeltaSec` counts its remaining time as 0.
  - delta: B started at `now − 100 s` with length 600, later lengths 900, `plannedEndAt = now + 1_200_000` → `serviceDeltaSec` = `500 + 900 − 1200` = `200`.
  - `stageLayout.test.ts`: `serviceProgress` defaults; `rowTitle.prefer` defaults to `"rundown"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/pco/pcoLive.test.ts packages/core/src/stageLayout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, setting `service: null` in `buildStageFeed` for now so typecheck passes.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): PCO Live service view and serviceProgress widget`

### Task 11: Server — PCO Live sync loop, protocol, feed, item timer driving

**Files:**
- Create: `server/src/pco/pcoLiveSync.ts`, `server/src/pco/pcoLiveSync.test.ts`
- Modify: `packages/ws-protocol/src/index.ts`, `server/src/ws.ts`, `server/src/stageFeed.ts`, `server/src/stageFeed.test.ts`, `server/src/stageFeedHub.ts`

**Interfaces:**
- Consumes: `PcoClient.getLive` (Task 9); `mapPcoLive` (Task 10); `dispatchTimers`, `getTimers`, `setItemTimerDriver` (Tasks 3, 7); `getPcoAuthorization`, `createPcoClient`.
- Produces:
  - Client `pco_live_start { showId: string }`, `pco_live_stop {}`. Server `pco_live_state { enabled: boolean; showId: string | null; status: "idle" | "live" | "notStarted" | "ended" | "error"; error?: string; lastPolledAt: number | null; service: StageServiceView | null }` (`service` is non-null only while enabled).
  - `pcoLiveSync.ts`:
    - `startLiveSync(showId: string, deps?: { client?: PcoClient; now?: () => number }): Promise<{ ok: true } | { ok: false; error: string }>`. It picks the most common `(serviceTypeId, planId)` among the show's rows' `sourceRef`s (ties → the first row's). It returns an error with no PCO rows (`"This show has no Planning Center items."`) or when not connected. Starting again replaces a running sync.
    - `stopLiveSync(): void`
    - `getServiceView(): StageServiceView | null`
    - `liveSyncStateMessage(): ServerMessage`
    - `subscribeLiveSync(l: () => void): () => void`
    - `_resetForTest(): void`
  - The loop uses `setTimeout`, not `setInterval`, so a slow request never overlaps the next one. Delay is `POLL_MS = 5000`. On a network error, `delay = min(prev*2, 60_000)` starting from 5000, and the last view is kept with `status` unchanged. After success the delay resets. On `PcoAuthError` → `status: "error"`, `error: err.message`, the loop stops, and `enabled` stays true so the operator sees it. 429 is already retried inside `getAll`.
  - Item timer driving, after each successful poll:
    - `status === "live"` and `current.lengthSec` set → if the item timer is missing, or has `source !== "pco"`, a different `rowId`, or a different anchor, dispatch `setItem { source: "pco", rowId: current.id, label: current.title, anchor: startedAt + lengthSec*1000, durationMs: lengthSec*1000, overtime: true }`.
    - Otherwise → `clearItem { source: "pco" }`.
    - `setItemTimerDriver(() => enabled && view?.status === "live")` is registered once at module load.
    - `stopLiveSync` and a `startLiveSync` for a different show both dispatch `clearItem { source: "pco" }`.
  - Wiring: `subscribeLiveSync` → `stageFeedHub.invalidateAll()` + broadcast `liveSyncStateMessage()`. Connect sends it. `StageFeedInputs.service` → passed straight through to `feed.service`. The hub supplies `getServiceView()` only while `enabled`.
  - When the operator loads a different show (the existing `stageState` "different show" path doesn't apply here): `ws.ts` calls `stopLiveSync()` when a sourced take arrives (`onLiveRow`) whose `showId` differs from the sync's `showId`.

- [ ] **Step 1: Write failing tests** in `pcoLiveSync.test.ts`, using `vi.useFakeTimers()`, a fake client and mocked `../shows`:
  - `start picks the most common plan`: rows with sourceRefs `[p1, p2, p2]` → the fake client is called with `p2`.
  - `no PCO rows → error, not enabled`.
  - `poll every 5 s without overlap`: `getLive` resolves after 7 s → the second call starts 5 s after the first resolves.
  - `network errors back off to 60 s and reset on success`: delays 10, 20, 40, 60, 60 s, then 5 s after a success.
  - `auth error stops with status error`.
  - `drives the item timer while live`: after a poll with current B (600 s, started `t0`) → `getTimers()[0]` is `{ id: "current-item", source: "pco", rowId: "B", anchor: t0 + 600_000 }`. Then a poll with no current item → item timer cleared.
  - `stop clears a pco item timer but not a manual timer`.
  - `does not suppress take-based timers when not live`: status `notStarted` → `isItemTimerDriverExternal()` false.
  - `stageFeed.test.ts`: `service` passes through unchanged.
- [ ] **Step 2: Run** `pnpm vitest run server/src/pco/pcoLiveSync.test.ts server/src/stageFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces list.
- [ ] **Step 4: Run** the same command plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): PCO Live sync drives the stage service view and item timer`

### Task 12: Renderer + operator + Companion for PCO Live

**Files:**
- Modify: `apps/renderer/src/stage/widgets.tsx`, `apps/renderer/src/stage/stageTime.ts`, `apps/renderer/src/stage/stageTime.test.ts`
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`, `apps/operator/src/app/components/StagePanel.tsx`
- Modify: `packages/companion-module/src/{types,state,variables,feedbacks}.ts`, `packages/companion-module/src/__tests__/stage.test.ts`

**Interfaces:**
- Consumes: `StageServiceView`, `serviceDeltaSec` (Task 10); `pco_live_*` (Task 11).
- Produces:
  - `serviceProgressText(view: StageServiceView, nowMs: number, props: { showPosition: boolean; showEnd: boolean; showDelta: boolean }, clock: "12h" | "24h" = "12h"): string`. It joins with `" · "`: `"Item 4 of 12"`; `"Ends 11:15"` (from `plannedEndAt`, using `formatClockDisplay` without seconds); and `"3 min over"`, `"2 min under"` or `"On time"`, using `Math.round(delta/60)`, with 0 → `"On time"`. Parts with no data are dropped. Status `notStarted` → `"Service not started"`; `ended` → `"Service ended"`; `error` → `""`.
  - Widgets: `serviceProgress` renders `serviceProgressText` (empty when `feed.service` is null). With `prefer === "pco"` and `feed.service?.current`, `rowTitle` renders `current.title` (+ `  →  next.title` when `showNext`); otherwise it renders as it does today.
  - Operator: store `pcoLive: PcoLiveStateMessage | null`. In `StagePanel`, a "Follow PCO Live" switch for the loaded show sends `pco_live_start { showId }` / `pco_live_stop`. The switch is disabled when no show is loaded. A status line shows `Live · item 4 of 12`, `Not started`, `Ended`, or the error text in red.
  - Companion: state `pcoLive` (the latest `pco_live_state`, including its `service`). Variables `service_item` (current title or `""`), `service_next_item`, `service_delta` (`"+3"`, `"-2"`, `"0"` minutes, or `""`). Feedback `pco_live_active` (enabled and status `live`). `service_delta` is re-projected by Task 6's 1 s interval, extended to run while `service?.status === "live"`.

- [ ] **Step 1: Write failing tests**
  - `stageTime.test.ts` `serviceProgressText`: the Task 10 delta example gives `"Item 2 of 3 · Ends <h:mm AM/PM> · 3 min over"` (build `plannedEndAt` from a fixed local `Date` so the clock text is deterministic). `showDelta: false` drops the last part. `notStarted` → `"Service not started"`.
  - Companion: `projectVariables` with that service → `service_item "B"`, `service_next_item "C"`, `service_delta "+3"`. `feedbackPredicate("pco_live_active")` is true only for status `live`.
- [ ] **Step 2: Run** `pnpm vitest run apps/renderer/src/stage packages/companion-module`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: PCO Live on stage monitors, operator toggle and Companion variables`

### Task 13: Full verification

- [ ] **Step 1:** `pnpm test`. Expected: every file passes, including the importPlan test fixed in Task 7.
- [ ] **Step 2:** `pnpm typecheck && pnpm build`. Expected: success.
- [ ] **Step 3: Manual checklist** (`pnpm desktop`, one stage channel on the Speaker layout):
  1. Create a 0:20 stage countdown with overtime and Start it. The monitor's TIMER shows it with no graphic on program, in amber from the start (under the 60 s threshold). After 25 s it reads `+00:05` in red.
  2. Pause, ±1 min, Reset and Delete each behave as described in Task 1.
  3. Give a graphic row a Length of 0:30 and take it. The item countdown starts and the timer is pinned as "Current item". Retake the same row: no restart. Take a row with no length: the item timer clears.
  4. Turn off "Start item countdown" in Settings → Stage monitor and take a row with a length: no timer.
  5. Re-import a PCO plan. Lengths fill in. A row you edited by hand keeps its value.
  6. With a PCO plan running in Services Live, turn on Follow PCO Live. A layout with a `serviceProgress` widget (edit a copy via the phase 5 designer if present, otherwise temporarily in code) shows position, end and delta. The item timer follows PCO's current item. Taking a row doesn't override it. Stopping the sync clears the PCO timer.
  7. In Companion, `$(overlaysys:item_timer)` ticks every second and the overtime feedback lights up.
- [ ] **Step 4:** If any check fails, fix it and commit `fix(stage): phase 6-8 verification fixes`.
