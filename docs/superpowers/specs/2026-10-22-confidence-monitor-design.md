# Confidence monitor (stage display)

Status: design approved — pending implementation plan
Date: 2026-10-22

## Problem

There is no confidence monitor. Today a "stage" screen is just another
graphics channel (e.g. `data/channels/james.json`) showing the same
template graphics as program — no next slide, no clock, no notes. Every
rundown row already carries `notes?: string`, but nothing outside the
show editor displays it.

The primary audience is the **speaker / pastor**: they need sermon
notes they can step through themselves, the live row's cue, scripture
and lyric context, timers, and messages from the booth. A secondary
audience (worship team) needs lyrics-first layouts. Different monitors
need different layouts, so layouts must be designable.

## Goals

1. A channel can be a **stage** channel that renders a stage layout fed
   by live show state instead of template graphics.
2. Stage layouts are freeform documents of configurable widgets, edited
   in a dedicated designer.
3. Shows carry **sermon notes** (long-form Markdown, split into
   points), authored or imported in the operator app.
4. The pastor steps through notes point-by-point (with fine scroll)
   from their phone via **Bitfocus Companion**.
5. The operator can send short messages to stage monitors.
6. Existing graphics channels, templates and the template engine are
   unchanged.

## Non-goals

- A bespoke phone UI — Companion's web buttons / emulator is the phone
  surface.
- Pastor self-service authoring of notes (remote web editor, auth).
- Planning Center import of notes (possible later).
- Chord charts.
- Per-monitor independent notes positions (one shared position).

## Decisions

| Question | Decision |
|---|---|
| Layout model | Separate `StageLayout` document, not template layers |
| Designer | Freeform widget canvas (`StageCanvas`), sibling of `Canvas` in `editor-kit` |
| Channel model | `ChannelConfig.kind: "graphics" \| "stage"` |
| Notes location | On the show (`Show.sermonNotes[]`), optionally linked from rows |
| Notes navigation | Point-by-point primary, free scroll secondary |
| Notes position scope | Shared across all stage channels |
| Notes authoring | Operator types/pastes; import .txt / .md / .docx |
| Derivation | Server computes a `StageFeed`; renderer only renders |

## Data model

### Channel config (`packages/core/src/channelConfig.ts`)

```ts
ChannelConfig {
  ...existing,
  kind: "graphics" | "stage";   // default "graphics"
  follows?: string;             // stage only; default "program"
  layoutId?: string;            // stage only; default built-in "speaker"
}
```

Missing `kind` parses as `"graphics"`, so existing JSON and cloud rows
need no migration (`channel_configs` stores a JSON payload).
`ProjectChannelOverride` is **not** extended: overrides are applied only
in the operator UI today — the server and renderer read base configs —
so a per-project stage override would have no effect on output. Graphics-only fields (`renderMode`, `mirrorOf`) are ignored
for stage channels. Display binding and auto-open keep using the
per-machine `ChannelWindowPrefs`, unchanged.

### `StageLayout` (`packages/core/src/stageLayout.ts`)

```ts
StageLayout {
  id; name;
  size: { w: number; h: number };      // default 1920×1080
  background: string;
  widgets: StageWidget[];              // array order = z-order
  builtIn?: boolean;                   // read-only, duplicate to edit
  updatedAt?; deletedAt?;
}

StageWidgetBase {
  id; kind;
  rect: { x; y; w; h };
  hidden?: boolean; locked?: boolean;
  style: {
    fontFamily; fontSize; fontWeight; color;
    background?; padding; align: "left"|"center"|"right";
    vAlign: "top"|"middle"|"bottom";
    autoFit: boolean;                  // shrink-to-fit from fontSize
    label?: string;                    // small caption, e.g. "NEXT"
    border?: { width; color; radius };
  };
}
```

Widget kinds (discriminated union on `kind`, each with typed `props`):

