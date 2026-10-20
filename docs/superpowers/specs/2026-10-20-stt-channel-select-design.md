# STT channel select — design

Date: 2026-10-20
Status: approved in conversation, pending written-spec review

## Problem

On the desktop app, STT shows a connected listener (STT × 1) but never
transcribes, and trust mode never advances. The operator's input is a
32-channel interface. `whisper-stream` opens its SDL capture device with a
hard requirement of one mono channel and has no way to choose *which*
channel, so it effectively hears channel 1. When the vocals live on other
channels, whisper hears silence.

The operator needs to pick 1–4 channels of a multichannel input and feed
that mix to STT.

## Goals

- Pick an input device by name and 1–4 of its channels; the picked channels
  are averaged to mono and transcribed.
- Same downstream behaviour as today: hypotheses feed the existing matcher,
  trust mode, and the song-mode transcript strip unchanged.
- Visible proof that audio is arriving: a per-channel level meter.
- Existing setups are untouched (default mode keeps using `whisper-stream`).

## Non-goals

Windows/Linux channel select, more than 4 channels, per-channel gain,
changing the default `whisper-stream` mode.

## Background (verified 2026-10-20)

- `ffmpeg-static` (already a server dependency) has the `avfoundation`
  input, opens a device by name (`-f avfoundation -i ":<name>"`), and can
  pick channels with the `pan` filter.
- `whisper-server` ships in the same Homebrew `whisper-cpp` formula the
  installer already uses. With `base.en`, a POST of a 4 s 16 kHz WAV to
  `/inference` (`response_format=json`) returns `{"text": "..."}` in
  ~60–90 ms on an M-series Mac.
- `system_profiler SPAudioDataType -json` lists audio devices with their
  input channel counts.

## Design

### 1. Config and UI

`SttSpawnerConfig` (`packages/core/src/sttSpawnerConfig.ts`) gains optional
fields; configs without them load as `captureMode: "default"`:

| Field | Type | Meaning |
|---|---|---|
| `captureMode` | `"default" \| "channels"` | default = today's `whisper-stream` |
| `channelDevice` | `string` | input device name (stable across reorders) |
| `channels` | `number[]`, 1–4 items, each ≥ 1, unique | 1-based channel numbers |

`customCommand` still wins over both modes when non-empty.

Settings → STT (`apps/operator/src/app/settings/stt/page.tsx`), macOS only
(hidden elsewhere):

- **Capture mode** control: Default / Channel select.
- In Channel select:
  - **Input device** dropdown listing devices by name with channel count,
    e.g. "Dante Virtual Soundcard — 32 ch".
  - **Channels**: numbered toggle buttons 1…N for the chosen device; at most
    4 may be on; at least 1 required to save.
  - **Level meter**: one bar per picked channel, live while STT runs.
- Model, step and length controls are shared by both modes.

### 2. Capture pipeline

Implementation note (refined after reading the spawner): rather than a second
lifecycle inside the server, channel mode is a **capture script** run by the
existing spawner, so process-group kill, orphan reaping, stderr logs,
readiness and the lyric-listener path are all reused unchanged.

`apps/lyric-listener/src/channels.mjs` (pure helpers in
`apps/lyric-listener/src/channelLib.mjs`):

1. Checks the device exists (ffmpeg `-list_devices`); if not, prints
   `@@error Input device '<name>' not found` to stderr and exits 1.
2. Spawns `whisper-server -m <model> --host 127.0.0.1 --port <free port> -nt
   --inference-path /overlaysys-inference` (the distinctive path lets boot-time
   orphan reaping find it) and waits until it answers HTTP.
3. Spawns the bundled ffmpeg capturing the device by name with
   `pan=<K>c|c0=c<a-1>|...` to keep only the picked channels, 16 kHz,
   raw `s16le` on stdout.
4. De-interleaves the K channels, averages to mono into a ring buffer, and
   every ~100 ms prints `@@levels <l1> <l2> ...` (0–1 peaks) to stderr.
