# OverlaySys Companion Module

## Quick start (volunteers)

1. **Install.** Ask your tech lead to add the OverlaySys module to Companion (see "Installation" below).
2. **Connect.** In Companion, add a connection of type **OverlaySys** and enter the server address you were given. The status light turns green when it is connected.
3. **Drag the "Rundown" presets.** Open the Presets tab, pick **OverlaySys**, then the **Rundown** group, and drag the row buttons onto your Stream Deck page. In the OverlaySys app, open the show you are running under **Live**.
4. **Take.** Press a row button to put that line on air. The button lights up while it is live.
5. **Clear.** Press the **Clear** button (or **PANIC** if something is wrong) to take everything off air.

# For developers

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
| Loaded show ID | `` | Persisted across restarts; usually set via the **Show: load into Companion** action |

The module pings the server every 5 s and reconnects if it hears nothing for 10 s (first retry after 250 ms, backing off to 10 s). If the server speaks a different protocol version, a warning is logged: update the older side.

## Actions, feedbacks and variables

The tables below are generated from the module's own definitions. Do not edit them by hand: run `pnpm --filter @overlaysys/companion-module gen:help` to refresh them.

<!-- generated:start -->
### Actions

| Name | Id | Inputs |
|------|----|--------|
| Template: take on channel | `take_template` | Channel, Template, Data (key=value lines) |
| Channel: clear graphics | `clear` | Channel |
| Channel: clear graphics and video | `clear_all` | Channel |
| Video: stop (animate out) | `video_stop` | Channel |
| Video: play/pause | `video_play_pause` | Channel |
| Video: restart | `video_restart` | Channel |
| Template: cue on channel | `cue_template` | Channel, Template, Data (key=value lines) |
| Channel: take preview to program | `take_pvw_to_pgm` | From, To |
| Hotcard: take | `fire_hotcard` | Hotcard, Channel |
| Hotcard: cue | `cue_hotcard` | Hotcard |
| Show: load into Companion | `load_show` | Show |
| Show: clear loaded show | `clear_loaded_show` | − |
| Show: select next show (soonest upcoming, else most recent) | `select_next_show` | − |
| Rundown: take row (pick from list) | `take_row` | Row, Channel |
| Rundown: take row (by number) | `take_row_by_index` | Row index (1-based; survives show changes), Channel |
| Rundown: take row via preview (pick from list) | `take_row_pvw_pgm` | Row, From, To |
| Rundown: take row via preview (by number) | `take_row_pvw_pgm_by_index` | Row index (1-based; survives show changes), From, To |
| Rundown: take row at cursor | `take_row_at_cursor` | Channel |
| Scripture: take intro (pick from list) | `scripture_take_intro` | Show, Row, Channel (optional) |
| Scripture: take intro (by number) | `scripture_take_intro_by_index` | Row index (1-based; survives show changes), Channel (optional) |
| Scripture: take intro (at cursor) | `scripture_take_intro_at_cursor` | Channel (optional) |
| Scripture: take slide N (pick from list) | `scripture_take_slide` | Show, Row, Slide (1-based), Channel (optional) |
| Scripture: take slide N (by number) | `scripture_take_slide_by_index` | Row index (1-based; survives show changes), Slide (1-based), Channel (optional) |
| Scripture: take slide N (at cursor) | `scripture_take_slide_at_cursor` | Slide (1-based), Channel (optional) |
| Scripture: next/previous slide (starts a queued scripture) | `scripture_advance` | Channel, Delta |
| Scripture: go to slide N (starts a queued scripture) | `scripture_goto` | Channel, Slide (1-based) |
| Scripture: end (cancels a queued scripture) | `scripture_end` | Channel |
| Slides: next / previous slide | `slides_advance` | Channel, Delta |
| Slides: go to slide N | `slides_goto` | Channel, Slide (1-based) |
| Slides: blank | `slides_blank` | Channel |
| Slides: end | `slides_end` | Channel |
| Rundown: take row (song-aware: songs take a part, other rows take normally) | `take_row_song_aware` | Row, Row index (1-based; survives show changes), Row, Song part (used only when the row is a song), Take via PVW → PGM, Channel (optional; blank = row/song default), From, To |
| Cursor: move by N rows | `cursor_advance` | Delta |
| Cursor: back one row | `cursor_prev` | − |
| Panic: clear all channels (graphics and video) | `panic` | Leave video playing |
| Stage timer: create countdown | `create_countdown` | Label, Minutes, Seconds, Count into overtime past zero, Start immediately |
| Cursor: set to row (pick from list) | `cursor_set` | Row |
| Cursor: set to row (by number) | `cursor_set_by_index` | Row index (1-based; survives show changes) |
| Song: take row (any show) | `song_take_row` | Show, Row, Channel |
| Song: take row (loaded show, by number) | `song_take_row_by_index` | Row index (1-based; survives show changes), Channel |
| Song: take row via preview (any show) | `song_take_row_pvw_pgm` | Show, Row, From, To |
| Song: take row via preview (loaded show, by number) | `song_take_row_pvw_pgm_by_index` | Row index (1-based; survives show changes), From, To |
| Song: take part (pick from list) | `song_take_sub` | Show, Row, Sub-take, Channel (optional) |
| Song: take part (by number) | `song_take_sub_by_index` | Row index (1-based; survives show changes), Sub-take, Channel (optional) |
| Song: next/previous slide | `song_advance` | Channel, Delta |
| Song: jump to section | `song_jump_section` | Channel, Section ID |
| Song: jump to section by type | `song_jump_kind` | Channel, Section kind, Ordinal |
| Song: blank | `song_blank` | Channel |
| Song: end | `song_end` | Channel |
| Auto-advance (STT): on/off | `song_set_trust` | Channel, Auto-advance (STT) |
| Speech-to-text: start listening | `stt_start` | − |
| Speech-to-text: stop listening | `stt_stop` | − |
| Sermon notes: next point | `notes_next_point` | − |
| Sermon notes: previous point | `notes_prev_point` | − |
| Sermon notes: go to point | `notes_goto_point` | Point (1-based) |
| Sermon notes: scroll down | `notes_scroll_down` | Amount (viewport fraction) |
| Sermon notes: scroll up | `notes_scroll_up` | Amount (viewport fraction) |
| Sermon notes: scroll to top | `notes_top` | − |
| Sermon notes: select set (loaded show) | `notes_select` | Notes |
| Stage screen: set layout | `set_stage_layout` | Stage screen, Layout |
| Stage: send message | `stage_message_send` | Message |
| Stage: clear message | `stage_message_clear` | − |
| Stage timer: start | `stage_timer_start` | Timer |
| Stage timer: pause | `stage_timer_pause` | Timer |
| Stage timer: resume | `stage_timer_resume` | Timer |
| Stage timer: reset | `stage_timer_reset` | Timer |
| Stage timer: adjust | `stage_timer_adjust` | Timer, Seconds (negative to subtract) |

