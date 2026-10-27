# Confidence monitor — standalone timers, item countdown, PCO Live

Status: draft — the user skipped questions; every decision below marked
*(call)* is the author's default and open to correction
Date: 2026-10-27
Extends: `2026-10-22-confidence-monitor-design.md` (phases 1–4 shipped,
phase 5 layout designer pending). This adds phases 6–8.

## Problem

Stage monitors only see timers that live inside an on-air graphic
template (`timersOf` in `server/src/stageFeed.ts` reads time fields on
`ChannelState.active`). To put a countdown on the pastor's monitor the
operator must take a graphic, which also puts it on program. Nothing
knows how long a service item is supposed to run, so there is no "time
left on this item" and no signal that a speaker is over. Planning
Center Services Live, where many churches run service timing, is not
read at all.

## Goals

1. **Standalone timers** — the operator creates, runs, pauses, resets
   and deletes timers that exist only for confidence monitors. They
   don't need a template or channel.
2. **Item length** — rundown rows carry a planned length, imported from
   the PCO item's `length` and editable by hand.
3. **Item countdown** — taking a row that has a length starts a
   "current item" countdown on the stage monitors automatically.
4. **Overtime** — countdowns that allow it keep running past zero and
   show the overrun in red (`+1:23`), so the speaker sees how far over
   they are.
5. **PCO Live** — when turned on for the loaded show, the server polls
   PCO Services Live and shows its current/next item, item time
   remaining, service progress and planned end on stage monitors.

## Non-goals

- Writing to PCO Live (advancing PCO from OverlaySys). That needs
  write scopes and creates two sources of truth. *(call)*
- Auto-taking graphics when PCO Live advances. The server can't build
  graphic takes for arbitrary rows on its own, and silently putting
  things on program is risky. PCO Live drives the stage monitors'
  item/timer view only. *(call)*
- PCO webhooks. The server runs on a church LAN with no public URL, so
  we poll instead. *(call)*
- Persisting standalone timers across a server restart. They live in
  memory like `StageState`. *(call)*
- Changing how graphic-template timers behave on program output (they
  still clamp at zero).

## Data model

### Timer instance (`packages/core/src/stageTimers.ts`, new)

```ts
StageTimerInstance {
  id: string;
  label: string;
  mode: "countdown" | "countup";
  durationMs?: number;          // countdown length; also used by reset
  anchor: number | null;        // epoch ms: countdown end / countup start; null = not started
  pausedAt?: number;            // epoch ms; display frozen while set
  overtime: boolean;            // countdown keeps counting past zero
  source: "manual" | "item" | "pco";
  rowId?: string;               // item/pco: the row (or PCO item id) it belongs to
}
```

A pure reducer `reduceTimers(timers, action, now)` handles
`create | start | pause | resume | reset | adjust { deltaMs } | delete |
setItem | clearItem`. There is at most one timer with `source` of `item`
or `pco`. That is the **current item timer**, with fixed id
`"current-item"`. `adjust` moves the anchor; it adds or removes time on
a countdown, and for a paused timer it moves `pausedAt` too.

### Server engine (`server/src/timers.ts`, new)

This module holds the timer list in memory, following the
`stageState.ts` pattern: `getTimers`, `dispatchTimers`,
`subscribeTimers`, `_resetForTest`. Every change invalidates every
stage feed and broadcasts `timers_state { timers }` to non-stage
clients. The server doesn't tick. The renderer, operator and Companion
compute displays from `anchor`/`pausedAt` plus the server-time offset,
the same way stage timers work today.

### Row length

Every row kind in `packages/core/src/show.ts` gains
`lengthSec?: number` (non-negative integer). I chose to put it on the
row, not on `RowSourceRef`, so hand-built rows can have a length too.
*(call)*

- `PcoPlanItemSchema` gains `lengthSec?: number`. `pcoClient.getPlanItems`
  maps it from the item's `length` attribute (seconds; 0 or missing →
  undefined).
- `importPlan` writes `lengthSec` on new rows. On re-import it updates
  `lengthSec` from PCO, except on a row where the operator has set it
  by hand. That row also gets `lengthSecManual: true` and keeps its
  value, the same way `sermonNotesId` is kept today. *(call)*
- The row editor gets a "Length" input (`M:SS`, using `parseDuration` /
  `formatTime`). Editing it sets `lengthSecManual`.

