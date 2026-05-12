# Bitfocus Companion Integration — Design

**Date:** 2026-05-12
**Status:** Approved for planning
**Context:** OverlaySys is operated from a Next.js operator UI today. The user wants to drive the same actions (rundown rows, hotcards, take/clear, slide navigation) and surface state (channel status, current template/song, STT health, rundown row names) from a Bitfocus Companion control surface — e.g. a Stream Deck. The server already speaks a discriminated-union WebSocket protocol that covers every required action and emits live state, so the integration is primarily a Companion-side adapter.

## Goals

- Trigger every show-control action from Companion: take/clear/cue, take PVW→PGM, fire hotcards, song take/advance/jump/blank/end, STT start/stop.
- Surface live state on Companion buttons: per-channel live/blank, currently-loaded template, current song title and section/slide, STT spawner state, rundown row names.
- Native Companion UX — dropdowns auto-populated with the server's shows/songs/hotcards/channels, button feedbacks that change color with state, variables that update in real time.
- Reuse the existing `@overlaysys/ws-protocol` package so action shapes and state types never drift from the server.

## Non-goals (v1)

- Editing templates, songs, shows, or hotcards from Companion (those stay in the operator UI).
- Authentication / multi-tenant — single trusted LAN, same trust model as the operator UI today.
- Multi-server connections from one Companion instance (one server per module instance; multiple instances are fine).
- Submission to Bitfocus's `companion-module-requests` registry (designed-for, not shipped in v1).
- Asset upload, channel config editing, STT spawner config editing.
- TLS/wss support (matches current server posture).

## Architecture

A new workspace package: **`packages/companion-module/`**. The Companion runtime loads it as a developer module; it opens a single WebSocket to the OverlaySys server and bridges Companion's action/feedback/variable model onto the server's existing message types.

```
┌─────────────────────┐    WS (existing protocol)    ┌───────────────────────┐
│ Bitfocus Companion  │ ◄─────────────────────────► │ OverlaySys server      │
│                     │                              │ :4000/ws               │
│  ┌───────────────┐  │                              │                        │
│  │ companion-    │  │                              │  channels / shows /    │
│  │ module-       │  │                              │  songs / hotcards /    │
│  │ overlaysys    │  │                              │  songSession / stt     │
│  └───────────────┘  │                              │                        │
└─────────────────────┘                              └───────────────────────┘
        │
        ▼
  Stream Deck (or any Companion surface)
```

No new transport, no new protocol surface on the server. Server-side changes are expected to be **zero** in v1 — the existing `subscribe` / `list_*` / `*_list` / `state` / `*_status` traffic already covers everything the module needs. If a gap is discovered during implementation it gets added as a focused, additive protocol message in a later increment, not pre-emptively.

### Why a Companion module (vs. HTTP shim or OSC bridge)

- Companion-native primitives (actions, feedbacks, variables, presets) are what give Stream Deck buttons their dropdowns, color-changing state, and dynamic labels. Generic HTTP and OSC modules can fire requests but can't drive that UX.
- The server's protocol is already shaped the way Companion expects (discriminated actions + a subscription/state stream). The module is mostly glue, not translation.
- Avoids carrying a parallel REST/SSE surface on the server in addition to the WS protocol.

### Why a workspace package (vs. separate repo)

User preference, and it has a real upside: the module imports `@overlaysys/ws-protocol` directly via the workspace, so any schema change in the protocol surfaces as a TypeScript error in the module on the same commit. Tradeoff acknowledged: Companion modules typically live in their own repos with their own release cadence; if we ever submit to `bitfocus/companion-module-requests`, we may need to extract or vendor it then.

## Module package layout

```
packages/companion-module/
  package.json                       # name: overlaysys-companion-module
  companion/                         # Companion-required manifest dir
    manifest.json
    HELP.md
  src/
    index.ts                         # Companion module entry (ModuleInstance)
    connection.ts                    # WS client + reconnect with backoff
    state.ts                         # Local cache of server state
    actions.ts                       # Action definitions → WS sends
    feedbacks.ts                     # Feedback definitions → state predicates
    variables.ts                     # Variable definitions → state projections
    presets.ts                       # Preset button packs
    upgrades.ts                      # Companion upgrade scripts (placeholder)
  src/__tests__/
    state.test.ts                    # Reducer-style tests over WS messages
    variables.test.ts                # Variable projections from state
    feedbacks.test.ts                # Feedback predicates from state
```

It is **not** built or bundled into the Electron desktop app; it's a sibling package only the Companion runtime loads.