| kind | shows | props |
|---|---|---|
| `currentSlide` | live lyric / scripture / graphic text on the followed channel | `showReference` |
| `nextSlide` | next slide | `maxLines`, `dimOpacity` |
| `sermonNotes` | active notes set | `highlightColor`, `dimPast`, `showCounter`, `anchor` (fraction from top, default 0.33) |
| `rowCue` | live row's `notes` | `includeNextRow` |
| `rowTitle` | current / next rundown item names | `showNext` |
| `clock` | wall clock | `format: "12h"\|"24h"`, `seconds` |
| `timer` | a live timer | `source: "firstActive" \| { channel: string }` |
| `videoRemaining` | remaining time of video on the followed channel | `warnBelowSec` |
| `message` | operator message | `flash: boolean` |
| `text` | static text | `text` |

Stored in `data/stage-layouts/<id>.json`. Built-in layouts ship in
code (not on disk): **Speaker** (clock, notes main, row title + cue,
message bar), **Lyrics** (big current slide, dim next slide, corner
clock), **Scripture** (reference + text, next verse, notes sidebar).
Phase 1 ships only **Speaker**.

Cloud sync (phase 5): new `stage_layouts` table, last-writer-wins on
`updatedAt` with `deletedAt` soft-deletes, following the existing
`templates` pattern in `syncEngine.ts` / `cloudSync.ts`. The migration
belongs to apps-portal's Supabase project.

### Sermon notes (`packages/core/src/sermonNotes.ts`)

```ts
Show { ...existing, sermonNotes?: SermonNotes[] }
SermonNotes { id; title; body: string /* Markdown */; updatedAt }
RundownRow (all kinds) { ...existing, sermonNotesId?: string }
```

`splitPoints(body): Point[]` — pure. Splits on Markdown headings
(any level); if the body has no headings, splits on blank-line
blocks. Each `Point { heading: string; markdown: string }`, where
`heading` is the heading text or the block's first line (truncated).
Empty/whitespace bodies yield `[]`.

### Live rundown row (`ChannelState.liveRow`)

The server has no notion of a loaded show or rundown cursor — those are
client-local (operator store, Companion state). So each channel records
the last rundown row taken to it:

```ts
RowSource { showId: string; rowId: string }
ChannelState { ...existing, liveRow?: RowSource }
```

- `take` / `cue` messages gain optional `source: RowSource`;
  `media_take` gains optional `showId` (it already has `rowId`).
- Server-originated takes set it: `song_take`, `take_song_sub` (intro,
  outro, lyrics), `song_take_pvw_to_pgm`, scripture intro and slide.
- `liveRow` changes **only** when a take carries a source. Hotcards and
  ad-hoc takes leave it alone, and `clear` does not reset it, so a
  pastor's cue stays up while a lower third flashes by.
- `take_pvw_to_pgm` carries the preview's `liveRow` to the destination.
- Operator (`graphicRowMessage`, `videoRowTakeMessage`, song outro) and
  Companion row takes send the source.

### Runtime `StageState` (server memory only)

```ts
StageState {
  activeNotesId: string | null;
  pointIdx: number;
  scrollOffset: number;          // fraction of viewport, reset on point change
  message: { text; sentAt } | null;
}
```

One per server (shared across stage channels). Taking a row with
`sermonNotesId` selects that set and resets `pointIdx` to 0 unless the
set is already active. Loading a different show clears it.

## Data flow

### `StageFeed` (`server/src/stageFeed.ts`)

`buildStageFeed(inputs): StageFeed` is a pure function. Inputs: the
followed channel's `ChannelState`, the show named by its `liveRow`,
song/scripture sessions and `Song` documents, all live channel states,
and `StageState`.

```ts
StageFeed {
  layout: StageLayout;                       // resolved for this channel
  current: SlideView; next: SlideView;
  row: { title; cue } | null; nextRow: { title; cue } | null;
  notes: { id; title; points: Point[]; pointIdx; scrollOffset } | null;
  timers: { label; mode; value /* encoded timer */ }[];
  video: { status; currentTime; duration; at /* server ms */ } | null;
  message: { text; sentAt } | null;
  serverNow: number;
}
SlideView { kind: "lyric"|"scripture"|"graphic"|"none"; lines: string[]; reference?: string }
```

Next-slide rules: lyrics follow the session's arrangement across
section boundaries (last slide of arrangement → `none`); scripture uses
`slideIdx + 1` (last → `none`); otherwise the next row's first content
(song first slide, scripture first slide, graphic title). Timers are
extracted from time fields on live graphics using `timeField.ts`.