### Stage settings

`StageSettingsSchema` (`packages/core/src/stageSettings.ts`) gains:

| field | default | meaning |
|---|---|---|
| `autoItemTimer` | `true` | taking a row with a length starts the item countdown |
| `itemTimerOvertime` | `true` | the item countdown runs into overtime |

The amber threshold is a per-widget prop (`timer.warnBelowSec`,
default 60), not a global setting, so the designer can tune it per
layout. *(call)*

### Feed

`StageTimerSchema` (`packages/core/src/stageFeed.ts`) gains:

```ts
id: string;                    // graphic timers: `${channel}:${fieldKey}`
source: "graphic" | "manual" | "item" | "pco";
overtime: boolean;             // graphic timers: false
running: boolean;              // false when paused or not started
```

`channel` becomes optional (standalone timers have none). The existing
`value` encoding (`encodeTimerValue`) stays, so `decodeTimerValue` and
`computeTimeDisplay` keep working. A standalone timer that hasn't
started is encoded as a paused timer at its full duration.

Feed order: the current item timer, then manual timers in creation
order, then graphic timers (followed channel first, as today). The
existing `firstActive` widget source picks the item timer when one
exists. That gives the Speaker layout the item countdown with no layout
change.

`StageFeed` gains `service: StageServiceView | null` (phase 8):

```ts
StageServiceView {
  source: "pco";
  planTitle: string;
  itemIndex: number; itemCount: number;    // 1-based position of the current item
  current: { title: string; startedAt: number; lengthSec?: number } | null;
  next: { title: string } | null;
  laterLengthSec: number;                  // sum of lengths of items after the current one
  plannedEndAt?: number;                   // epoch ms, from PCO plan times
  status: "live" | "notStarted" | "ended" | "error";
  error?: string;
}
```

## Behavior

### Standalone timers (phase 6)

- WS client messages: `timer_create { label, mode, durationMs?,
  overtime? }`, `timer_start | timer_pause | timer_resume | timer_reset
  | timer_delete { id }`, `timer_adjust { id, deltaMs }`. Server
  broadcast: `timers_state { timers }`, also sent on connect.
- The `timer` widget's `source` gains `{ timerId }` and
  `"currentItem"`. `"firstActive"` and `{ channel }` keep working.
- Display: a new `formatSignedTime(ms, format)` in `timeField.ts`
  returns `+M:SS` for negative remaining time on countdowns that have
  `overtime`. The widget colours text by state: normal; amber below the
  widget's `warnBelowSec` (default 60); red with a `+` in overtime. It gains props
  `warnColor` (default `#ffb703`), `overColor` (default `#ef233c`) and
  `showLabel` (shows the timer's label above the time).
- Operator: the Timers rail gets a "Stage timers" section above the
  graphic timers. It has a list with start/pause/reset/±1 min/delete
  per timer, a "New stage timer" form (label, countdown/count-up,
  duration, overtime toggle), and a pinned "Current item" row when an
  item timer exists.
- Companion: actions `stage_timer_start | pause | resume | reset |
  adjust { amount }`. Each takes a timer dropdown, and "Current item"
  is the default. Variables: `item_timer` (formatted, signed),
  `item_timer_label`, `item_overtime` (`true`/`false`). Feedback:
  `item_timer_warning`, `item_timer_overtime`.

### Item countdown (phase 7)

- In `ws.ts`, the existing `channels.onLiveRow` hook (it already skips
  `preview`) calls a new `timers.onRowTaken(source)`. When
  `autoItemTimer` is on and PCO Live isn't driving the item timer:
  - row has `lengthSec` and its `rowId` differs from the current item
    timer's → `setItem` starts a fresh countdown with label = row title
    and `overtime` = `itemTimerOvertime`;
  - same row as the current item timer → nothing. Lyric advances,
    scripture slides and sub-takes all retake the same row and must
    not restart it;
  - row has no length → `clearItem`. A stale countdown for a previous
    item is worse than none. *(call)*
- The operator can still pause, adjust and reset the item timer, and
  can clear it from the Timers rail.

### PCO Live sync (phase 8)

- `server/src/pco/pcoLiveSync.ts` (new) is started by `pco_live_start
  { showId }`. The plan comes from the show's rows' `sourceRef`, the
  most common `(serviceTypeId, planId)`. A show with no PCO rows
  returns an error and doesn't start. `pco_live_stop` stops it.
  Broadcasts `pco_live_state { enabled, showId, status, error?,
  lastPolledAt }`. It's off by default, runtime only, and not
  persisted. *(call)*
- Poll interval is 5 s while enabled. `PcoClient.getLive(st, plan)`
  reads `GET /service_types/{st}/plans/{plan}/live` with the current and
  next item times included, plus the plan's items (titles, lengths,
  sequence) and plan times (service start/end). On 429 it backs off
  using `Retry-After`. On `PcoAuthError` it stops, with
  `status: "error"`. A network error keeps the last view and retries
  with exponential backoff up to 60 s.