### Feedbacks

| Name | Id | Inputs | When it is on |
|------|----|--------|---------------|
| Video: remaining below N seconds | `video_remaining_below` | Channel, Seconds | True while the chosen channel's video has N seconds or less left (playing or paused). |
| Video: errored | `video_errored` | Channel | True when the chosen channel's video failed to load or play. |
| Output: offline | `output_offline` | Channel | True when no renderer window (OBS browser source, output window) is connected to the chosen channel. Stays false until the server reports outputs. |
| Speech-to-text: silent while a song is live | `stt_silent` | Seconds | True when a song is live and speech-to-text hasn't heard anything for more than N seconds. |
| Sermon notes: active | `notes_active` | − | True when sermon notes with at least one point are selected. |
| Sermon notes: at first point | `notes_at_first` | − | True when notes are active and on the first point. |
| Sermon notes: at last point | `notes_at_last` | − | True when notes are active and on the last point. |
| Stage: message showing | `stage_message_showing` | − | True while a message is shown on the stage display. |
| Item timer: under 60 seconds | `item_timer_warning` | − | True when the current item timer is under 60 seconds remaining (not yet overtime). |
| Item timer: overtime | `item_timer_overtime` | − | True when the current item timer has run past zero (overtime on). |
| Planning Center: live sync active | `pco_live_active` | − | True while PCO Live sync is on and the service is live. |
| Channel: live | `channel_is_live` | Channel | True when the chosen channel has a graphic on air. |
| Channel: blank | `channel_is_blank` | Channel | True when the chosen channel is cleared. |
| Video: on air | `video_on_air` | Channel | True while the chosen channel has a video up (playing, paused or held on its last frame). |
| Video: paused | `video_paused` | Channel | True when the chosen channel's video is paused or holding at its end. |
| Hotcard: on air | `hotcard_on_air` | Hotcard, Channel | True when the chosen channel currently shows this hotcard's content. |
| Song: session active | `song_active` | Channel | True when the chosen channel has a live song session. |
| Song: queued (intro taken) | `song_queued` | Channel | True when the chosen channel has a song armed by its intro take. Song section / slide / advance actions on that channel will start it. |
| Auto-advance (STT): on | `song_trust_on` | Channel | True when the chosen channel's song session has trust mode enabled. |
| Song: section matches | `song_section_is` | Channel, Kind:Ordinal (e.g. verse:2) | True when the active section's kind + ordinal matches. |
| Song: part on channel (pick from list) | `song_sub_take_on_channel` | Channel, Row, Sub-take | True when the chosen channel is currently showing the chosen sub-take (intro / lyrics / outro) for the chosen song row. Sub-take template ids are resolved through the Song → ShowSong → Row cascade. Lyrics is true while a same-song session is live on the channel; intro/outro are true while the channel's active mount matches the resolved sub-take template. |
| Song: part on channel (by number) | `song_sub_take_on_channel_by_index` | Channel, Row index (1-based; survives show changes), Sub-take | Same as 'Song sub-take is on channel' but selects the song row from the loaded show by 1-based index — survives show changes. |
| Scripture: slides live | `scripture_active` | Channel | True when the chosen channel shows a scripture slide. |
| Slides: on air | `slides_on_air` | Channel | True when the chosen channel has a slides session. |
| Scripture: queued (intro taken) | `scripture_queued` | Channel | True when the chosen channel has a scripture armed by its intro. Next / go to slide on that channel will start it. |
| Scripture: slide N live | `scripture_slide_is` | Channel, Slide (1-based) | True when the chosen channel's live scripture is on slide N (1-based). |
| Speech-to-text: running | `stt_running` | − | True when speech-to-text reports it is running. |
| Connection: lost | `connection_lost` | − | True when the WebSocket is not connected. |
| Show: loaded | `show_loaded` | − | True when a show has been loaded into this Companion instance. |
| Rundown: row at cursor (pick from list) | `row_is_cursor` | Row | True when the chosen row is at the cursor position. |
| Rundown: row on program (pick from list) | `row_is_active` | Row | True when the chosen row's content currently matches PGM. |
| Rundown: row at cursor (by number) | `row_at_index_is_cursor` | Row index (1-based; survives show changes) | True when the row at the given 1-based index is at the cursor — survives show changes. |
| Rundown: row on program (by number) | `row_at_index_is_active` | Row index (1-based; survives show changes) | True when the row at the given 1-based index currently matches PGM — survives show changes. |
| Rundown: cursor row is type | `cursor_row_kind_is` | Row type | True when the row at the cursor is the chosen type (song, graphic, video, scripture). Use it to style a button or branch a button's actions when the current line is a song. |
| Rundown: row is type (by number) | `row_at_index_kind_is` | Row index (1-based; survives show changes), Row type | True when the row at the given 1-based index is the chosen type — survives show changes. |
| Rundown: row colour by type (by number) | `row_at_index_kind_color` | Row index (1-based; survives show changes), Song, Graphic, Scripture, Media, Slides | Sets the button background to the colour picked for the type of the row at the given 1-based index — one feedback instead of one per type. |