## Module configuration (Companion UI)

The module instance's config form exposes:

- **Host** (string, default `127.0.0.1`)
- **Port** (number, default `4000`)
- **Channels to subscribe** (CSV string, default `program,preview`) — drives which channels feed variables/feedbacks.
- **Reconnect** (read-only status display)

No auth fields in v1.

## Connection lifecycle

On `init` / config change:

1. Open WS to `ws://{host}:{port}/ws`.
2. On `hello`: send `subscribe` for each configured channel, then `list_templates`, `list_shows`, `list_songs`, `list_hotcards`, `list_channels`, `stt_spawner_get_config`.
3. Set Companion status to `OK`.
4. Apply incoming messages to the local state cache; on every state mutation, call `checkFeedbacks()` and `setVariableValues()`.
5. On socket close: set status `Disconnected`, reconnect with exponential backoff (1s, 2s, 4s, 8s, capped at 30s).

## Local state cache (`state.ts`)

```ts
interface CompanionState {
  connected: boolean;
  channelStates: Map<string, ChannelState>;       // ws "state" messages
  templates: TemplateMeta[];                       // ws "template_list"
  shows: ShowMeta[];                               // ws "show_list"
  songs: SongMeta[];                               // ws "song_list"
  hotcards: HotcardMeta[];                         // ws "hotcard_list"
  channels: ChannelConfig[];                       // ws "channel_list"
  showCache: Map<string, Show>;                    // lazy `get_show`
  songCache: Map<string, Song>;                    // lazy `get_song` (needed to resolve section/slide labels)
  loadedShowId: string | null;                     // module-local; set by `load_show` action
  loadedShowRowCursor: number | null;              // optional cursor for "next/prev row" actions
  sttSpawner: SttSpawnerStatus | null;             // ws "stt_spawner_status"
  sttListeners: SttListenerState[];                // ws "stt_listener_state"
}
```

The reducer is a pure function `apply(state, ServerMessage) → state`. This keeps tests deterministic — feed in a sequence of recorded `ServerMessage`s, assert the resulting state, variables, and feedbacks.

### Loaded show (module-local)

The module instance carries an explicit "loaded show" pointer (`loadedShowId`) set by a `load_show` action. This is **client-local state** — the server is untouched, and other Companion instances or the operator UI are unaffected.

Behavior:

- `load_show` populates `loadedShowId`, fetches the full `Show` via `get_show` into `showCache` (if not already cached), and resets `loadedShowRowCursor` to 0.
- All `rundown_*` variables, the `take_row` family of actions, and the row-related feedbacks read from this pointer.
- If the loaded show is deleted server-side (`show_list` no longer contains it), the pointer clears.
- If `save_show` arrives for the loaded show, the cached copy updates; variables and feedbacks re-emit.
- Persistence: stored in module config so it survives Companion restarts. The user picks the show once per service rather than every reboot.

This is intentionally a parallel concept to the operator UI's notion of "current show" — Companion's loaded show is a control-surface choice, not authoritative show state.

## Actions

Each action maps to a single `ClientMessage`. Dropdowns are populated from the local cache (channels, shows, hotcards, songs).

