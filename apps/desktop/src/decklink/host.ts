// Electron side of Blackmagic outputs: one offscreen renderer window plus one
// DeckLinkOutput per device-assigned channel. Kept apart from the display
// windows (main.ts `channelWindows`) on purpose, so plugging or unplugging a
// display never touches a device output.

import { BrowserWindow } from "electron";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import type { DeckLinkErrorCode, DeckLinkOutputPref, DeckLinkStatus } from "@overlaysys/core";
import { deckLinkErrorText, findFormat } from "./shared";
import type { DesktopEvent } from "../supervisor";
import { checkDevice, checkFfmpegPath, classifyFfmpegError, parseSinks, resolveFfmpegPath } from "./ffmpeg";
import { frameFromImage } from "./frame";
import { DeckLinkOutput, type ChildLike } from "./output";
import { respawnDelayMs } from "../supervisor";

export type DeckLinkListResult =
  | { ok: true; ffmpeg: string; devices: string[] }
  | { ok: false; ffmpeg: string; code: DeckLinkErrorCode; message: string };

export type DeckLinkCheckResult = DeckLinkListResult & { version?: string };

export interface DeckLinkHostDeps {
  /** Renderer URL for a channel, naming the output with `label`. */
  rendererUrl: (channelId: string, label: string) => string;
  /** The existing crash/reload policy for output windows. */
  attachAutoReload: (win: BrowserWindow, target: string, url: () => string) => void;
  notify: (ev: DesktopEvent) => void;
  /** Configured ffmpeg path (unexpanded; blank = default). */
  ffmpegSetting: () => string | undefined;
  /** What's at a path, or null when nothing is there. */
  stat: (p: string) => { isFile(): boolean } | null;
  /** An output opened or closed (power-save blocker, operator dots). */
  onOpenChange: (channelId: string, open: boolean) => void;
}

interface Running {
  win: BrowserWindow;
  output: DeckLinkOutput;
  device: string;
  format: string;
}

const LIST_TIMEOUT_MS = 5000;
/** Cap on releasing one card: past SIGKILL (3 s) a close must not hang the queue. */
const CLOSE_CAP_MS = 4000;

function run(cmd: string, args: string[]): Promise<{ out: string; err: (NodeJS.ErrnoException & { killed?: boolean }) | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: LIST_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ out: `${stdout}\n${stderr}`, err: err as (NodeJS.ErrnoException & { killed?: boolean }) | null });
    });
  });
}