5. Every `stepMs` POSTs the last `lengthMs` (WAV) to whisper-server. Results
   are written to stdout in whisper-stream's convention: `text\r` for a
   partial, `text\n` for the final at the end of each `lengthMs` window
   (new window keeps the last 200 ms). A step is skipped while a request is in
   flight.
6. Prints `[start speaking]` once whisper-server is ready and audio flows
   (the spawner's existing readiness marker).

Spawner (`server/src/sttSpawner.ts`) in channel mode runs
`<node> channels.mjs --ffmpeg <path> --model <m> --device <name> --channels
17,18 --step <ms> --length <ms> | <node> stdin.mjs`. It intercepts stderr lines
starting `@@levels` (not logged; forwarded as `stt_levels { levels, channels }`
only to clients that sent `stt_levels_subscribe { on: true }` — the settings
page — so Companion and renderers never receive them) and `@@error` (used as `lastError`). Boot-time reaping also kills
`channels.mjs` and `overlaysys-inference` processes.

Device list: `stt_capture_devices` gains
`inputDevices: { name: string; channels: number }[]` from
`system_profiler SPAudioDataType -json` (macOS), served by the existing
`stt_enumerate_capture_devices` request and cache.

### 3. Errors

| Condition | Behaviour |
|---|---|
| Device name not present at start | refuse; state `error`, "Input device '<name>' not found" |
| Picked channel > device channel count | blocked in the form; also rejected at start with an error |
| `whisper-server` or model missing | surfaced by presence checks (presence also checks `whisper-server` when channel mode is selected) |
| ffmpeg can't open the device | log ffmpeg's stderr; state `error`, "Couldn't open <device>. Check Microphone permission in System Settings." |
| Silent channels | meter stays flat; strip shows "STT listening — nothing heard yet" |
| `/inference` error or timeout | skip that step; log at most once per 10 s per error kind; 10 consecutive failures → state `error` |

## Testing

Unit (vitest, pure functions):
- `pan` filter string from a channel list.
- De-interleave + mono mix + per-channel peak.
- Window scheduler: partial/final sequence, 200 ms keep, in-flight skip.
- WAV header encoding.
- `system_profiler` JSON → `{ name, channels }[]` (fixture).
- Config schema: defaults, 1–4 channels, unique, ≥ 1, back-compat.

Pipeline (vitest with fake child processes / fake HTTP):
- hypotheses reach `songSession.processSttHypothesis` with correct
  `isFinal`;
- a crash in either child stops the other and sets `error`;
- device-not-found refusal.

Smoke script `server/scripts/stt-channels-smoke.mjs` (needs `whisper-server`
installed): runs the real pipeline for a few seconds against a named device
and channel list and prints hypotheses and levels.

---

# Part B — Taking a song intro queues the song

## Problem

A Stream Deck button takes a song's intro, then a page of section buttons
("Verse 1", "Chorus") sends `song_jump_kind` / `song_jump` / `song_advance`.
Those only act on a live song session, and an intro take starts none, so the
presses do nothing.

## Design

- `take_song_sub` with `sub: "intro"` (after taking the intro graphic as
  today) **queues** the song on the resolved channel: song, lyric template,
  arrangement, trust mode, row id.
- With no live session but a queued song on the channel:
  - `song_jump_kind` → start the session at that section;
  - `song_jump` → start at that section/slide;
  - `song_advance` with delta > 0 → start at the first slide.
  The session starts directly at the target (no slide-1 flash); lyrics replace
  the intro like a lyrics take does.
  - `song_blank` / `song_end` → just cancel the queue.
- The queue clears when: the session starts; any other external take or an
  operator clear on that channel (an intro's own auto-out does **not** clear
  it); the outro is taken; another song's intro queues instead.
- `ChannelState` gains optional `queuedSong: { songId, songRowId, title }`.
- Companion: feedback **Song queued** (channel) and variable
  `<channel>_song_queued_title`.

## Testing

Server: queue on intro; start-on-jump for each command (correct cursor,
single take); cancel cases; auto-out keeps the queue. Companion: feedback and
variable.
