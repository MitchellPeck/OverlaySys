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

### 2. Capture pipeline (server)

New module `server/src/sttChannelCapture.ts`, started by `sttSpawner` when
`captureMode === "channels"` (default mode keeps the current
`whisper-stream | lyric-listener` pipeline verbatim).

1. **whisper-server**: spawn
   `whisper-server -m <model> --host 127.0.0.1 --port <free port> -nt`.
   State stays `starting` until an HTTP probe of the port succeeds.
2. **ffmpeg**: spawn the bundled ffmpeg capturing the device by name, using
   `pan` to keep only the picked channels as K separate channels
   (`pan=<K>c|c0=c<a-1>|c1=c<b-1>...`), resampled to 16 kHz, raw `s16le` on
   stdout.
3. **Mix + window**: the server de-interleaves the K channels, averages them
   to mono into a ring buffer, and computes per-channel peak levels.
   Every `stepMs` it takes the last `lengthMs` of mono audio (or less, early
   in a window), wraps it as a WAV in memory, and POSTs it to
   `/inference`. Each result is a **partial**; once a full `lengthMs` window
   has elapsed the result is **final** and a new window starts keeping the
   last ~200 ms (mirrors `whisper-stream`'s step/length/keep behaviour).
   If the previous request is still in flight, the step is skipped (never
   queued).
4. **Hypotheses**: non-empty text is fed straight into the same path the WS
   `stt_hypothesis` handler uses (`sttListener.markHypothesisReceived` +
   `songSession.processSttHypothesis` for every channel with a session),
   with `isFinal` from step 3. No lyric-listener process in this mode.
5. **Listener**: registers as one listener, `audioSourceId`
   `channels-<device>`, label `<device> ch <list>`, so the song header shows
   STT × 1. Marked offline on stop.
6. **Levels**: new server message `stt_levels { levels: number[] }` (0–1
   peak per picked channel, in pick order) broadcast at ~10 Hz while
   running.
7. **Device list**: `stt_capture_devices` gains
   `inputDevices: { name: string; channels: number }[]` from
   `system_profiler SPAudioDataType -json`, served by the existing
   `stt_enumerate_capture_devices` request and cache.
8. **Lifecycle**: both children's stderr go to the spawner log prefixed
   `[whisper]` / `[ffmpeg]`. Stop terminates both. If either exits
   unexpectedly, the other is stopped and state becomes `error`.

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
