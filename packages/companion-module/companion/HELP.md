# OverlaySys Companion Module

Connects Bitfocus Companion to an OverlaySys server over WebSocket.

## Installation (developer mode)

1. Build: `pnpm -F @overlaysys/companion-module build`
2. In Companion, open the **Developer modules** path (set in Companion → Settings → Developer modules) and point it at `packages/companion-module/`.
3. Restart Companion. The module appears as **OverlaySys**.
4. Add a new connection of type **OverlaySys**, configure host/port, and Save.

## Configuration

| Field | Default | Notes |
|-------|---------|-------|
| Host | `127.0.0.1` | OverlaySys server host |
| Port | `4000` | OverlaySys WS port |
| Channels to subscribe | `program,preview` | Channel IDs to subscribe to and surface as variables |
| LAN token | `` | Only when the server sets `OVERLAYSYS_TOKEN` (see the main README, "LAN security") |
| Loaded show ID | `` | Persisted across restarts; usually set via the **Load Show** action |

The module pings the server every 5 s and reconnects if it hears nothing for 10 s (first retry after 250 ms, backing off to 10 s). If the server speaks a different protocol version, a warning is logged: update the older side.

## Actions

| Action | Inputs | Effect |
|--------|--------|--------|
| Take template | channel, template, data | Take a template on the chosen channel |
| Clear channel | channel | Clear the chosen channel |
| Cue template | channel, template, data | Cue (pre-load) a template |
| Take PVW → PGM | from, to | Promote preview to program |
| Fire hotcard | hotcard, channel | Take a hotcard's stored payload on a channel |
| Load show | show | Load a show into this Companion instance |
| Clear loaded show | — | Clear the loaded-show pointer |
| Take row (by row ID) | row, channel | Take the chosen row by its UUID — binding breaks if the loaded show changes |
| Take row (by index) | rowIndex (1-based), channel | Take the Nth row of whatever show is loaded — bindings survive show changes |
| Take row PVW → PGM (by row ID) | row, from, to | Cue then promote, or song_take_pvw_to_pgm for song rows |
| Take row PVW → PGM (by index) | rowIndex, from, to | Same as above but addressed by position |
| Take row at cursor | channel | Take whichever row the cursor is on |
| Take row (song-aware) | row (cursor / index / ID), song part, channel or PVW → PGM | One action for a line that may be a song or a regular item: a song row fires the chosen sub-take (intro / lyrics / outro, like **Song: take sub-take**); any other row takes exactly like **Take row**. Channel blank = the song's cascade channel or the row's channel hint. With PVW → PGM on, graphics cue then promote and song lyrics use song PVW → PGM; song intro/outro have no preview stage and go straight to the To channel |
| Cursor: advance | delta | Move the cursor ±N rows (clamped) |
| Cursor: back one row | — | Same as Cursor: advance −1 |
| Cursor: set to row (by row ID) | row | Jump the cursor to a specific row by UUID |
| Cursor: set to row (by index) | rowIndex | Jump the cursor to the Nth row of the loaded show |
| Song: take row | show, songRow, channel | Take a song row from any show |
| Song: take row PVW → PGM | show, songRow, from, to | Promote a song row through preview |
| Song: advance ± | channel, delta | song_advance |
| Song: jump to section | channel, sectionId | song_jump |
| Song: jump by kind+ordinal | channel, kind, ordinal | song_jump_kind |
| Song: blank | channel | song_blank |
| Song: end | channel | song_end |
| Song: set trust mode | channel, trustMode | song_set_trust |
| STT: start spawner | — | stt_spawner_start |
| STT: stop spawner | — | stt_spawner_stop |
| Panic: clear ALL channels | leave video playing (off) | Every channel's graphic out and every video hard-cut, in one server step (mirrors follow their source) |
| Stage timer: create countdown | label, minutes, seconds, overtime, start | Creates a stage countdown timer and (by default) starts it |

Data input fields parse `key=value` lines into a record. Empty values are allowed; lines without `=` are ignored.

## Select next show

