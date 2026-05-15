# Channel auto-open + display assignment

Status: design approved — pending implementation plan
Date: 2026-05-14

## Problem

Channel renderer windows are opened on demand by clicking ↗ in
`ChannelStatus`. They always land on the default display, never enter
fullscreen, and require manual re-opening every launch. For a fixed
broadcast rig — operator on the built-in display, program output on a
second monitor, preview on a third — the operator does the same
half-dozen window-management clicks every time they start the app, and
mis-clicks land outputs on the wrong screen mid-show.

Today's channel config (`data/channels/<id>.json`) describes only the
*identity* of a channel (id, name, render mode, mirror source,
background). Where its window should *live* is undefined.

The desktop README already flags this as the known gap:

> Multi-monitor display picker UX in the operator — IPC supports it
> (`fullscreen`, future: `displayId`) but no UI yet.

## Goals

1. Each channel can be pinned to a specific display and window mode
   (fullscreen, frameless, always-on-top, transparent).
2. Channels marked `autoOpen` open automatically when the app launches,
   on the configured display, in the configured mode.
3. The operator can reopen a channel window on its configured display
   without recreating the configuration each time.
4. Display assignment survives reboot even when the OS hands out
   different `Display.id` values for the same physical monitor.
5. Display assignment does not leak into shared project state — running
   the same project on a different rig must not try to open windows on
   the previous rig's screens.

## Non-goals

- Hot-plug auto-rebinding while the app is running (v1 requires a
  manual "Reopen on configured display" click after re-plug).
- Named multi-layout profiles ("Sanctuary," "Greenroom"). Out of
  scope; the storage shape is compatible with adding this later.
- Web/non-Electron auto-open. The feature only renders in Electron.

## Approach

Per-machine preferences in a local-only file under `userData/`, separate
from the syncable `data/channels/` directory. The Electron main process
owns the file; the operator reads and writes through new IPC handlers.

### Storage — `userData/data/channel-window-prefs.json`

```jsonc
{
  "version": 1,
  "displays": [
    {
      "id": 69733632,
      "label": "DELL U2718Q",
      "bounds": { "x": 1512, "y": 0, "width": 3840, "height": 2160 },
      "internal": false
    }
  ],
  "channels": {
    "program": {
      "autoOpen": true,
      "displayId": 69733632,
      "fullscreen": true,
      "frameless": false,
      "alwaysOnTop": false,
      "transparent": false
    }
  }
}
```

- `version` lets future migrations branch without breaking the loader.
- `displays[]` is a cache of the last-seen display set, written every
  time we successfully resolve a channel to a display. Used as input
  to the matching algorithm (below) so labels and bounds remain
  available even when the OS rotates `Display.id` values.
- `channels[<channelId>]` holds the per-channel prefs. Absence means
  "no auto-open, no configured display" — the existing manual-click
  behavior is preserved unchanged for unconfigured channels.

### Display matching

`screen.getAllDisplays()` on Electron exposes `id`, `label`, `bounds`,
`internal`, plus other fields. None of those are individually stable
across reboot or sleep/wake on macOS or Windows, but the combination
is reliable on a fixed rig. When opening a configured channel, the
main process resolves the target display in this order:

1. Exact `id` match.
2. Same `label`.
3. Same `bounds.width × height` + same `internal` flag. If
   multiple displays tie, pick the first one returned by
   `screen.getAllDisplays()` (stable per session).
4. Fallback: `screen.getPrimaryDisplay()`, with a non-blocking
   signal back to the operator UI.

Every successful non-fallback match overwrites the cached entry in
`displays[]` so the next launch is a clean id hit.

### Main-process changes (`apps/desktop/src/main.ts`)

- New module `apps/desktop/src/windowPrefs.ts`:
  - `loadPrefs(): Prefs` — read JSON, validate with Zod (mirroring
    the `channelConfig.ts` pattern), return defaults if absent.
  - `savePrefs(prefs: Prefs): void`.
  - `resolveDisplay(channelPrefs, currentDisplays):
    { display, matchedBy }` — implements the algorithm above.
  - `fingerprintDisplay(display): CachedDisplay` — extract the four
    fields we care about.
- Extend `ChannelWindowOptions` with `displayId?: number`.
- `createChannelWindow` consumes `displayId`: if present, look up the
  display and set `x` / `y` to `display.bounds.x` / `display.bounds.y`
  in the `BrowserWindow` constructor — before any fullscreen call.
  Electron's fullscreen always honors the screen the window is
  currently on, so position must be set first.