### Variables

`<c>` is a channel id (for example `program`); `<n>` counts from 1.

| Variable | What it holds |
|----------|---------------|
| `<c>_template_id` | <c> template id |
| `<c>_template_name` | <c> template name |
| `<c>_is_live` | <c> is live (yes/no) |
| `<c>_phase` | <c> transition phase |
| `<c>_song_title` | <c> song title |
| `<c>_song_section` | <c> song section label |
| `<c>_song_slide_idx` | <c> song slide index (1-based) |
| `<c>_song_slide_text` | <c> song slide first line |
| `<c>_song_blanked` | <c> song is blanked (yes/no) |
| `<c>_song_trust_mode` | <c> song trust mode (yes/no) |
| `<c>_song_queued_title` | <c> song queued by its intro (title) |
| `<c>_scripture_ref` | <c> scripture slide reference |
| `<c>_scripture_slide` | <c> scripture slide (n/total) |
| `<c>_scripture_text` | <c> scripture slide text |
| `<c>_scripture_queued_ref` | <c> scripture queued by its intro (reference) |
| `<c>_slides_deck` | <c> slides deck title |
| `<c>_slide_n` | <c> slides current slide (1-based) |
| `<c>_slide_count` | <c> slides slide count |
| `<c>_slides_next_in` | <c> slides seconds until the next auto-advance (blank when none) |
| `<c>_outputs` | <c> connected output windows (count) |
| `<c>_video_title` | <c> video title |
| `<c>_video_status` | <c> video status (loading/playing/paused/ended/error) |
| `<c>_video_elapsed` | <c> video elapsed (M:SS) |
| `<c>_video_remaining` | <c> video remaining (M:SS) |
| `<c>_video_remaining_sec` | <c> video remaining (seconds) |
| `<c>_video_progress` | <c> video progress (0-100) |
| `<c>_data_<n>_key` | <c> data slot <n> key |
| `<c>_data_<n>_value` | <c> data slot <n> value |
| `connection_state` | WebSocket connection state |
| `server_version` | OverlaySys server version |
| `stt_confidence` | Speech-to-text last suggestion confidence (0-100) |
| `stt_last_heard` | Speech-to-text last heard text |
| `stt_silent_sec` | Seconds since speech-to-text heard anything while a song is live |
| `last_error` | Last server-reported error |
| `stt_running` | Speech-to-text running (yes/no) |
| `stt_listener_count` | Online speech-to-text listeners |
| `loaded_show_id` | Loaded show id |
| `loaded_show_name` | Loaded show name |
| `loaded_show_row_count` | Loaded show row count |
| `cursor_row_idx` | Cursor row index (1-based) |
| `cursor_row_name` | Cursor row display label |
| `cursor_row_kind` | Cursor row kind (song/graphic/video/scripture) |
| `cursor_row_is_song` | Cursor row is a song (yes/no) |
| `notes_title` | Sermon notes title |
| `notes_point` | Sermon notes current point (1-based) |
| `notes_point_count` | Sermon notes point count |
| `notes_point_heading` | Sermon notes current point heading |
| `notes_next_heading` | Sermon notes next point heading |
| `stage_message` | Stage message currently showing |
| `item_timer` | Current item timer (M:SS, +M:SS in overtime) |
| `item_timer_label` | Current item timer label |
| `item_overtime` | Current item timer is in overtime (true/false) |
| `service_item` | PCO Live current item title |
| `service_next_item` | PCO Live next item title |
| `service_delta` | PCO Live projected overrun in minutes (+over / −under) |
| `rundown_<n>_name` | Rundown row <n> display label |
| `rundown_<n>_label` | Rundown row <n> button label (graphic title, else display label) |
| `rundown_<n>_kind` | Rundown row <n> kind |
| `rundown_<n>_page` | Rundown row <n> page for its kind (module config; blank = none) |
| `rundown_<n>_is_active` | Rundown row <n> matches PGM |
<!-- generated:end -->

