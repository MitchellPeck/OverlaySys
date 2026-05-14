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
| Loaded show ID | `` | Persisted across restarts; usually set via the **Load Show** action |

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
| Take row | row, channel | Take the chosen row (graphic → take, song → song_take) |
| Take row PVW → PGM | row, from, to | Cue then promote, or song_take_pvw_to_pgm for song rows |
| Take row at cursor | channel | Take whichever row the cursor is on |
| Cursor: advance | delta | Move the cursor ±N rows (clamped) |
| Cursor: set to row | row | Jump the cursor to a specific row |
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

Data input fields parse `key=value` lines into a record. Empty values are allowed; lines without `=` are ignored.

## Variables

Per configured channel `<c>` (e.g. `program`, `preview`):

- `<c>_template_id`, `<c>_template_name`, `<c>_is_live`, `<c>_phase`
- `<c>_data_<n>_key` / `<c>_data_<n>_value` for n=1..10 (first 10 keys of the active template's data, sorted alphabetically by key)
- `<c>_song_title`, `<c>_song_section`, `<c>_song_slide_idx`, `<c>_song_slide_text`, `<c>_song_blanked`, `<c>_song_trust_mode`

Global:

- `connection_state` (connected / disconnected / reconnecting)
- `last_error`
- `stt_running`, `stt_listener_count`
- `loaded_show_id`, `loaded_show_name`, `loaded_show_row_count`
- `cursor_row_idx`, `cursor_row_name`, `cursor_row_kind`
- `rundown_<n>_name` / `rundown_<n>_kind` / `rundown_<n>_is_active` for n=1..40

## Feedbacks

`channel_is_live`, `channel_is_blank`, `hotcard_on_air`, `song_active`, `song_trust_on`, `song_section_is` (input: `kind:ordinal`, e.g. `chorus:2`), `stt_running`, `connection_lost`, `show_loaded`, `row_is_cursor`, `row_is_active`.

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