### Transport (`ws-protocol`, `server/src/ws.ts`)

- Stage windows use the existing `subscribe { channel }`. Every
  subscription is also registered with the stage feed hub; while the
  channel's `kind` is `stage` the hub sends `stage_feed { channel, feed }`
  alongside the (empty) `state`. Checking kind at build time means
  switching a channel's kind takes effect without resubscribing.
- A feed is rebuilt and pushed on any input change, debounced to ~50 ms
  per channel, and immediately on subscribe.
- Clock, timers and video remaining are ticked locally by the renderer
  from raw values plus `serverNow` offset — the server does not
  broadcast per second.
- Saving a layout pushes new feeds to channels using it.

New client messages:

| message | effect |
|---|---|
| `notes_select { notesId \| null }` | set active notes, reset position |
| `notes_point { delta } \| { index }` | move point, clamped; reset scroll |
| `notes_scroll { delta }` | adjust `scrollOffset` (viewport fractions) |
| `notes_reset` | point 0, scroll 0 |
| `stage_message { text }` | set message |
| `stage_message_clear` | clear message |
| `list_stage_layouts` / `get_stage_layout` / `save_stage_layout` / `delete_stage_layout` / `duplicate_stage_layout` | CRUD, mirroring templates |

The server also broadcasts `stage_state { activeNotesId, pointIdx,
pointCount, pointHeading, nextHeading, message }` to non-stage
clients (operator, Companion) so they can show position.

### Notes navigation semantics (`packages/core/src/notesNav.ts`)

Pure reducer over `StageState` + point count:

- `point delta` clamps to `[0, count-1]` and sets `scrollOffset = 0`.
- `scroll delta` adds to `scrollOffset`. Overflow into neighbors needs
  rendered heights, which only the renderer knows, so the renderer
  reports `notes_overflow { direction }` when a scroll pushes past the
  active point's bounds; the server then applies `point ±1` with
  `scrollOffset = 0`. Pastors using only scroll buttons still advance.
- Selecting a set that no longer exists sets `activeNotesId = null`.

### Renderer (`apps/renderer`)

`Renderer.tsx` branches on message type: `stage_feed` →
`StageRenderer`. It renders the layout at `layout.size`, scaled to fit
the window like the graphics stage. Each widget kind is a React
component in `apps/renderer/src/stage/widgets/` reading its slice of
the feed. Widgets are exported so the designer can reuse them.

The notes widget renders all points, places the active point's top at
`anchor` of its box, applies `scrollOffset`, dims past points, and
highlights the active point. Point changes animate (short ease scroll).

Auto-fit: `fitFontSize(text, box, maxSize, measure)` — binary search
over font size with an injected `measure` function; shared by renderer
and designer so output matches exactly.

### Failure behavior

- WS drops: widgets keep the last feed; a small "disconnected" corner
  badge shows; clock and timers keep ticking.
- Missing/deleted layout: fall back to built-in Speaker.
- `follows` points at a missing channel: `current`/`next` are `none`.
- Deleted notes set: `notes = null`.

## Companion (`packages/companion-module`)

Actions: `notes_next_point`, `notes_prev_point`,
`notes_goto_point { index }`, `notes_scroll_down { amount }`,
`notes_scroll_up { amount }` (default 0.33), `notes_top`,
`notes_select { notes: dropdown }` (choices from the loaded show),
`stage_message_send { text }`, `stage_message_clear`.

Variables: `notes_title`, `notes_point` (1-based), `notes_point_count`,
`notes_point_heading`, `notes_next_heading`, `stage_message`.

Feedbacks: `notes_active`, `notes_at_first`, `notes_at_last`,
`stage_message_showing`.

Presets: a **Pastor Notes** page — Prev / Next (with
`$(overlaysys:notes_point)/$(overlaysys:notes_point_count)` and
heading text), Scroll Up / Scroll Down, Top. Pastors open this page via
Companion's web buttons on their phone.

## Operator app