The **Select next show (soonest upcoming, else most recent)** action loads the
show whose service date is the soonest on or after today, then resets the row
cursor — the same as picking it via **Load show**, but with no dropdown. When
nothing is scheduled today or later it falls back to the most recent past show,
so the button always lands somewhere as long as your shows carry dates. A show's
date comes from its `scheduledFor` field (set in the operator's show editor); if
that is empty, the date is parsed from the show name (`M/D/YY` or `M/D/YYYY`,
e.g. "5/17/26 Service"). A show with neither is invisible to this action — if
*no* show carries a date, the button does nothing and logs a warning. A
ready-to-use **Select Next Show** preset button is included.

## Variables

Per configured channel `<c>` (e.g. `program`, `preview`):

- `<c>_template_id`, `<c>_template_name`, `<c>_is_live`, `<c>_phase`
- `<c>_data_<n>_key` / `<c>_data_<n>_value` for n=1..10 (first 10 keys of the active template's data, sorted alphabetically by key)
- `<c>_song_queued_title` — the song armed by its intro on that channel (empty when none)
- `<c>_song_title`, `<c>_song_section`, `<c>_song_slide_idx`, `<c>_song_slide_text`, `<c>_song_blanked`, `<c>_song_trust_mode`

- `<c>_outputs` — how many renderer windows (OBS browser sources, output windows) are connected to the channel; empty until the server reports
- `<c>_video_title`, `<c>_video_status`, `<c>_video_elapsed` / `<c>_video_remaining` (M:SS), `<c>_video_remaining_sec`, `<c>_video_progress` (0–100) — the channel's video. Updated about once a second.

Global:

- `connection_state` (connected / disconnected / reconnecting)
- `server_version`
- `stt_confidence` (0–100, last suggestion), `stt_last_heard` (last text heard), `stt_silent_sec` (seconds since STT heard anything while a song is live; empty when no song is live)
- `last_error`
- `stt_running`, `stt_listener_count`
- `loaded_show_id`, `loaded_show_name`, `loaded_show_row_count`
- `cursor_row_idx`, `cursor_row_name`, `cursor_row_kind` (song / graphic / video / scripture), `cursor_row_is_song` (yes / no)
- `rundown_<n>_name` / `rundown_<n>_kind` / `rundown_<n>_is_active` for n=1..40

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

## Feedbacks

`channel_is_live`, `channel_is_blank`, `hotcard_on_air`, `video_on_air`, `video_paused`, `video_remaining_below` (channel, seconds), `video_errored`, `output_offline` (no renderer window connected to the channel), `stt_silent` (a song is live and STT has heard nothing for more than N seconds), `song_active`, `song_queued`, `song_trust_on`, `song_section_is` (input: `kind:ordinal`, e.g. `chorus:2`), `stt_running`, `connection_lost`, `show_loaded`, `row_is_cursor` (by UUID), `row_is_active` (by UUID), `row_at_index_is_cursor` (by 1-based index — survives show changes), `row_at_index_is_active` (same), `cursor_row_kind_is` (true when the cursor row is the chosen type), `row_at_index_kind_is` (same, for the Nth row).

Presets include **PANIC** (clear every channel), **PGM output status** (red when no output is connected), **PGM video countdown** (remaining time, red under 10 s, amber on error), **Start a 5-minute countdown**, and **STT status** (red when silent for 15 s during a song).

### Intro, then section buttons

Taking a song's **intro** (song sub-take → Intro) queues that song on the
channel the intro went to. Song actions on that channel — **Song: jump by
kind + ordinal** (Verse 1, Chorus…), **Song: jump to section**, and **Song:
advance +1** — then start the song right at that point, replacing the intro.
**Song: blank** / **Song: end** cancel the queue. Point your section buttons at
the same channel as the intro. The **Song queued** feedback and
`<c>_song_queued_title` variable show which song is armed.

### Doing something extra when the current line is a song

Use **Take row (song-aware)** for the take itself. To run additional actions
only for songs, either add the **Cursor row is type → Song** feedback to the
button's logic/condition, or test the variable in an expression, e.g.
`$(overlaysys:cursor_row_is_song) == 'yes'` (or
`$(overlaysys:cursor_row_kind) == 'song'`). The **Take at cursor (song-aware)**
preset shows the row type on the button and tints it purple for songs.

### Choosing row-ID vs row-index actions/feedbacks

- **By row ID** binds to a specific row's UUID. If you author one Stream Deck page per show with hand-picked rows, this is fine.
- **By index** binds to the Nth row of whatever show is loaded. Use this when you want one bank of buttons that works across multiple shows (e.g. button 1 always fires whatever row 1 is, regardless of which show you loaded).

## Manual smoke checklist

1. Start the server: `pnpm dev` (or `pnpm desktop`).
2. Add the connection in Companion; verify the status indicator goes green.
3. Add a button bound to **Take PVW → PGM**; cue something to preview in the operator UI, then press the Companion button — confirm it promotes to program.
4. Add a button bound to **Fire hotcard** for a known hotcard; press it and confirm it appears on program.
5. Run **Load show** with a show that contains both graphic and song rows; confirm `loaded_show_name` populates and `rundown_1_name` shows the first row's label.
6. Press **Cursor +1** then **Take at cursor**; confirm the second row goes to program (a graphic via `take`, or a song via `song_take`).
7. With a song running, press **Song: advance ±1**; confirm slide changes in the operator UI and renderer.
8. Press **STT: start spawner**; confirm `stt_running` variable becomes `yes` and the STT toggle button lights green.

## Spec

See `docs/superpowers/specs/2026-05-12-companion-integration-design.md`.