function capped(p: Promise<void>, ms: number): Promise<void> {
  return Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

export function createDeckLinkHost(deps: DeckLinkHostDeps) {
  const running = new Map<string, Running>();
  /**
   * What each channel should be doing; null = closed. Opens and closes for a
   * channel run one at a time in call order (`queue`), and each step acts on
   * the latest wish, so a close or a device change made while an open is
   * still listing devices is never lost.
   */
  const wanted = new Map<string, DeckLinkOutputPref | null>();
  const queue = new Map<string, Promise<void>>();
  /** Retry of a device that wasn't there (launch before the card enumerates). */
  const retries = new Map<string, { timer: NodeJS.Timeout; attempt: number }>();

  const ffmpeg = () => resolveFfmpegPath(deps.ffmpegSetting(), os.homedir());

  async function listDevices(): Promise<DeckLinkListResult> {
    const bin = ffmpeg();
    // Never run a stored path that isn't a real ffmpeg (prefs edited by hand,
    // or the file was replaced since it was saved).
    const checked = checkFfmpegPath(bin, os.homedir(), deps.stat);
    if (!checked.ok) {
      console.warn(`[decklink] not running ${bin}: ${checked.message}`);
      return { ok: false, ffmpeg: bin, code: "ffmpeg-not-found", message: deckLinkErrorText("ffmpeg-not-found", "") };
    }
    const { out, err } = await run(bin, ["-hide_banner", "-sinks", "decklink"]);
    // Missing, not executable, a directory, or hung: all an ffmpeg-path problem.
    if (err && (typeof err.code === "string" || err.killed)) {
      return { ok: false, ffmpeg: bin, code: "ffmpeg-not-found", message: deckLinkErrorText("ffmpeg-not-found", "") };
    }
    if (classifyFfmpegError(out) === "no-decklink") {
      return { ok: false, ffmpeg: bin, code: "no-decklink", message: deckLinkErrorText("no-decklink", "") };
    }
    return { ok: true, ffmpeg: bin, devices: parseSinks(out).map((d) => d.name) };
  }

  async function check(): Promise<DeckLinkCheckResult> {
    const list = await listDevices();
    if (!list.ok && list.code === "ffmpeg-not-found") return list;
    const { out } = await run(list.ffmpeg, ["-hide_banner", "-version"]);
    return { ...list, version: out.split("\n")[0]?.trim() ?? "" };
  }

  function status(channelId: string, device: string, s: DeckLinkStatus): void {
    const detail = "code" in s ? ` (${s.code})` : "";
    console.log(`[decklink] channel "${channelId}" → ${device}: ${s.state}${detail}`);
    deps.notify({ kind: "decklink-status", channelId, device, status: s });
  }

  function enqueue(channelId: string, step: () => Promise<void>): Promise<void> {
    const prev = queue.get(channelId) ?? Promise.resolve();
    const next = prev.then(step).catch((err) => console.error(`[decklink] channel "${channelId}":`, err));
    queue.set(channelId, next);
    return next;
  }

  function cancelRetry(channelId: string): void {
    const r = retries.get(channelId);
    if (r) clearTimeout(r.timer);
    retries.delete(channelId);
  }

  async function release(channelId: string): Promise<void> {
    const r = running.get(channelId);
    if (!r) return;
    running.delete(channelId);
    await capped(r.output.stop(), CLOSE_CAP_MS);
    if (!r.win.isDestroyed()) r.win.destroy();
    deps.onOpenChange(channelId, false);
  }

  /** Close an output whose ffmpeg is gone for good; `wanted` stays, so a retry reopens it. */
  async function dropFailed(channelId: string, output: DeckLinkOutput): Promise<void> {
    const r = running.get(channelId);
    if (r?.output !== output) return;
    running.delete(channelId);
    if (!r.win.isDestroyed()) r.win.destroy();
    deps.onOpenChange(channelId, false);
  }

  /** Bring the channel to what `wanted` says. Runs inside the channel's queue. */
  async function reconcile(channelId: string): Promise<void> {
    const want = wanted.get(channelId) ?? null;
    const cur = running.get(channelId);
    if (cur && want && cur.device === want.device.name && cur.format === want.format) return;
    if (cur) await release(channelId);
    if (!want) return;

    const device = want.device.name;
    const list = await listDevices();
    if (wanted.get(channelId) !== want) return; // superseded while listing; a later step handles it
    if (!list.ok) {
      status(channelId, device, { state: "failed", code: list.code });
      return;
    }
    const found = checkDevice(list.devices, device);
    if (found === "device-ambiguous") {
      status(channelId, device, { state: "failed", code: found });
      return;
    }
    if (found === "device-not-found") {
      // Likely launch before the card enumerated: keep trying while wanted.
      const attempt = (retries.get(channelId)?.attempt ?? 0) + 1;
      const delayMs = respawnDelayMs(attempt);
      status(channelId, device, { state: "restarting", code: found, attempt, delayMs });
      const timer = setTimeout(() => {
        if (wanted.get(channelId) === want) void enqueue(channelId, () => reconcile(channelId));
      }, delayMs);
      retries.set(channelId, { timer, attempt });
      return;
    }
    cancelRetry(channelId);

    const format = findFormat(want.format);
    const win = new BrowserWindow({
      show: false,
      width: format.width,
      height: format.height,
      useContentSize: true,
      frame: false,
      backgroundColor: "#000000",
      transparent: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    const renderFps = Number(process.env["OVERLAYSYS_DECKLINK_RENDER_FPS"]) || Math.round(format.fps);
    win.webContents.setFrameRate(Math.min(240, Math.max(1, renderFps)));

    const output = new DeckLinkOutput({
      ffmpeg: list.ffmpeg,
      device,
      format,
      spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] }) as unknown as ChildLike,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
      onStatus: (s) => {
        status(channelId, device, s);
        // A failure a restart can't fix: close the output so a later open (or
        // retryFailed) starts it afresh instead of finding it "already running".
        if (s.state === "failed") void enqueue(channelId, () => dropFailed(channelId, output));
      },
      log: (line) => console.log(line),
    });

    win.webContents.on("paint", (_e, _dirty, image) => {
      try {
        output.setFrame(frameFromImage(image, format));
      } catch (err) {
        console.warn(`[decklink] channel "${channelId}": bad frame`, err);
      }
    });
    const url = () => deps.rendererUrl(channelId, device);
    deps.attachAutoReload(win, `${channelId} (${device})`, url);
    win.on("closed", () => {
      if (running.get(channelId)?.win === win) {
        running.delete(channelId);
        void output.stop();
        deps.onOpenChange(channelId, false);
      }
    });

    running.set(channelId, { win, output, device, format: want.format });
    output.start();
    void win.loadURL(url());
    deps.onOpenChange(channelId, true);
  }

  /** Open (or switch) a channel's device output; `force` recreates it even if unchanged. */
  function open(channelId: string, pref: DeckLinkOutputPref, opts: { force?: boolean } = {}): Promise<void> {
    wanted.set(channelId, pref);
    cancelRetry(channelId);
    return enqueue(channelId, async () => {
      if (opts.force) await release(channelId);
      await reconcile(channelId);
    });
  }

  function close(channelId: string): Promise<void> {
    wanted.set(channelId, null);
    cancelRetry(channelId);
    return enqueue(channelId, () => reconcile(channelId));
  }

  /** Try again every output that's wanted but not running (e.g. after the ffmpeg path changed). */
  function retryFailed(): Promise<void> {
    const ids = [...wanted].filter(([id, want]) => want && !running.has(id)).map(([id]) => id);
    return Promise.all(
      ids.map((id) => {
        cancelRetry(id);
        return enqueue(id, () => reconcile(id));
      }),
    ).then(() => undefined);
  }

  async function stopAll(): Promise<void> {
    const ids = [...new Set([...running.keys(), ...wanted.keys()])];
    await capped(Promise.all(ids.map((id) => close(id))).then(() => undefined), CLOSE_CAP_MS);
  }

  return {
    open,
    close,
    stopAll,
    retryFailed,
    listDevices,
    check,
    isOpen: (channelId: string) => running.has(channelId),
    openIds: () => [...running.keys()],
    /** The server came back on a new port: point every device renderer at it. */
    reloadAll: () => {
      for (const [channelId, r] of running) {
        if (!r.win.isDestroyed()) void r.win.loadURL(deps.rendererUrl(channelId, r.device));
      }
    },
    killAllNow: () => {
      for (const r of running.values()) r.output.killNow();
    },
  };
}

export type DeckLinkHost = ReturnType<typeof createDeckLinkHost>;
