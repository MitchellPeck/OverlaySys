# STT channel select + queued song intro — implementation plan

Spec: docs/superpowers/specs/2026-10-20-stt-channel-select-design.md
Execution: native (user asked to implement directly). TDD per task.

## Part B — queued song (first; smaller)
1. core: `ChannelState.queuedSong` optional schema.
2. server/songSession: `queue`, `getQueued`, `clearQueued`; `start` takes an
   optional initial cursor and clears the queue; `jump`/`jumpByKindOrdinal`/
   `advance` start from the queue when no session; `blank`/`end` cancel it.
   channels: `setQueuedSong`; external `take`/`clear` clear it; auto-out keeps
   it. ws `take_song_sub` intro queues. Tests in songSession tests.
3. companion: `song_queued` feedback, `<c>_song_queued_title` variable, HELP.

## Part A — channel select
4. core: config `captureMode`/`channelDevice`/`channels` (+ validation tests);
   `SttInputDevice`; ws-protocol `stt_capture_devices.inputDevices` (optional)
   and `stt_levels`.
5. lyric-listener: `channelLib.mjs` pure helpers + tests (pan filter, mix +
   peaks, window scheduler, WAV, arg parsing); `channels.mjs` runner.
6. server: `parseSystemProfilerAudio` (+ fixture test); enumeration returns
   inputDevices; presence checks whisper-server; spawner channel-mode command,
   `@@levels`/`@@error` handling, `stt_levels` broadcast, reaping.
7. operator: store `sttLevels`/`sttInputDevices`; useWs; Settings → STT mode,
   device, channel toggles, meter, command preview.
8. Smoke script `server/scripts/stt-channels-smoke.mjs`; full test + typecheck.
