import { describe, expect, it } from "vitest";
import { findFormat } from "@overlaysys/core";
import { buildOutputArgs, checkDevice, checkFfmpegPath, classifyFfmpegError, parseSinks, resolveFfmpegPath } from "./ffmpeg";

describe("buildOutputArgs", () => {
  it("builds the Narthex-proven output command, device as one argv element, with low latency", () => {
    expect(buildOutputArgs(`Studio "A" 3G`, findFormat("1080p59.94"))).toEqual([
      "-hide_banner", "-loglevel", "warning",
      "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "1920x1080", "-r", "60000/1001", "-i", "pipe:0",
      "-an", "-c:v", "v210", "-preroll", "0.1", "-f", "decklink", `Studio "A" 3G`,
    ]);
  });

  it("passes no input-side -thread_queue_size (current ffmpeg rejects it on an input)", () => {
    expect(buildOutputArgs("D", findFormat("1080p59.94"))).not.toContain("-thread_queue_size");
  });

  it("takes a preroll override, ignoring nonsense", () => {
    const f = findFormat("1080p59.94");
    expect(buildOutputArgs("D", f, { prerollSec: 0.25 })).toContain("0.25");
    expect(buildOutputArgs("D", f, { prerollSec: Number.NaN })).toContain("0.1");
    expect(buildOutputArgs("D", f, { prerollSec: -1 })).toContain("0.1");
  });
});

describe("parseSinks", () => {
  it("reads the id and the name from the real Mac mini output", () => {
    expect(
      parseSinks("Auto-detected sinks for decklink:\n  112:6925c4f0:00000000 [UltraStudio Express Monitor 3G] (none)\n"),
    ).toEqual([{ id: "112:6925c4f0:00000000", name: "UltraStudio Express Monitor 3G" }]);
  });

  it("falls back to the id when a line has no bracketed name, and ignores the header", () => {
    expect(parseSinks("Auto-detected sinks for decklink:\n  Some Card\n")).toEqual([{ id: "Some Card", name: "Some Card" }]);
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
    expect(classifyFfmpegError("Unknown input or output format: decklink")).toBe("no-decklink");
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

describe("checkFfmpegPath", () => {
  const files: Record<string, "file" | "dir"> = {
    "/Users/a/.local/bin/ffmpeg-decklink": "file",
    "/opt/homebrew/bin/ffmpeg": "file",
    "/opt/ffmpeg-dir": "dir",
    "/bin/sh": "file",
  };
  const stat = (p: string) => (p in files ? { isFile: () => files[p] === "file" } : null);

  it("clears the setting when blank", () => {
    expect(checkFfmpegPath("  ", "/Users/a", stat)).toEqual({ ok: true, path: undefined });
  });

  it("accepts an absolute path to an ffmpeg file, expanding ~", () => {
    expect(checkFfmpegPath(" /opt/homebrew/bin/ffmpeg ", "/Users/a", stat)).toEqual({ ok: true, path: "/opt/homebrew/bin/ffmpeg" });
    expect(checkFfmpegPath("~/.local/bin/ffmpeg-decklink", "/Users/a", stat)).toEqual({
      ok: true,
      path: "/Users/a/.local/bin/ffmpeg-decklink",
    });
  });

  it("refuses relative paths, other programs, folders and missing files", () => {
    for (const p of ["ffmpeg", "bin/ffmpeg", "/bin/sh", "/opt/ffmpeg-dir", "/opt/missing/ffmpeg", "~"]) {
      const r = checkFfmpegPath(p, "/Users/a", stat);
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/ffmpeg/);
    }
  });
});