- After `boot()` brings the operator window up, iterate
  `prefs.channels` and call the existing `createChannelWindow` path
  for every channel with `autoOpen: true`, passing the resolved
  `displayId` plus mode flags.
- IPC additions (registered in `registerIpc()`):
  - `overlaysys:get-displays` → returns the current
    `screen.getAllDisplays()` projection (the four-field fingerprint
    plus `id` for the operator's dropdown).
  - `overlaysys:get-channel-window-prefs` → returns the full prefs
    object so the operator UI can render initial state.
  - `overlaysys:set-channel-window-prefs(channelId, prefs)` →
    merge-and-persist; returns the new prefs.
  - `overlaysys:identify-displays` → flash a large number on each
    display for ~2 seconds via overlay `BrowserWindow` per display.

### Operator UI changes

Two surfaces, both inside Electron only.

#### Per-channel settings popover

A small ⚙ icon next to ↗ in `ChannelStatus.tsx`. Clicking opens a
popover with:

- `Auto-open at launch` — boolean.
- `Display` — dropdown of currently-attached displays plus a "(none)"
  option. If the configured display is currently missing, render its
  cached label italicized at the top of the list with a "⚠ not
  attached" suffix.
- `Identify displays` — calls the IPC; flashes numbers on screens.
- `Fullscreen`, `Frameless`, `Always on top`, `Transparent` — booleans.
- Save / cancel buttons.

The popover's state mirrors the prefs file via the new IPC. Saving
writes through `set-channel-window-prefs`.

#### Reopen behavior

The existing ↗ button currently calls `openChannelWindow(channelId)`
with no options and reuses any existing window for that channel via
`focus()`. After this change:

- If the channel has prefs, ↗ passes them through (`displayId`,
  `fullscreen`, etc.) on first open.
- A new `Reopen on configured display` item appears in a small
  context menu / dropdown attached to the ↗ button when the channel
  has prefs. Clicking it always closes any existing window for the
  channel and recreates it on the configured display in the
  configured mode — including the case where it's already on the
  right display (acts as a refresh). Electron's `setBounds` +
  repeated fullscreen toggling is flaky across platforms; recreating
  the window is the predictable path.

If the configured display fell back at launch, render a yellow ⚠ on
the channel card with a tooltip naming both the configured display
(by cached label) and the fallback in use.

## Data flow

```
[Electron boot]
   │
   ├── loadPrefs()                    (windowPrefs.ts)
   ├── createOperatorWindow()         (existing)
   └── for each channel with autoOpen:
         resolveDisplay() ─────────► savePrefs() updates cache
         createChannelWindow({ displayId, fullscreen, ... })

[Operator UI — ⚙ click]
   │
   ├── invoke get-displays            (current attached set)
   ├── invoke get-channel-window-prefs (existing prefs)
   ├── user edits + saves
   └── invoke set-channel-window-prefs(channelId, prefs)
         │
         └── main updates JSON, returns new prefs

[Operator UI — ↗ click on a configured channel]
   │
   └── invoke open-channel-window(id, { displayId, fullscreen, ... })
         │
         └── main resolveDisplay() + createChannelWindow()
```

## Testing

- Unit (vitest) in `apps/desktop/src/windowPrefs.test.ts`:
  - `resolveDisplay`: id hit, label hit, bounds hit, fallback —
    drive with hand-built `Display`-shaped fixtures.
  - `loadPrefs` / `savePrefs` round-trip including the version field.
  - Schema rejects bad shapes (extra fields tolerated, wrong types
    rejected).
- Integration: manual — open the app on a multi-monitor machine,
  configure program → display 2 + fullscreen, quit, relaunch.
  Confirm program window appears on display 2 fullscreen.
  Unplug display 2 between launches, relaunch, confirm fallback to
  primary with the warning surfaced.

## Risks

- Cached `displays[]` could grow unbounded over time as monitors come
  and go. Mitigation: cap the cache at the union of "currently
  attached" + "any display id referenced by any channel pref" on
  every save; drop the rest.
- Electron's `BrowserWindow({ x, y, fullscreen: true })` combined
  with `simpleFullscreen: true` on macOS has an existing workaround
  in `createChannelWindow` (the `enter-full-screen` listener that
  bounces back to simple fullscreen). The position-before-fullscreen
  ordering must be preserved; the workaround should still apply.
- Two operator instances writing prefs at once would race. Out of
  scope — only one operator window exists per app process.

## Open questions

None blocking. Possible follow-ups:

- Display hot-plug `screen.on('display-added')` auto-rebind.
- Named multi-layout profiles for traveling rigs.
- A "save current window layout" button that infers prefs from the
  current set of open channel windows.
