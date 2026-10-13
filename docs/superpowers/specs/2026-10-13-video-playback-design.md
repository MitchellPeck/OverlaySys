# Video Playback (Media Slot) — Design

**Date:** 2026-10-13
**Status:** Draft — awaiting review

## Goal

Play a full-frame video with audio from the rundown — the motivating case is a
~5 minute giving video during offertory instead of a piano interlude. The
operator must be able to see playback progress/status and control it, the
audio must leave the render PC through a selectable output device (the aux
port), and the video clears itself when it ends.

### What the user asked for

- Overlay a video (giving video during offertory).
- Audio goes out through OverlaySys, to a **selectable audio output device**
  (aux port on the render PC).
- When the video ends it **clears automatically**.
- Operator can **see progress/status** and has **transport controls**.
- Approach A: a dedicated Video row kind with its own media slot *under*
  graphics, so a lower third (e.g. "Give at church.com/give") can sit on top.

### Assumptions (not stated, chosen as defaults — correct if wrong)

- Audio routing is a feature of the **Electron desktop channel windows**. OBS
  Browser Source keeps its own audio handling ("Control audio via OBS"); we
  don't try to pick devices there.
- One video per channel at a time. Taking a new video replaces the current one.
- No fade in/out of video picture or audio in v1 (hard cut in, hard cut out).
- No playlists, no looping background-video mode in v1 (template video layers
  already cover ambient loops).

### Success criteria

1. Operator adds a Video row, picks/uploads a video, hits Take → video plays
   full-frame on the program window with sound on the configured device.
2. A graphic taken on the same channel draws on top of the video; clearing the
   graphic leaves the video playing.
3. Operator sees status (loading / playing / paused / ended / error), elapsed,
   remaining, and a progress bar, updating at least ~4×/sec.
4. Play/Pause, Restart, Seek (scrub) and Stop (clear) work from the operator.
5. At the natural end the video is removed from the output with no operator
   action.
6. An alpha/matte mirror channel keys the video region correctly and produces
   no audio.

## Existing pieces we build on

- Asset upload + transcode to web-safe MP4/WebM: `server/src/assets.ts`,
  `server/src/transcode.ts`. Returns an absolute asset URL.
- Rundown rows are a `kind` discriminated union (`packages/core/src/show.ts`);
  shows sync to the cloud as JSON, so a new row kind needs **no migration**.
- Channel runtime state lives in `server/src/channels.ts`, broadcast to
  subscribers as `state` messages (`packages/ws-protocol`).
- Renderer page `apps/renderer/src/Renderer.tsx` (handles mirror + matte).
- Channel windows are Electron `BrowserWindow`s created in
  `apps/desktop/src/main.ts`; per-machine prefs (`ChannelWindowPrefs`,
  `packages/core/src/channelWindowPrefs.ts`) are edited via
  `ChannelWindowSettingsPopover.tsx`.

## Design

### 1. Data model (`packages/core`)

**`VideoRow`** added to the row union in `show.ts`:

```ts
export const VideoRowSchema = z.object({
  kind: z.literal("video"),
  id: z.string(),
  assetUrl: z.string(),
  label: z.string().optional(),         // display name, e.g. "Giving video – Oct"
  durationSec: z.number().optional(),   // display only; captured when the row is saved
  volume: z.number().min(0).max(1).default(1),
  endAction: z.enum(["clear", "hold"]).default("clear"),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  sourceRef: RowSourceRefSchema.optional(),
});
```

**`ChannelMedia`** added to `ChannelState` in `channel.ts` as an optional,
nullable `media` field, independent of `active`:

```ts
export const MediaPlaybackSchema = z.object({
  status: z.enum(["loading", "playing", "paused", "ended", "error"]),
  currentTime: z.number(),   // seconds
  duration: z.number(),      // seconds; 0 until metadata loads
  updatedAt: z.number(),     // epoch ms, server receive time
  error: z.string().optional(),
});

export const ChannelMediaSchema = z.object({
  rowId: z.string(),
  assetUrl: z.string(),
  label: z.string().optional(),
  volume: z.number(),
  endAction: z.enum(["clear", "hold"]),
  takenAt: z.number(),               // identity of this take
  // Declarative transport — renderers converge on this, so reconnects and
  // multiple renderers behave without replaying one-shot commands.
  paused: z.boolean(),
  seek: z.object({ time: z.number(), seq: z.number() }).optional(),
  playback: MediaPlaybackSchema,     // last reported, for late joiners
});
```

