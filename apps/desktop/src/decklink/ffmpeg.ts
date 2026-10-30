// Pure helpers for driving a Blackmagic device through ffmpeg-decklink. Every
// choice in buildOutputArgs was paid for in front of the hardware by Narthex
// TV (GRMCApps scripts/narthex-tv/playout.py, outer_command): v210 is the only
// codec that shows a picture, there is no -pix_fmt on the output and no
// -format_code, and the mode is picked from the raw stream's size and rate.

import path from "node:path";
import type { DeckLinkErrorCode, SignalFormat } from "@overlaysys/core";

export const DEFAULT_FFMPEG_PATH = "~/.local/bin/ffmpeg-decklink";

/** The configured ffmpeg path, blank → default, with a leading `~/` expanded. */
export function resolveFfmpegPath(configured: string | undefined, home: string): string {
  const p = configured?.trim() || DEFAULT_FFMPEG_PATH;
  return p.startsWith("~/") ? `${home}/${p.slice(2)}` : p;
}

export type FfmpegPathCheck = { ok: true; path: string | undefined } | { ok: false; message: string };

/**
 * Whether a typed ffmpeg path is safe to save and later run: blank clears the
 * setting; otherwise an absolute path (after `~` expansion) to an existing
 * file whose name starts with "ffmpeg". `stat` returns null when nothing is
 * there.
 */
export function checkFfmpegPath(
  input: string,
  home: string,
  stat: (p: string) => { isFile(): boolean } | null,
): FfmpegPathCheck {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, path: undefined };
  const p = trimmed === "~" ? home : trimmed.startsWith("~/") ? `${home}/${trimmed.slice(2)}` : trimmed;
  if (!path.isAbsolute(p)) {
    return { ok: false, message: "Enter the full path to ffmpeg, starting with / or ~/." };
  }
  if (!path.basename(p).startsWith("ffmpeg")) {
    return { ok: false, message: "That file isn't ffmpeg. Its name should start with \"ffmpeg\"." };
  }
  if (!stat(p)?.isFile()) {
    return { ok: false, message: `No ffmpeg file found at ${p}.` };
  }
  return { ok: true, path: p };
}

/**
 * Seconds of frames the DeckLink muxer schedules ahead. ffmpeg's default (0.5)
 * makes it buffer up to 60 frames — a second of lag, fine for Narthex TV's
 * slideshow but not for a confidence monitor. 0.1 keeps ~12 frames (~200 ms)
 * at 59.94. Tune with OVERLAYSYS_DECKLINK_PREROLL if the card stutters.
 */
export const DEFAULT_PREROLL_SEC = 0.1;

/** ffmpeg arguments (without the binary) for one long-lived output reading BGRA frames on stdin. */
export function buildOutputArgs(device: string, f: SignalFormat, opts: { prerollSec?: number } = {}): string[] {
  const p = opts.prerollSec;
  const preroll = p !== undefined && Number.isFinite(p) && p > 0 ? p : DEFAULT_PREROLL_SEC;
  return [
    // No -thread_queue_size here: the FFmpeg master build Narthex TV's script
    // makes treats it as an output (muxer) option and rejects it on an input.
    "-hide_banner", "-loglevel", "warning",
    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${f.width}x${f.height}`, "-r", f.rate, "-i", "pipe:0",
    "-an", "-c:v", "v210", "-preroll", String(preroll), "-f", "decklink", device,
  ];
}

export type DeckLinkSink = { id: string; name: string };

/**
 * Devices from `ffmpeg -sinks decklink`. Current ffmpeg prints
 * `  <id> [<name>] (none)`, e.g. `112:6925c4f0:00000000 [UltraStudio Express
 * Monitor 3G] (none)`; the id is what will tell identical units apart later.
 */
export function parseSinks(stdout: string): DeckLinkSink[] {
  const sinks: DeckLinkSink[] = [];
  for (const line of stdout.split("\n")) {
    if (!/^\s+\S/.test(line)) continue;
    const m = /^\s+(.+?)\s+\[(.+)\]/.exec(line);
    if (m) sinks.push({ id: m[1]!.trim(), name: m[2]!.trim() });
    else sinks.push({ id: line.trim(), name: line.trim() });
  }
  return sinks;
}

/** Plain error code for what ffmpeg printed before it exited. */
export function classifyFfmpegError(stderr: string): DeckLinkErrorCode {
  if (/Unknown (input or )?output format|not a suitable output format/i.test(stderr)) return "no-decklink";
  if (/Could not enable video output/i.test(stderr)) return "device-busy";
  if (/Unsupported video size, framerate or field order/i.test(stderr)) return "format-refused";
  if (/Could not open|No such/i.test(stderr)) return "device-not-found";
  return "exited";
}

/** Whether the assigned device can be opened unambiguously. */
export function checkDevice(sinks: string[], name: string): "ok" | "device-not-found" | "device-ambiguous" {
  const n = sinks.filter((s) => s === name).length;
  return n === 0 ? "device-not-found" : n > 1 ? "device-ambiguous" : "ok";
}
