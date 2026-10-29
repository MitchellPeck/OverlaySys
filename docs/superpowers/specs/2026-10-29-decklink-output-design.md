# Blackmagic (DeckLink) output for channels — design

Date: 2026-10-29. Status: draft for approval.

## Why

The stage monitor TV at GRMC is dark today. The Mac mini that runs OverlaySys
already has a Blackmagic **UltraStudio Express Monitor 3G** connected and
configured, cabled UltraStudio → SDI → SDI-to-HDMI converter → TV. The owner
wants the stage channel on that TV now, and the same ability for every
channel later: graphics to a TV, and graphics to a switcher as a fill + key
pair (two UltraStudios, one per signal).

Today a channel can only be shown as an Electron window on a computer
display. This adds a second kind of destination: a Blackmagic output device.

## Goals

- Any channel (`graphics` or `stage`, mirrors included) can be sent to a
  Blackmagic output device instead of a screen, from the same per-channel
  window settings that pick a screen today.
- First target, and the only thing that must pass this time: the stage
  channel (confidence monitor) on the UltraStudio Express Monitor 3G.
- The signal never drops while the app runs: no black flash or TV re-sync
  between takes, layouts or slides.
- Nothing in the design blocks fill + key later: a fill channel and its
  `matte` mirror (which already exist: `renderMode: "matte"`, `mirrorOf`)
  assigned to two devices. **Fill + key is not part of this build's
  acceptance** (owner: "just conf mon"), and no second device is on hand.
- The device is just another output: the operator sees it in Outputs status
  like a window, and audio stays on the existing per-channel audio output
  picker.
- Clear, plain-language errors when the device is missing, held by another
  program, refuses the signal format, or the ffmpeg isn't installed.

## Non-goals

- Bundling ffmpeg or the Blackmagic SDK in the app (licence: DeckLink-enabled
  ffmpeg is non-free).
- Capture/input from Blackmagic devices.
- Genlock / reference sync between devices (the Express Monitor 3G has no
  reference input).
- Driving the device from the cloud/web build; this is desktop-only.
- Non-Blackmagic SDI/NDI outputs (NDI may reuse the frame pipeline later; not
  in scope).

## Anti-goals (would make this a failure even if it "works")

- Taking the card away from another program. Narthex TV's `playout.py` will
  later run on the same Mac mini with its own UltraStudio; OverlaySys must
  only ever open the device it was assigned, by name.
- Leaving the card held after the app quits (every later open then fails
  with "Could not enable video output!").
- A silently frozen picture: a stuck card must be detected and restarted,
  not left on one frame.
- Showing an operator a raw ffmpeg error string as the only explanation.

## Prior art (must read before building)

`~/WebstormProjects/GRMCApps/scripts/narthex-tv/README.md`, `playout.py` and
`build-ffmpeg-decklink.sh` already drive this exact device model on Desktop
Video 16.x. Hard-won facts from there that bind this design:

- One long-lived ffmpeg owns the card and reads raw frames from a pipe; it
  must never see end-of-input, or the device closes and the signal drops.
- Output codec **`v210`** (`wrapped_avframe` is accepted but gives solid red).
- No `-format_code` in an output-only build; the mode is chosen by the raw
  stream's size and rate. NTSC rates must be written as fractions
  (`60000/1001`), never `59.94`.
- Default mode **1080p59.94** — the one every TV locks to; 1080p30 is not safe.
- Bytes go to the pipe in exact frame-sized units, or the picture tears.
- A write that blocks forever = stuck card: bound it (stall timeout, any
  progress resets it) and restart the output.
- Always release the card on exit; a wedged ffmpeg can need several SIGTERMs.
- No audio stream is required by the muxer (`-an` works).
- The ffmpeg must be built from FFmpeg `master` against an SDK that matches
  the installed driver — that is what `build-ffmpeg-decklink.sh` does.

## What the owner decided

- The UltraStudio is on the same Mac mini as the OverlaySys desktop app.
- Downstream is either a TV or a switcher; for a switcher, two devices carry
  fill and key.
- Audio output stays configurable per channel; the UltraStudio is "just
  another output option" alongside the Mac's sound devices.
- The proposed behaviour below (settings location, shared ffmpeg, always-on
  signal, status/errors) was approved in conversation ("looks good").

## How it behaves

### Settings (per machine, never synced)

In the operator's per-channel window settings
(`ChannelWindowSettingsPopover`, backed by `ChannelWindowPrefs` in
`packages/core/src/channelWindowPrefs.ts`), the screen choice becomes
**Output**: any connected display, or any Blackmagic output device the
desktop app finds. Choosing a Blackmagic device:

- hides the window-only options (fullscreen, frameless, always on top,
  transparent) and shows **Signal format**, default `1080p59.94`, with at
  least `1080p59.94`, `1080i59.94`, `1080p29.97`, `1080p30`, `720p59.94`;
- keeps **Open at launch** and **Audio output**.

These prefs live in `channel-window-prefs.json` like today, so a device
assignment never leaks to another rig through sync.