Transport is **declarative state, not one-shot commands**: `paused` is a flag;
seek/restart bump `seek.seq` with a target time. A renderer applies a seek
when it sees a `seq` it hasn't applied for this `takenAt`. A renderer that
reconnects mid-video gets the full picture from one `state` message.

### 2. Protocol (`packages/ws-protocol`)

Client → server:

| Message | Fields | Effect |
|---|---|---|
| `media_take` | `channel, rowId, assetUrl, label?, volume, endAction` | Replace `media` with a fresh take (`takenAt = now`, `paused=false`, playback `loading`). |
| `media_clear` | `channel` | `media = null`. |
| `media_control` | `channel, takenAt, action: "play"\|"pause"\|"restart"\|"seek", time?` | Update `paused` / bump `seek`. Ignored if `takenAt` ≠ current take. |
| `media_status` | `channel, takenAt, status, currentTime, duration, error?` | Sent by renderers. Updates `media.playback`. Ignored if stale `takenAt`. |

Server → client:

- Existing `state` message now carries `media`. Emitted on take, clear,
  control, and playback **status transitions** (not on every time tick).
- New `media_playback { channel, takenAt, playback }` broadcast for the
  ~4 Hz time ticks, so `state` subscribers (renderer template mounts,
  Companion) aren't re-rendered four times a second. Operators merge it into
  their cached channel state.

`PROTOCOL_VERSION` bumps.

### 3. Server (`server/src/channels.ts`, `server/src/ws.ts`)

- `mediaTake`, `mediaClear`, `mediaControl`, `mediaStatus` functions in
  `channels.ts`, next to `take`/`clear`. Graphic `take`/`clear`/`update`/
  `takePvwToPgm` leave `media` untouched.
- **End handling:** on `media_status` with `status: "ended"` for the current
  `takenAt`: if `endAction === "clear"` → `mediaClear(channel)`; if `"hold"` →
  keep it, set `paused: true`.
- **Multiple renderers per channel** (e.g. Electron window + OBS source):
  status from any renderer for the current `takenAt` is accepted; the server
  stores the latest. Renderers on mirror/matte channels don't report (see §4),
  so a mirror can't double-report or fire a second `ended`. A duplicate
  `ended` after clear is a no-op because `takenAt` no longer matches.
- **No renderer connected:** status stays `loading`. The operator UI shows
  "No renderer reporting" after 3 s without a status for the current take
  (§6), rather than the server guessing.
- `take_pvw_to_pgm` does **not** promote media in v1 (videos are taken
  straight to their channel; previewing a 5-minute video on a preview channel
  would double audio).

### 4. Renderer (`apps/renderer`)

New `MediaLayer` component (`apps/renderer/src/MediaLayer.tsx`), rendered by
`Renderer.tsx` **beneath** the template stage, full-frame (1920×1080 stage,
`object-fit: contain`, black letterbox only inside the video's box —
the rest of the page keeps the channel background).

- Mounts a `<video>` keyed by `takenAt`; unmounts on `media = null`
  (hard cut). On mount it starts at `playback.currentTime` when that is > 0
  (renderer reconnect / window reopen mid-video), otherwise at 0.
- Applies `volume`, `paused` (play()/pause()), and unseen `seek.seq`.
- Reports `media_status` on `loadedmetadata`, `playing`, `pause`, `ended`,
  `error`, `waiting`, and every 250 ms while playing.
- **Audio device:** reads `audioSinkLabel`/`audioSinkId` from the URL
  (passed by the desktop host, §5). Resolves the device via
  `navigator.mediaDevices.enumerateDevices()` (kind `audiooutput`): match by
  id, fall back to label (device ids are per-origin hashes and can differ
  between the operator and renderer origins in dev). Calls
  `video.setSinkId(id)` before playing. No sink param → system default
  output. Sink not found → plays on default and reports
  `error: "audio device '<label>' not found — using default"` alongside
  status `playing` so the operator sees it.
- **Mirror / matte channels:** render the video muted (`muted`, volume 0) so
  the alpha channel keys the video rectangle (matte filter already turns
  content white), and **do not send `media_status`**. Only the channel that
  owns the state reports and plays audio.
- Any other unmuted autoplay failure (browser policy outside Electron) is
  reported as `status: "error", error: "autoplay blocked"`.

### 5. Desktop host (`apps/desktop`, `packages/core/channelWindowPrefs.ts`)

