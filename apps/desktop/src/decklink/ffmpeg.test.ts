import { describe, expect, it } from "vitest";
import { findFormat } from "@overlaysys/core";
import { buildOutputArgs, checkDevice, classifyFfmpegError, parseSinks, resolveFfmpegPath } from "./ffmpeg";

describe("buildOutputArgs", () => {
  it("builds the Narthex-proven output command, device as one argv element", () => {
    expect(buildOutputArgs(`Studio "A" 3G`, findFormat("1080p59.94"))).toEqual([
      "-hide_banner", "-loglevel", "warning",
      "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "1920x1080", "-r", "60000/1001", "-i", "pipe:0",
      "-an", "-c:v", "v210", "-f", "decklink", `Studio "A" 3G`,
    ]);
  });
});

describe("parseSinks", () => {
  it("reads device names", () => {
    expect(
      parseSinks("Auto-detected sinks for decklink:\n  UltraStudio Express Monitor 3G [UltraStudio Express Monitor 3G]\n"),
    ).toEqual(["UltraStudio Express Monitor 3G"]);
    expect(parseSinks("")).toEqual([]);
  });
});

describe("checkDevice", () => {
  it("refuses two devices with the assigned name", () => {
    expect(checkDevice(["X", "X"], "X")).toBe("device-ambiguous");
    expect(checkDevice(["Y"], "X")).toBe("device-not-found");
    expect(checkDevice(["X", "Y"], "X")).toBe("ok");
  });
});

describe("classifyFfmpegError", () => {
  it("maps ffmpeg's messages to plain codes", () => {
    expect(classifyFfmpegError("[decklink] Could not enable video output!")).toBe("device-busy");
    expect(classifyFfmpegError("Unsupported video size, framerate or field order!")).toBe("format-refused");
    expect(classifyFfmpegError("Unknown output format: 'decklink'")).toBe("no-decklink");
    expect(classifyFfmpegError("something else")).toBe("exited");
  });
});

describe("resolveFfmpegPath", () => {
  it("expands ~ and falls back to the default path", () => {
    expect(resolveFfmpegPath(undefined, "/Users/a")).toBe("/Users/a/.local/bin/ffmpeg-decklink");
    expect(resolveFfmpegPath("  ", "/Users/a")).toBe("/Users/a/.local/bin/ffmpeg-decklink");
    expect(resolveFfmpegPath("~/bin/ff", "/Users/a")).toBe("/Users/a/bin/ff");
    expect(resolveFfmpegPath("/opt/ff", "/Users/a")).toBe("/opt/ff");
  });
});