A desktop-wide setting **Blackmagic ffmpeg path** defaults to
`~/.local/bin/ffmpeg-decklink` (what Narthex TV's build script installs), with
a **Check** button that reports the ffmpeg version, whether it has the
DeckLink output, and the devices it sees (`-sinks decklink`).

### Running

- Opening a channel assigned to a device (by hand, or at launch with Open at
  launch) starts that output; nothing appears on the Mac's screens.
- While running, the card is held continuously. When the channel shows
  nothing, the device outputs the channel's background composited over black
  (stage: its layout; graphics: black where transparent).
- Closing the output, changing its device/format, or quitting the app
  releases the card, always — including on crash paths the desktop already
  handles for the server process.
- A stalled card is restarted automatically and logged; repeated stalls
  surface to the operator.

### Status and errors

- The output registers with the server the same way a renderer window does
  (`subscribe` with a `label`, e.g. "UltraStudio Express Monitor 3G"), so
  **Outputs** status counts it and shows it connected/offline.
- Plain-language errors, shown where the operator opened it and in Outputs:
  ffmpeg not found / lacks DeckLink; device not found; device busy (held by
  another program — likely Narthex TV or a leftover ffmpeg); signal format
  refused by the device; output stalled and restarting.

### Audio

Unchanged mechanism: the channel's page plays media audio through the
per-channel **Audio output** picker (`setSinkId`). If the Blackmagic driver
exposes the UltraStudio as a macOS sound output, it appears in that list
and embedded SDI audio works with no further code. **This is unverified** —
see "Must be settled on the hardware". If the driver does not expose it,
embedding audio becomes a follow-up project (capture the page's audio and
mux it into the same ffmpeg), not part of this one.

## Shape of the build (builder's call; noted so the reviewer can check)

- The desktop app renders a device-assigned channel in an **offscreen**
  Electron `BrowserWindow` (`webPreferences.offscreen`) loading the same
  renderer URL a window would, at the signal format's pixel size.
- A frame pump in the main process keeps the latest painted frame and writes
  it to the long-lived ffmpeg at the format's exact rate (offscreen `paint`
  only fires on change, so frames are repeated); alpha is composited over
  black; the card's blocking write paces the pump.
- ffmpeg reads `rawvideo` BGRA from stdin and outputs `v210` to
  `-f decklink "<device name>"`, rate as a fraction.
- One supervisor per device output, modelled on the server-process supervisor
  the desktop already has (`supervisor.ts`): start, stall detection, restart
  with backoff, guaranteed kill on quit.
- Device discovery: run `<ffmpeg> -hide_banner -sinks decklink` and parse
  names. Only one unit is attached now, so a device is chosen by name.
  **Deferred, owner's call:** Narthex TV will later use a second unit of the
  *same model* on this Mac mini, so two identical names will appear. Solving
  that (serial, persistent id or Desktop Video label) is not part of this
  build, but the saved device reference must be an object
  (`{ name }` now) so a distinguishing field can be added without migrating
  prefs, and the app must refuse to guess when two devices share the
  assigned name.

## Risks

- **Throughput.** 1080p59.94 BGRA is ~500 MB/s through paint → copy → pipe
  on a Mac mini, about twice what Narthex TV pushes. Measure early; if it
  can't keep up, 1080i59.94 halves it (Narthex TV's documented fallback).
- **Fill/key alignment (future).** Two independent devices with no reference
  input can drift by a frame; a transition may show a thin edge on the
  switcher. To be tested when fill + key is taken up.
- **Offscreen rendering differences.** Video playback, fonts and animation
  timing in offscreen mode must match the on-screen renderer.

## Calls made by the designer (not the owner)

- **Signal formats offered.** Only formats proven on the hardware are listed.
  `1080p59.94` is required; the rest of the list is offered only if the
  output build can actually select it. 1080i59.94 and 1080p29.97 send
  identical raw streams (1920x1080 at 30000/1001), so without a working
  `-format_code` on the output-only build they cannot be told apart. Narthex
  TV's README is inconsistent on this (it says `-format_code` is absent, and
  also suggests `--format-code Hi5994`; it says `wrapped_avframe` in one
  place and `v210` in another, and `playout.py` uses `v210`). Verify on the
  Mac mini; 1080i is not a must-have for the stage TV.
- **If 1080p59.94 can't be sustained**, keep the 59.94 signal (what the TV
  locks to) and lower the *render* rate: the offscreen window paints at
  29.97 and every frame is sent twice. For a stage monitor this is
  invisible. Format changes and GPU readback/colour conversion are later
  optimisations, not part of this build.

## Must be settled on the hardware (Mac mini), before or early in the build

1. Is `~/.local/bin/ffmpeg-decklink` built on the Mac mini, and does
   `-sinks decklink` list the UltraStudio? If not, build it with Narthex TV's
   `build-ffmpeg-decklink.sh` against the SDK matching the installed driver.
2. Does the UltraStudio appear as a macOS sound output while ffmpeg holds the
   video side? (Decides whether audio is free.)
3. Can the Mac mini sustain 1080p59.94 from an offscreen window?
4. Does the TV (through the SDI-to-HDMI converter) lock to the chosen format?

The owner tests on the Mac mini; the builder cannot reach that machine, so
each hardware step needs a short, copy-pasteable test procedure.

## Left to the builder

File layout, IPC names, how the popover is restructured, parsing details,
supervisor backoff numbers, log wording — following the existing desktop
patterns (`windowPrefs.ts`, `supervisor.ts`, `diagnostics.ts`).