- `ChannelWindowPrefsSchema` gains optional `audioOutput: { deviceId, label }`.
  Per-machine, like display, so it never syncs across rigs.
- `rendererChannelUrl(channelId)` appends `audioSinkId` / `audioSinkLabel`
  when set.
- Channel `BrowserWindow`s get
  `webPreferences.autoplayPolicy: "no-user-gesture-required"` so unmuted
  video can autoplay.
- Session permission handlers allow `speaker-selection` and the media
  permission needed for `enumerateDevices()` to return labels, scoped to the
  operator/renderer origins.
- Changing the audio device in the popover reopens the channel window
  (existing `reopen-channel-on-configured-display` path) so the new URL takes
  effect. Doing this mid-video restarts the window; the renderer rejoins and
  resumes from the server's `playback.currentTime` via a seek — the restart
  costs about a second of audio, which is acceptable for a config change.
- `ChannelWindowSettingsPopover` gets an **Audio output** dropdown populated
  from `enumerateDevices()` in the operator window (same machine), plus
  "System default". If the saved device is missing it's shown as
  "<label> (not connected)", the same way displays are handled today.

### 6. Operator UI (`apps/operator`)

- **Adding a video row:** "Add video" in the show editor
  (`shows/edit/page.tsx`) opens a small modal: upload or pick an existing
  video asset (reuses `VideoInput` from `editor-kit`), label, channel
  (default `program`), volume, end action (default "Clear when finished").
- **Rundown row** (`Rundown.tsx`): film icon, label, duration once known
  (read from the asset's `<video>` metadata when the modal saves the row and
  stored on the row as optional `durationSec` for display only).
- **Take:** `takeSelected()` sends `media_take` for video rows. Cue is a
  no-op for video rows (same as scripture).
- **`MediaTransportStrip`** (new component, shown in `TakePanel` whenever any
  channel has `media`, regardless of which row is selected so the operator
  can always reach Stop):
  - Label, channel name, status badge (Loading / Playing / Paused / Ended /
    Error / No renderer reporting).
  - Progress bar (click/drag to seek), elapsed `m:ss`, **remaining `-m:ss`**
    (largest text — it's what the operator watches to cue the next element).
  - Buttons: Play/Pause, Restart, Stop (sends `media_clear`).
  - Error text inline (e.g. the audio-device fallback warning).
  - Time between server ticks is interpolated client-side from
    `playback.updatedAt` while `status === "playing"` so the bar moves
    smoothly.
- **ChannelPreview** shows a muted, poster-style indicator for media
  ("▶ Giving video – 3:12 left") rather than mounting a second video, so the
  operator machine never plays audio.

### 7. Out of scope (v1)

- Companion/Stream Deck actions and feedbacks for media (natural follow-up:
  play/pause/stop actions, remaining-time variable).
- Fades, playlists, looping mode, preview→program promotion of media.
- Audio device selection for OBS Browser Source outputs.
- Planning Center import creating video rows.

## Error handling summary

| Situation | Behavior |
|---|---|
| Asset URL 404 / decode error | Renderer reports `error`; strip shows it; media stays until Stop. |
| Audio device missing | Plays on default output; warning shown in strip. |
| Renderer disconnects mid-video | Server keeps `media`; strip shows "No renderer reporting" after 3 s; on reconnect renderer seeks to last reported time. |
| Stale status/control (old `takenAt`) | Ignored by server. |
| Operator takes a new video while one plays | Replaces it (new `takenAt`). |

## Testing

- **core:** schema tests for `VideoRow` (defaults, union parsing alongside
  legacy rows) and `ChannelMedia`.
- **ws-protocol:** schema tests for the four new client messages and
  `media_playback`.
- **server (`channels`):** take → state has media and preserves `active`;
  graphic take/clear preserve media; control with stale `takenAt` ignored;
  `ended` + `clear` → media null; `ended` + `hold` → paused; duplicate
  `ended` after re-take doesn't clear the new take; status ticks broadcast
  `media_playback` without emitting `state`.
- **renderer:** unit-test the pure pieces — sink resolution (id match, label
  fallback, missing) and seek-seq application logic — extracted into
  `mediaSync.ts` like `mirrorSubscription.ts`.
- **desktop:** `rendererChannelUrl` includes sink params; prefs schema
  round-trip with/without `audioOutput`.
- **Manual:** on the render PC, select the aux device, take the giving
  video, confirm audio on aux, overlay a lower third, scrub, pause, let it
  run to the end and confirm auto-clear; confirm the alpha window keys and is
  silent.