Data input fields parse `key=value` lines into a record. Empty values are allowed; lines without `=` are ignored.

## Select next show

The **Show: select next show** action loads the
show whose service date is the soonest on or after today, then resets the row
cursor — the same as picking it via **Show: load into Companion**, but with no dropdown. When
nothing is scheduled today or later it falls back to the most recent past show,
so the button always lands somewhere as long as your shows carry dates. A show's
date comes from its `scheduledFor` field (set in the operator's show editor); if
that is empty, the date is parsed from the show name (`M/D/YY` or `M/D/YYYY`,
e.g. "5/17/26 Service"). A show with neither is invisible to this action — if
*no* show carries a date, the button does nothing and logs a warning. A
ready-to-use **Select Next Show** preset button is included.

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

## Presets and recipes

Presets include **PANIC** (clear every channel), **PGM output status** (red when no output is connected), **PGM video countdown** (remaining time, red under 10 s, amber on error), **Start a 5-minute countdown**, and **STT status** (red when silent for 15 s during a song).

### Intro, then section buttons

Taking a song's **intro** (**Song: take part** → Intro) queues that song on the
channel the intro went to. Song actions on that channel — **Song: jump to
section by type** (Verse 1, Chorus…), **Song: jump to section**, and **Song:
next/previous slide** — then start the song right at that point, replacing the intro.
**Song: blank** / **Song: end** cancel the queue. Point your section buttons at
the same channel as the intro. The **Song: queued (intro taken)** feedback and
`<c>_song_queued_title` variable show which song is armed.

### Doing something extra when the current line is a song

Use **Rundown: take row (song-aware)** for the take itself. It fires the chosen part (intro / lyrics / outro) when the row is a song, and takes any other row normally. To run additional actions
only for songs, either add the **Rundown: cursor row is type → Song** feedback to the
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
3. Add a button bound to **Channel: take preview to program**; cue something to preview in the operator UI, then press the Companion button — confirm it promotes to program.
4. Add a button bound to **Hotcard: take** for a known hotcard; press it and confirm it appears on program.
5. Run **Show: load into Companion** with a show that contains both graphic and song rows; confirm `loaded_show_name` populates and `rundown_1_name` shows the first row's label.
6. Press **Cursor: move by N rows** (+1) then **Rundown: take row at cursor**; confirm the second row goes to program (a graphic via `take`, or a song via `song_take`).
7. With a song running, press **Song: next/previous slide**; confirm slide changes in the operator UI and renderer.
8. Press **Speech-to-text: start listening**; confirm `stt_running` variable becomes `yes` and the STT toggle button lights green.

## Spec

See `docs/superpowers/specs/2026-05-12-companion-integration-design.md`.