- **Show editor** (`apps/operator/src/app/shows/edit`): "Sermon notes"
  tab — add/rename/delete sets; Markdown textarea with a live
  point-split preview; **Import** (.txt, .md raw; .docx via `mammoth`
  → Markdown keeping headings, bold, lists). Each row's editor gets a
  "Notes set" picker.
- **Live Stage panel** (near `Monitors`): active notes set + current
  point heading with Prev/Next; message input with Send / Clear and
  quick presets; live thumbnail per stage channel (a `StageRenderer`
  fed from the store's `stage_feed` cache).
- **Settings → Message presets**: editable list, default
  "Wrap up", "5 minutes", "Stand by". Stored in app settings.
- **Settings → Channels**: kind selector; Stage shows "Follows" and
  "Layout" pickers and hides render mode / mirror.

## Layout designer

- Route `/design/stage/edit?id=`; a "Stage layouts" tab on `/design`
  lists layouts with new / duplicate / delete (built-ins duplicate
  only).
- `StageCanvas` (new in `editor-kit`, sibling of `Canvas`): renders the
  real widget components against a sample feed; overlay handles
  move + 8-direction resize; snapping to canvas edges/center and other
  widgets' edges/centers; arrow nudge (Shift = 10 px); multi-select,
  align, distribute.
- Left panel: widget palette (click or drag to add); widget list for
  reordering (z-order), hide, lock.
- Right panel: `StageInspector` — shared style controls reusing
  `FontInput`, `ColorInput`, number inputs; per-kind props controls.
- Top bar: size presets (1920×1080, 3840×2160, 1920×1200, 1600×1200,
  custom); background; **sample data** switcher (Song, Scripture,
  Sermon notes, Video + timer, Message); **Preview on monitor** — pushes
  the unsaved draft to one chosen live stage channel until toggled off
  or saved.
- Undo/redo via the immer + history pattern in `editorStore.ts`.
- Save pushes to open monitors immediately.

## Testing

Vitest, logic only (repo has no DOM test environment); UI and widget
rendering verified manually in the running app.

- Schemas: `StageLayout`, widgets, `SermonNotes`; `ChannelConfig`
  without `kind` parses as `graphics`.
- `splitPoints`: headings at mixed levels, blank-line fallback, empty
  input, leading text before first heading.
- `notesNav`: clamping, scroll reset on point change, overflow →
  neighbor point, deleted set.
- `buildStageFeed`: lyric next across section boundaries and at
  arrangement end, scripture next/last, next row + cue, timer
  extraction, video, missing `follows` channel.
- `liveRow`: set by sourced takes, kept by unsourced takes and clear,
  carried by `take_pvw_to_pgm`.
- Server WS: `notes_*` and `stage_message*` handlers; stage
  subscribers receive `stage_feed`, graphics subscribers unchanged;
  `stage_state` broadcast; layout save re-pushes.
- Companion: `dispatchAction` for new actions; variable and feedback
  derivation.
- Import: .txt / .md / .docx fixtures → expected Markdown.
- `fitFontSize` with an injected measure function.
- Phase 5: `stage_layouts` sync, following existing syncEngine tests.

## Phases

Each phase gets its own implementation plan and ships independently.

1. **Stage channel foundation** — `kind`/`follows`/`layoutId`,
   `liveRow` plumbing, `StageFeed`, `stage_feed` transport, `StageRenderer`,
   widgets `currentSlide`, `nextSlide`, `rowTitle`, `rowCue`, `clock`,
   `timer`, `videoRemaining`, `text`; built-in Speaker layout (notes area
   omitted); channel settings UI. Layouts are built-in only — on-disk
   `data/stage-layouts/` storage arrives with the designer in phase 5.
2. **Sermon notes** — schema, show editor tab, import, row linking,
   `StageState` + `notesNav`, `notes_*` messages, `sermonNotes` widget,
   Speaker layout gains notes, operator Stage panel (notes part).
3. **Companion** — actions, variables, feedbacks, Pastor Notes preset.
4. **Operator messages** — `message` widget, `stage_message*`,
   Stage panel messaging, message presets setting, Companion message
   actions.
5. **Layout designer** — `StageCanvas`, inspector, sample data,
   preview-on-monitor, Lyrics + Scripture built-ins, layout CRUD UI,
   cloud sync of `stage_layouts`.