| Action ID                | Inputs                                                       | Sends                                                                 |
|--------------------------|--------------------------------------------------------------|-----------------------------------------------------------------------|
| `load_show`              | showId (dropdown)                                            | `get_show { showId }` (fills cache); updates module-local pointer     |
| `clear_loaded_show`      | —                                                            | clears module-local pointer                                           |
| `take_row`               | rowId (dependent dropdown from loaded show), channel (default = row's `channelHint`, else `program`) | graphic row → `take { channel, templateId, data }` from the row; song row → `song_take { channel, showId, songRowId }` |
| `take_row_pvw_pgm`       | rowId, fromChannel (default `preview`), toChannel (default `program`) | graphic row → `cue` on PVW then `take_pvw_to_pgm`; song row → `song_take_pvw_to_pgm`. Implementation detail: emit both as a single user gesture. |
| `take_row_at_cursor`     | channel                                                       | resolves `loadedShowRowCursor` → row; same dispatch as `take_row`     |
| `cursor_advance`         | delta (number, default 1)                                     | clamps `loadedShowRowCursor + delta` into row bounds                  |
| `cursor_set`             | rowId                                                         | sets `loadedShowRowCursor` to that row's index                        |
| `take_template`          | channel (dropdown), templateId (dropdown), data (textinput)¹ | `take { channel, templateId, data }`                                  |
| `clear`                  | channel                                                       | `clear { channel }`                                                   |
| `cue_template`           | channel, templateId, data¹                                    | `cue { channel, templateId, data }`                                   |
| `take_pvw_to_pgm`        | fromChannel (default `preview`), toChannel (default `program`)| `take_pvw_to_pgm { fromChannel, toChannel }`                          |
| `fire_hotcard`           | hotcardId (dropdown), channel (dropdown, default = hint)      | `take` with the hotcard's `templateId` + `data` on the chosen channel |
| `song_take_row`          | showId (dropdown), songRowId (dependent dropdown), channel    | `song_take { channel, showId, songRowId }` (kept as a direct action for users who don't want to load a show) |
| `song_take_row_pvw_pgm`  | showId, songRowId, fromChannel, toChannel                     | `song_take_pvw_to_pgm`                                                |
| `song_advance`           | channel, delta (number, default 1)                            | `song_advance { channel, delta }`                                     |
| `song_jump_section`      | channel, sectionId (dependent dropdown from showCache)        | `song_jump { channel, sectionId, slideIdx: 0 }`                       |
| `song_jump_kind`         | channel, kind (verse/chorus/bridge/...), ordinal (number)     | `song_jump_kind { channel, kind, ordinal }`                           |
| `song_blank`             | channel                                                       | `song_blank { channel }`                                              |
| `song_end`               | channel                                                       | `song_end { channel }`                                                |
| `song_set_trust`         | channel, trustMode (bool)                                     | `song_set_trust { channel, trustMode }`                               |
| `stt_start`              | —                                                             | `stt_spawner_start`                                                   |
| `stt_stop`               | —                                                             | `stt_spawner_stop`                                                    |

¹ "Data" textinput is `key=value` lines parsed into a `Record<string, string>`. Hotcards already carry their own data, so the `fire_hotcard` action doesn't take a data input.

### "Fire hotcard" semantics

Companion fetches the hotcard's stored `templateId` + `data` from the local cache (kept fresh by `hotcard_list` / `hotcard` broadcasts) and sends a `take` message with that payload. If the user did not override the channel, fall back to `hotcard.channelHint` if present, otherwise `program`.

## Variables

Companion variables are flat key/value strings. Per configured channel `<c>` (typically `program` and `preview`):

| Variable                              | Source                                                                 |
|---------------------------------------|------------------------------------------------------------------------|
| `<c>_template_id`                     | `channelStates.get(c).active?.templateId` or empty when cleared        |
| `<c>_template_name`                   | template lookup from `templates`                                       |
| `<c>_is_live`                         | `'yes'` if `active` is non-null                                        |
| `<c>_phase`                           | `active?.phase` (`in` / `on` / `out`) — useful for transition feedback |
| `<c>_data_<key>`                      | per-key projection of `active.data` (top 10 keys by name order)        |
| `<c>_song_title`                      | song looked up from `songs` by `songSession.songId`                    |
| `<c>_song_section`                    | section label (e.g. `Verse 2`) — derived by resolving `cursor.sectionIdx` against `arrangement` and the song's sections (must fetch song via `get_song` on first sighting; cached) |
| `<c>_song_slide_idx`                  | `cursor.slideIdx + 1` (1-based for display)                            |
| `<c>_song_slide_text`                 | first line of current slide (requires song fetch + cache)              |
| `<c>_song_blanked`                    | `songSession.blanked` → `yes` / `no`                                   |
| `<c>_song_trust_mode`                 | `songSession.trustMode` → `yes` / `no`                                 |

Global:

| Variable                  | Source                                              |
|---------------------------|-----------------------------------------------------|
| `connection_state`        | `connected` / `disconnected` / `reconnecting`        |
| `stt_running`             | from `sttSpawner.status`                            |
| `stt_listener_count`      | length of `sttListeners` where `online`             |
| `loaded_show_id`          | `loadedShowId` or empty                              |
| `loaded_show_name`        | name of the loaded show or empty                     |
| `loaded_show_row_count`   | `showCache.get(loadedShowId).rows.length`            |
| `cursor_row_idx`          | `loadedShowRowCursor + 1` (1-based for display)      |
| `cursor_row_name`         | display label of the row at the cursor               |
| `cursor_row_kind`         | `graphic` / `song`                                   |
| `rundown_<n>_name`        | display label of row `n` in the loaded show, for `n` = 1..40 |
| `rundown_<n>_kind`        | `graphic` / `song` for row `n`                       |
| `rundown_<n>_is_active`   | `yes` if row `n` matches what's currently on PGM²    |

The "display label" for a row is: song row → song title (from `songs` meta) plus arrangement tag if any; graphic row → row `notes` if set, else the template's name.

² A graphic row matches PGM when `active.templateId` + `active.data` deep-equal the row's. A song row matches PGM when `songSession.songId` equals the row's `songId`.

## Feedbacks

Feedbacks change a button's foreground/background color or text based on state. Each takes a channel input where relevant.

| Feedback                   | True when                                                                 |
|----------------------------|---------------------------------------------------------------------------|
| `channel_is_live`          | `channelStates.get(channel).active` is non-null                           |
| `channel_is_blank`         | inverse of `channel_is_live`                                              |
| `hotcard_on_air`           | a channel's `active.templateId`+`active.data` matches the chosen hotcard's|
| `song_active`              | `channelStates.get(channel).songSession` is defined                       |
| `song_section_is`          | active section's `kind` + `ordinal` matches inputs                        |
| `song_trust_on`            | the chosen channel's song session has `trustMode === true`                |
| `stt_running`              | `sttSpawner.status.state === 'running'`                                   |
| `connection_lost`          | `connected === false`                                                     |
| `show_loaded`              | `loadedShowId !== null`                                                   |
| `row_is_active`            | the chosen row (by `rowId` input) currently matches PGM (see ² above)     |
| `row_is_cursor`            | the chosen row is at `loadedShowRowCursor`                                |

## Presets

A small starter set so a new user gets working buttons immediately:

- **Master row** — Take PVW→PGM (green when PVW has content), Clear PGM (red when PGM live), STT On/Off (toggles, lit while running).
- **Rundown row** — eight buttons each bound to `take_row` for rows 1–8 of the loaded show, labels driven by `$(overlaysys:rundown_<n>_name)`, lit when `row_is_active`. Plus a Previous/Next pair that drives `cursor_advance ±1` and a Take-At-Cursor button.
- **Song row** — Advance −1, Advance +1, Blank Song, End Song. Active section name surfaces via `$(overlaysys:program_song_section)`.
- **Hotcards row** — placeholder buttons that the user assigns specific hotcards to via the `fire_hotcard` action; the button label uses `$(overlaysys:<hotcard_name>)` and is lit while on air.

Presets are loaded by Companion via `setPresetDefinitions`.

## Error handling

- **Reducer is total** — unknown message types are ignored, never throw. The connection survives schema drift (a server adding a new message type doesn't crash the module).
- **Action send when disconnected** — short-circuits, logs `this.log('warn', ...)`, no retry queue (intentional: Companion buttons are inherently "fire and forget"; queueing stale takes after a long disconnect is worse than dropping them).
- **`error` server message** — logged at warn level, surfaced into a `last_error` variable so the user can put it on a button if they want diagnostics.
- **Zod parse failures inbound** — logged at error level; the connection stays open.

## Testing

- **State reducer tests** (`state.test.ts`) — feed sequences of `ServerMessage`s, assert the resulting `CompanionState`. Covers: subscribe→state→clear, hotcard list updates, song session lifecycle, STT status transitions.
- **Variable projection tests** (`variables.test.ts`) — given a state, assert the variable map. Covers all variables listed above, including empty/cleared cases.
- **Feedback predicate tests** (`feedbacks.test.ts`) — given a state and feedback options, assert true/false.
- **No end-to-end Companion runtime tests.** Companion's host-loaded runtime is non-trivial to fake; the reducer-based testing covers all the logic that's actually ours. A manual smoke checklist (start server → install module dev path → exercise each preset) goes in `HELP.md`.

## Documentation deliverables

- `packages/companion-module/companion/HELP.md` — install steps for Companion's developer-modules directory, config form explanation, action reference, manual smoke checklist.
- A short note in the repo root `README.md` pointing at the package.

## Open questions deferred to plan / implementation

- Exact list of variables (we may trim or expand `<c>_data_<key>` projections after first real-world use).
- Whether `take_template` / `cue_template` belong in v1 presets or are advanced-only — they're powerful but easy to misuse (any template, any channel). They will exist as actions; presets will not surface them.
- Upper bound on `rundown_<n>_*` variables. Spec'd at 40; Companion can technically handle more but each row adds 3 variables. If real shows routinely exceed 40 rows, raise.
- Companion runtime version target. Companion 3.x is current; we pin to its module API version in `manifest.json` once we start writing code.
