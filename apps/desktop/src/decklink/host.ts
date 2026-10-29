// Electron side of Blackmagic outputs: one offscreen renderer window plus one
// DeckLinkOutput per device-assigned channel. Kept apart from the display
// windows (main.ts `channelWindows`) on purpose, so plugging or unplugging a
// display never touches a device output.

import { BrowserWindow } from "electron";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import {
  deckLinkErrorText,
  findFormat,
  type DeckLinkErrorCode,
  type DeckLinkOutputPref,
  type DeckLinkStatus,
} from "@overlaysys/core";
import type { DesktopEvent } from "../supervisor";
import { checkDevice, classifyFfmpegError, parseSinks, resolveFfmpegPath } from "./ffmpeg";
import { frameFromImage } from "./frame";
import { DeckLinkOutput, type ChildLike } from "./output";

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
  /** An output opened or closed (power-save blocker, operator dots). */
  onOpenChange: (channelId: string, open: boolean) => void;
}

interface Running {
  win: BrowserWindow;
  output: DeckLinkOutput;
  device: string;
}

const LIST_TIMEOUT_MS = 5000;
const STOP_ALL_CAP_MS = 4000;

function run(cmd: string, args: string[]): Promise<{ out: string; err: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: LIST_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ out: `${stdout}\n${stderr}`, err: err as NodeJS.ErrnoException | null });
    });
  });
}

export function createDeckLinkHost(deps: DeckLinkHostDeps) {
  const running = new Map<string, Running>();
  /** Channels whose open is in progress, so a second open doesn't race it. */
  const opening = new Set<string>();

  const ffmpeg = () => resolveFfmpegPath(deps.ffmpegSetting(), os.homedir());

  async function listDevices(): Promise<DeckLinkListResult> {
    const bin = ffmpeg();
    const { out, err } = await run(bin, ["-hide_banner", "-sinks", "decklink"]);
    if (err?.code === "ENOENT") {
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

  async function open(channelId: string, pref: DeckLinkOutputPref): Promise<void> {
    if (opening.has(channelId)) return;
    opening.add(channelId);
    try {
      const existing = running.get(channelId);
      if (existing && existing.device === pref.device.name) return;
      if (existing) await close(channelId);

      const device = pref.device.name;
      const list = await listDevices();
      if (!list.ok) {
        status(channelId, device, { state: "failed", code: list.code });
        return;
      }
      const found = checkDevice(list.devices, device);
      if (found !== "ok") {
        status(channelId, device, { state: "failed", code: found });
        return;
      }

      const format = findFormat(pref.format);
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
        onStatus: (s) => status(channelId, device, s),
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

      running.set(channelId, { win, output, device });
      output.start();
      void win.loadURL(url());
      deps.onOpenChange(channelId, true);
    } finally {
      opening.delete(channelId);
    }
  }

  async function close(channelId: string): Promise<void> {
    const r = running.get(channelId);
    if (!r) return;
    running.delete(channelId);
    await r.output.stop();
    if (!r.win.isDestroyed()) r.win.destroy();
    deps.onOpenChange(channelId, false);
  }

  async function stopAll(): Promise<void> {
    const ids = [...running.keys()];
    await Promise.race([
      Promise.all(ids.map((id) => close(id))),
      new Promise<void>((resolve) => setTimeout(resolve, STOP_ALL_CAP_MS)),
    ]);
  }

  return {
    open,
    close,
    stopAll,
    listDevices,
    check,
    isOpen: (channelId: string) => running.has(channelId),
    openIds: () => [...running.keys()],
    killAllNow: () => {
      for (const r of running.values()) r.output.killNow();
    },
  };
}

export type DeckLinkHost = ReturnType<typeof createDeckLinkHost>;