- **The JSON:API shape of Services Live is unverified.** The first
  phase-8 task captures a real response, using the user's PAT against a
  live plan, as a test fixture. The mapping is written against that
  fixture. Expected fields: Live relationships `current_item_time` and
  `next_item_time` (`ItemTime` with `live_start_at`, `live_end_at` and
  an `item` relationship), and a plan time of `time_type: "service"`
  whose `ends_at` gives `plannedEndAt`.
- Mapping is a pure `mapPcoLive(raw, now) → StageServiceView`, with
  fixture tests.
- While sync is enabled and `status === "live"`:
  - `StageFeed.service` is set;
  - the current item timer is driven by PCO: `source: "pco"`, anchor =
    `current.startedAt + lengthSec*1000`, overtime on. Take-based
    auto-start is suppressed. Items with no length clear it;
  - `rowTitle` widgets get a `prefer: "rundown" | "pco"` prop (default
    `"rundown"`). With `"pco"` they show PCO's current/next titles when
    `service` is set.
- New widget `serviceProgress`: "Item 4 of 12 · Ends 11:15 · 3 min
  over". Props: `showPosition`, `showEnd`, `showDelta`. The delta is
  the projected end (now + the current item's remaining time +
  `laterLengthSec`) minus `plannedEndAt`, shown as `N min over/under`. If PCO
  doesn't give a planned end, the delta is hidden.
- Operator: the Stage panel gets a "Follow PCO Live" toggle for the
  loaded show, with a status line (live / not started / error +
  message). Companion: a feedback `pco_live_active` and variables
  `service_item`, `service_next_item`, `service_delta`.

## Testing

Vitest, logic only, as before.

- `reduceTimers`: every action; adjust while paused; single item timer;
  reset re-derives from `durationMs`; reset of a count-up.
- `formatSignedTime`, and overtime vs clamp in the stage timer display
  helper.
- `buildStageFeed`: timer ordering; `firstActive` picks the item timer;
  standalone encoding; `service` passthrough.
- `timers.onRowTaken`: start, same-row no-op, no-length clear, setting
  off, suppressed while PCO drives.
- `pcoClient`: `length` → `lengthSec`; `getLive` against the fixture.
- `importPlan`: `lengthSec` on new rows, refreshed on re-import, kept
  when `lengthSecManual`.
- `mapPcoLive`: live, not started, ended, missing plan time, item with
  no length, delta.
- `pcoLiveSync`: polling loop with fake timers and a fake client:
  backoff, auth stop, stop on `pco_live_stop`.
- WS handlers for `timer_*`, `pco_live_*`; Companion `dispatchAction`
  and variable derivation.

## Phases

Recommended order: 6 → 7 → 8 → 5, so the designer (phase 5) ships
with every widget kind and prop already in place. *(call)*

6. **Standalone timers** — core instance + reducer, server engine, WS
   messages, feed fields + ordering, signed overtime display, widget
   sources and colours, operator Stage timers section, Companion
   actions/variables/feedbacks.
7. **Item length + countdown** — `lengthSec` on rows and PCO items,
   import/re-import, row editor input, settings, `onRowTaken` auto
   start, Settings → Stage monitor toggles.
8. **PCO Live** — fixture capture, `getLive`, `mapPcoLive`, sync loop,
   `service` in the feed, PCO-driven item timer, `serviceProgress`
   widget, `rowTitle.prefer`, operator toggle, Companion bits.
5. **Layout designer** — unchanged from the base spec. Its inspector
   and sample data cover the phase 6–8 widget props as well
   (`timer.source`/colours, `serviceProgress`, `rowTitle.prefer`), and
   the sample data switcher gains "Item countdown (overtime)" and "PCO
   Live".
