# Blackmagic (DeckLink) Channel Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop app send any channel to a Blackmagic output device (first target: the stage channel on an UltraStudio Express Monitor 3G), configured per machine next to the existing display choice.

**Architecture:** A device-assigned channel renders in an offscreen Electron `BrowserWindow` (opaque, black-backed, at the signal format's size). A `DeckLinkOutput` in the main process keeps the latest painted frame and writes it, one whole frame per write, into one long-lived `ffmpeg-decklink` process that owns the card (BGRA in, `v210` out). The card's back-pressure paces the writes; a 5 s stall watchdog restarts a stuck card; quitting always kills ffmpeg. Pure logic (args, parsing, error mapping, pump/watchdog) lives in electron-free modules so it is unit-tested.

**Tech Stack:** Electron 33 (offscreen rendering, `paint` event, `NativeImage.toBitmap()`), Node `child_process`, zod (prefs schema in `@overlaysys/core`), React (operator), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-decklink-output-design.md` — read it, and `~/WebstormProjects/GRMCApps/scripts/narthex-tv/README.md` + `playout.py` (`outer_command`, `write_frame`, `rate_arg`), before Task 3.

## Global Constraints

- Desktop only; nothing in the web/cloud build or the server changes behaviour.
- Never bundle ffmpeg or the Blackmagic SDK. Default ffmpeg path `~/.local/bin/ffmpeg-decklink`; `~` expands to the user's home.
- ffmpeg output: `-f rawvideo -pix_fmt bgra -s <W>x<H> -r <rate> -i pipe:0 -an -c:v v210 -f decklink <device name>`. No `-pix_fmt` on the output, no `-format_code`, no shell (argv array only).
- Rates as fractions: 59.94 → `60000/1001`, 29.97 → `30000/1001`.
- Signal formats shipped: only `1080p59.94` (1920×1080 @ `60000/1001`), the default. Others are added only after the hardware checklist proves them.
- Device chosen by exact name as `-sinks decklink` prints it. Two sinks with the assigned name → refuse to open (`device-ambiguous`); never pick one.
- Stall: no completed write for `STALL_MS = 5000` → kill and restart. Restart delays use the existing `respawnDelayMs()` from `apps/desktop/src/supervisor.ts`.
- Stopping: SIGTERM, again at 1 s and 2 s, SIGKILL at 3 s if still alive (a wedged ffmpeg needs several SIGTERMs).
- Device prefs are per machine (`channel-window-prefs.json`) and never synced.
- Device reference is an object `{ name: string }` so a disambiguating field can be added later without a prefs migration.
- Operator-facing copy is plain language; raw ffmpeg text only ever appears in logs.

## Review Focus

1. Offscreen `paint` on a Retina Mac delivers a bitmap at 2× — the frame written must be exactly `W*H*4` bytes at the format size (resize first). Pinned in Task 4 (`frameFromImage` test).
2. A display unplugged or plugged in must never close, reopen or duplicate a DeckLink output (they are not display windows). Pinned in Task 4 (`channelsToOpenOnDisplayChange`/`shouldAutoOpen` tests).
3. Quitting the app while ffmpeg is wedged must still free the card. Pinned in Task 3 (`stop()` escalation test).
4. A device name with spaces or quotes is one argv element, unmodified. Pinned in Task 2 (`buildOutputArgs` test).
5. Writes must never interleave or split frames across a restart (torn picture). Pinned in Task 3 (one in-flight write; new process starts at a frame boundary).

---

### Task 1: Hardware checklist the owner runs on the Mac mini

**Files:**
- Create: `docs/decklink-output.md`

Owner-facing, copy-pasteable. Covers: building ffmpeg with Narthex TV's `build-ffmpeg-decklink.sh` (link the GRMCApps path; SDK must match **Desktop Video Setup → About**), and four checks, each with the exact command and what a pass/fail looks like:

1. `~/.local/bin/ffmpeg-decklink -hide_banner -sinks decklink` lists `UltraStudio Express Monitor 3G`.
2. Card + TV lock, independent of OverlaySys: `~/.local/bin/ffmpeg-decklink -hide_banner -f lavfi -i testsrc2=size=1920x1080:rate=60000/1001 -an -c:v v210 -f decklink 'UltraStudio Express Monitor 3G'` — the counter must keep moving (a frozen counter = SDK/driver mismatch, see Narthex README). Ctrl-C to stop.
3. While (2) runs: **System Settings → Sound → Output** — is the UltraStudio listed? (Decides whether SDI audio is free.)
4. After Task 5 ships: assign the stage channel to the device, open it, and report the app log lines `[decklink]` for frames written/s (must hold ~59.9) and Activity Monitor CPU for OverlaySys.

Also: "If the TV shows nothing / frozen / red" troubleshooting table lifted from the Narthex README (red = wrong codec; `Could not enable video output!` = something else holds the card, `pgrep -fl ffmpeg-decklink`). And how to report results back (paste outputs).

- [ ] **Step 1:** Write the doc. **Step 2:** Commit `docs: Blackmagic output hardware checklist`.

---

### Task 2: Prefs schema and pure ffmpeg helpers

**Files:**
- Modify: `packages/core/src/channelWindowPrefs.ts`
- Test: `packages/core/src/channelWindowPrefs.test.ts`
- Create: `packages/core/src/deckLinkOutput.ts` (+ export from `packages/core/src/index.ts`) — shared by desktop and operator, which can't import desktop code
- Test: `packages/core/src/deckLinkOutput.test.ts`
- Create: `apps/desktop/src/decklink/ffmpeg.ts`
- Test: `apps/desktop/src/decklink/ffmpeg.test.ts`

**Interfaces — Produces:**
- core: `DeckLinkOutputPrefSchema = z.object({ device: z.object({ name: z.string().min(1) }), format: z.string().default("1080p59.94") })`, type `DeckLinkOutputPref`; `ChannelWindowPrefsSchema` gains `decklink: DeckLinkOutputPrefSchema.optional()` (present = this channel goes to a device, display fields ignored); `WindowPrefsFileSchema` gains `decklinkFfmpegPath: z.string().optional()`.
- core `deckLinkOutput.ts` (pure data and copy): `SignalFormat`, `SIGNAL_FORMATS`, `DEFAULT_FORMAT_ID`, `findFormat`, `DeckLinkErrorCode`, `deckLinkErrorText`, and
  `type DeckLinkStatus = { state: "starting" | "running" } | { state: "restarting"; code: DeckLinkErrorCode; attempt: number; delayMs: number } | { state: "failed"; code: DeckLinkErrorCode } | { state: "stopped" }` — all as specified below.
- desktop `ffmpeg.ts` (imports the core pieces): `DEFAULT_FFMPEG_PATH`, `resolveFfmpegPath`, `buildOutputArgs`, `parseSinks`, `classifyFfmpegError`, `checkDevice`.
- Specifications:
  - `type SignalFormat = { id: string; label: string; width: number; height: number; rate: string; fps: number }`
  - `SIGNAL_FORMATS: SignalFormat[]` = `[{ id: "1080p59.94", label: "1080p 59.94", width: 1920, height: 1080, rate: "60000/1001", fps: 60000 / 1001 }]`; `DEFAULT_FORMAT_ID = "1080p59.94"`; `findFormat(id: string): SignalFormat` (unknown → default).
  - `DEFAULT_FFMPEG_PATH = "~/.local/bin/ffmpeg-decklink"`; `resolveFfmpegPath(configured: string | undefined, home: string): string` (blank → default; leading `~/` → home).
  - `buildOutputArgs(device: string, f: SignalFormat): string[]` (no binary; exact order from Global Constraints, with `-hide_banner -loglevel warning` first).
  - `parseSinks(stdout: string): string[]` — device names from `-sinks decklink` output (lines like `  <name> [<description>]`; take text before ` [`, trimmed; ignore the header line).
  - `type DeckLinkErrorCode = "ffmpeg-not-found" | "no-decklink" | "device-not-found" | "device-ambiguous" | "device-busy" | "format-refused" | "stalled" | "exited"`
  - `classifyFfmpegError(stderr: string): DeckLinkErrorCode` — `Unknown output format`/`not a suitable output format` → `no-decklink`; `Could not enable video output` → `device-busy`; `Unsupported video size, framerate or field order` → `format-refused`; `Could not open`/`No such` → `device-not-found`; else `exited`.
  - `checkDevice(sinks: string[], name: string): "ok" | "device-not-found" | "device-ambiguous"`.
  - `deckLinkErrorText(code: DeckLinkErrorCode, device: string): string` — the operator copy (one sentence each; e.g. busy: `“${device}” is in use by another program (Narthex TV, or a leftover ffmpeg).`; ambiguous: `Two devices are called “${device}”. OverlaySys won't guess which one to use.`; ffmpeg-not-found mentions Settings → Connection).

- [ ] **Step 1: Failing tests**

```ts
// channelWindowPrefs.test.ts
it("accepts a decklink output and defaults its format", () => {
  const p = ChannelWindowPrefsSchema.parse({ decklink: { device: { name: "UltraStudio Express Monitor 3G" } } });
  expect(p.decklink).toEqual({ device: { name: "UltraStudio Express Monitor 3G" }, format: "1080p59.94" });
});
it("old prefs files without decklink still parse", () => {
  expect(WindowPrefsFileSchema.parse({ channels: { stage: { autoOpen: true } } }).channels.stage!.decklink).toBeUndefined();
});

// ffmpeg.test.ts
it("builds the Narthex-proven output command, device as one argv element", () => {
  expect(buildOutputArgs(`Studio "A" 3G`, findFormat("1080p59.94"))).toEqual([
    "-hide_banner", "-loglevel", "warning",
    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "1920x1080", "-r", "60000/1001", "-i", "pipe:0",
    "-an", "-c:v", "v210", "-f", "decklink", `Studio "A" 3G`,
  ]);
});
it("parses sinks", () => {
  expect(parseSinks("Auto-detected sinks for decklink:\n  UltraStudio Express Monitor 3G [UltraStudio Express Monitor 3G]\n")).toEqual(["UltraStudio Express Monitor 3G"]);
  expect(parseSinks("")).toEqual([]);
});
it("refuses two devices with the assigned name", () => {
  expect(checkDevice(["X", "X"], "X")).toBe("device-ambiguous");
  expect(checkDevice(["Y"], "X")).toBe("device-not-found");
  expect(checkDevice(["X", "Y"], "X")).toBe("ok");
});
it("classifies ffmpeg failures", () => {
  expect(classifyFfmpegError("[decklink] Could not enable video output!")).toBe("device-busy");
  expect(classifyFfmpegError("Unsupported video size, framerate or field order!")).toBe("format-refused");
  expect(classifyFfmpegError("Unknown output format: 'decklink'")).toBe("no-decklink");
  expect(classifyFfmpegError("something else")).toBe("exited");
});
it("expands ~ and falls back to the default path", () => {
  expect(resolveFfmpegPath(undefined, "/Users/a")).toBe("/Users/a/.local/bin/ffmpeg-decklink");
  expect(resolveFfmpegPath("  ", "/Users/a")).toBe("/Users/a/.local/bin/ffmpeg-decklink");
  expect(resolveFfmpegPath("/opt/ff", "/Users/a")).toBe("/opt/ff");
});
it("unknown format id falls back to 1080p59.94", () => {
  expect(findFormat("nope").id).toBe("1080p59.94");
});
```

- [ ] **Step 2:** `npx vitest run packages/core/src/channelWindowPrefs.test.ts apps/desktop/src/decklink/ffmpeg.test.ts` → FAIL (missing exports).
- [ ] **Step 3:** Implement. (Confirm the desktop tests are in the root vitest `include`; `apps/desktop/src/**/*.test.ts` already is.)
- [ ] **Step 4:** Re-run → PASS; `pnpm -F @overlaysys/core typecheck`.
- [ ] **Step 5:** Commit `feat(desktop): DeckLink prefs schema and ffmpeg helpers`.

---

### Task 3: `DeckLinkOutput` — process, frame pump, watchdog, stop

**Files:**
- Create: `apps/desktop/src/decklink/output.ts`
- Test: `apps/desktop/src/decklink/output.test.ts`

**Interfaces:**
- Consumes: Task 2 (`buildOutputArgs`, `classifyFfmpegError`, `SignalFormat`, `DeckLinkErrorCode`), `respawnDelayMs` from `../supervisor`.
- Produces:

```ts
export type SpawnLike = (cmd: string, args: string[]) => ChildLike; // ChildLike: stdin {write(buf, cb)}, stderr on("data"), on("exit"|"error"), kill(sig), pid, exitCode
// DeckLinkStatus comes from @overlaysys/core (Task 2); "failed" is not retried (ffmpeg-not-found, no-decklink).
export class DeckLinkOutput {
  constructor(opts: {
    ffmpeg: string; device: string; format: SignalFormat;
    spawn: SpawnLike; now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (t: unknown) => void;
    onStatus: (s: DeckLinkStatus) => void; log: (line: string) => void;
  });
  start(): void;
  setFrame(frame: Buffer): void;   // latest frame, exactly W*H*4 bytes; throws on wrong length
  stop(): Promise<void>;           // resolves when the child has exited
  readonly framesWritten: number;
}
```

Behaviour (the tests pin each):
- Before the first `setFrame`, the pump writes a black frame (`Buffer.alloc(W*H*4)` with alpha 255) so the card opens immediately.
- At most one write in flight; the next write starts in the previous write's callback, always with the latest frame (repeats are fine). This is what lets the card pace the program.
- Watchdog: if a write hasn't completed within `STALL_MS` (export it, 5000), kill the child, emit `restarting` with code `stalled`.
- Child exits on its own: classify accumulated stderr; `ffmpeg-not-found` (spawn `error` ENOENT) and `no-decklink` → `failed`, no retry; anything else → `restarting` after `respawnDelayMs(attempt)`; attempt resets after 60 s of `running`.
- `running` is emitted after the first completed write.
- `stop()`: no further restarts; SIGTERM now, at +1 s and +2 s, SIGKILL at +3 s if not exited; emits `stopped`.
- Log once per 10 s: `[decklink] <device>: <n> frames in 10s` (Task 1 check 4 reads this).

- [ ] **Step 1: Failing tests** with a fake child and fake timers (`vi.useFakeTimers()`), covering: black frame first and `running` after its callback; only one write in flight and next write uses the latest `setFrame`; wrong-length `setFrame` throws; stall → kill + `restarting/stalled`; exit with `Could not enable video output` stderr → `restarting/device-busy` with `delayMs` 1000 then 2000 on the next; ENOENT → `failed/ffmpeg-not-found` and no respawn; `stop()` sends SIGTERM ×3 then SIGKILL to a child that ignores them, resolves after exit, and never respawns.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat(desktop): DeckLinkOutput pump with stall watchdog and safe stop`.

---

### Task 4: Desktop wiring — offscreen window, open/close, quit, IPC, events

**Files:**
- Create: `apps/desktop/src/decklink/frame.ts` (+ `frame.test.ts`)
- Modify: `apps/desktop/src/main.ts` (open path in `openConfiguredChannelWindow`, `overlaysys:close-channel-window`, `overlaysys:list-channel-windows`, auto-open loop ~1683, `before-quit` ~1758, new IPC), `apps/desktop/src/rendererUrl.ts` (+ test), `apps/desktop/src/windowPrefs.ts` (+ test), `apps/desktop/src/supervisor.ts` (`DesktopEvent`), `apps/desktop/src/preload.ts`, `apps/operator/src/lib/desktop.ts` (types)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `frameFromImage(img: { getSize(): {width:number;height:number}; resize(o:{width:number;height:number}): typeof img; toBitmap(): Buffer }, f: SignalFormat): Buffer` — resizes when the size differs (Retina 2×), returns exactly `W*H*4` bytes.
  - `buildRendererChannelUrl` gains `label?: string` → `label` search param (the renderer already reports it via `outputLabel`, so **Outputs** status shows the device by name with no server change).
  - `shouldAutoOpen` / `channelsToOpenOnDisplayChange` accept `decklink` in the picked prefs: decklink channels auto-open at launch when `autoOpen` regardless of displays, and are never returned by `channelsToOpenOnDisplayChange`.
  - IPC: `overlaysys:decklink-list-devices` → `{ ok: true; devices: string[]; ffmpeg: string } | { ok: false; code: DeckLinkErrorCode; message: string }` (runs `<ffmpeg> -hide_banner -sinks decklink`, 5 s timeout); `overlaysys:decklink-check` → same plus `version: string` (first line of `-version`). Preload exposes `decklinkListDevices()`, `decklinkCheck()`; `setChannelWindowPrefs` already carries `decklink`; add `setDecklinkFfmpegPath(path: string)`.
  - `DesktopEvent` gains `{ kind: "decklink-status"; channelId: string; device: string; status: DeckLinkStatus }` (`DeckLinkStatus` from `@overlaysys/core`, so the operator's `desktop.ts` types import it from there too).

Main-process behaviour:
- `openConfiguredChannelWindow` with `prefs.decklink`: before spawning, list sinks and `checkDevice` (not ok → emit `decklink-status` `failed` with that code; don't open). Otherwise create `new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, backgroundColor: "#000000", transparent: false, webPreferences: { offscreen: true, backgroundThrottling: false } })`, `webContents.setFrameRate(Math.round(fps))` (override with env `OVERLAYSYS_DECKLINK_RENDER_FPS` for the hardware test's half-rate fallback), load the renderer URL with `label` = device name and the prefs' `audioOutput`, and pipe `paint` → `frameFromImage` → `output.setFrame`. Keep these in a `decklinkOutputs: Map<channelId, { win, output }>` — **not** in `channelWindows`/the display map, so the display-removed guard ignores them.
- Re-open with changed device/format: stop the old output (await) before starting the new one.
- `overlaysys:close-channel-window` and `list-channel-windows` cover both maps; closing a decklink output awaits `output.stop()` then destroys the offscreen window.
- `before-quit`: `event.preventDefault()` once, await all `output.stop()` (cap 4 s), then `app.quit()`; `process.on("exit")` SIGKILLs any child still alive.
- Renderer crash in the offscreen window: reuse the existing reload policy (`shouldReloadAfterGone`, `RateLimiter`).
- Status changes → `notifyOperator({ kind: "decklink-status", ... })`; log with `[decklink]`.

- [ ] **Step 1: Failing tests:** `frameFromImage` resizes a 3840×2160 fake to 1920×1080 and returns 8 294 400 bytes, and doesn't resize a correct one; `buildRendererChannelUrl({..., label: "UltraStudio Express Monitor 3G"})` has `label`; `shouldAutoOpen({ autoOpen: true, decklink })` true with `matchedBy: "fallback"`; `channelsToOpenOnDisplayChange` skips a decklink channel.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement helpers, then the main.ts wiring. **Step 4:** Run desktop tests → PASS; `pnpm -F @overlaysys/desktop typecheck`; `pnpm -F @overlaysys/desktop build`.
- [ ] **Step 5: Smoke without hardware** — set `decklinkFfmpegPath` to a nonexistent path, assign a channel, open it: the operator gets the ffmpeg-not-found toast and nothing is left running (`pgrep -fl ffmpeg` empty). Record the result in the task report.
- [ ] **Step 6:** Commit `feat(desktop): send a channel to a Blackmagic device via an offscreen renderer`.

---

### Task 5: Operator UI — Output choice, ffmpeg setting, status toasts

**Files:**
- Modify: `apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx`
- Modify: `apps/operator/src/app/settings/connection/page.tsx`
- Modify: `apps/operator/src/app/shell/shellStatus.ts` (+ `shellStatus.test.ts`)
- Create: `apps/operator/src/lib/decklinkOutputChoice.ts` (+ `decklinkOutputChoice.test.ts`)

**Interfaces:**
- Consumes: Task 4 preload API and `DesktopEvent`.
- Produces: `outputChoiceValue(prefs: ChannelWindowPrefs): string` (`"display:<id>"`, `"display:"` for primary, `"decklink:<name>"`) and `applyOutputChoice(prefs: ChannelWindowPrefs, value: string): ChannelWindowPrefs` (choosing a device sets `decklink: { device: { name }, format: prev?.format ?? "1080p59.94" }` and clears nothing else; choosing a display deletes `decklink`).

UI:
- Popover: the "Display" select becomes **Output** with two `<optgroup>`s — Displays (as today) and **Blackmagic** (from `decklinkListDevices()`; a saved device not currently found is still listed, marked “(not connected)”). With a device chosen: hide fullscreen/frameless/always-on-top/transparent; show **Signal format** (from core `SIGNAL_FORMATS` — single option today); keep Auto-open and Audio output. If listing fails, show the plain message under the select. Saving with an open output re-opens it (same path as the audio change today).
- Settings → Connection (desktop only): **Blackmagic output** section — ffmpeg path input (placeholder `~/.local/bin/ffmpeg-decklink`), **Check** button showing version + devices or the plain error.
- `describeDesktopEvent` for `decklink-status`: `running` → good, "“<device>” is on air for <channel>."; `restarting` → warn, `deckLinkErrorText` + " Restarting."; `failed` → bad, sticky, `deckLinkErrorText` (both from core); `starting`/`stopped` → dim and not toasted (filter in `DesktopEventToasts`).

- [ ] **Step 1: Failing tests:** `applyOutputChoice` round-trips display ↔ device and keeps format; `outputChoiceValue` for each case; `describeDesktopEvent` texts/tones for running, restarting(device-busy), failed(ffmpeg-not-found).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run operator tests → PASS; operator typecheck.
- [ ] **Step 5:** Commit `feat(operator): Blackmagic output choice, ffmpeg check and status toasts`.

---

### Task 6: Hardware acceptance (owner, on the Mac mini)

Not code. The controller hands the owner `docs/decklink-output.md` checks 1–4 and waits for results. Acceptance: the stage channel shows on the TV through the converter, the test counter / live layout keeps moving for 10 minutes, `[decklink]` logs ~599 frames per 10 s, a take changes the TV with no signal drop, and quitting the app frees the card (`pgrep -fl ffmpeg-decklink` empty). Findings feed back as fixes (render-rate fallback via `OVERLAYSYS_DECKLINK_RENDER_FPS=30`, extra formats only if proven, audio follow-up if check 3 says no).
