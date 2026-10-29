// Pure helpers for driving a Blackmagic device through ffmpeg-decklink. Every
// choice in buildOutputArgs was paid for in front of the hardware by Narthex
// TV (GRMCApps scripts/narthex-tv/playout.py, outer_command): v210 is the only
// codec that shows a picture, there is no -pix_fmt on the output and no
// -format_code, and the mode is picked from the raw stream's size and rate.

import type { DeckLinkErrorCode, SignalFormat } from "@overlaysys/core";

export const DEFAULT_FFMPEG_PATH = "~/.local/bin/ffmpeg-decklink";

/** The configured ffmpeg path, blank → default, with a leading `~/` expanded. */
export function resolveFfmpegPath(configured: string | undefined, home: string): string {
  const p = configured?.trim() || DEFAULT_FFMPEG_PATH;
  return p.startsWith("~/") ? `${home}/${p.slice(2)}` : p;
}

/** ffmpeg arguments (without the binary) for one long-lived output reading BGRA frames on stdin. */
export function buildOutputArgs(device: string, f: SignalFormat): string[] {
  return [
    "-hide_banner", "-loglevel", "warning",
    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${f.width}x${f.height}`, "-r", f.rate, "-i", "pipe:0",
    "-an", "-c:v", "v210", "-f", "decklink", device,
  ];
}

/** Device names from `ffmpeg -sinks decklink` (lines like `  <name> [<description>]`). */
export function parseSinks(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!/^\s+\S/.test(line)) continue;
    const bracket = line.lastIndexOf(" [");
    const name = (bracket >= 0 ? line.slice(0, bracket) : line).trim();
    if (name) names.push(name);
  }
  return names;
}

/** Plain error code for what ffmpeg printed before it exited. */
export function classifyFfmpegError(stderr: string): DeckLinkErrorCode {
  if (/Unknown output format|not a suitable output format/i.test(stderr)) return "no-decklink";
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
