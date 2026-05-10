import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * Video formats that browsers' `<video>` elements can decode reliably across
 * Chromium / Safari / Firefox without surprise codec issues. Anything else
 * gets transcoded on upload.
 *
 * `.mov` is the common offender: macOS QuickTime exports often ship HEVC or
 * ProRes inside, both of which `<video>` typically can't decode (even though
 * the browser will play the file when navigated to directly, because the OS
 * native player kicks in for top-level navigation).
 */
const WEB_SAFE_EXTS = new Set([".mp4", ".webm"]);

export function needsTranscode(extWithDot: string): boolean {
  return !WEB_SAFE_EXTS.has(extWithDot.toLowerCase());
}

/**
 * Transcode `srcPath` to H.264/AAC MP4 at `dstPath`. Resolves on success,
 * rejects with the ffmpeg stderr tail on failure or timeout.
 *
 * Args explained:
 *   -y               overwrite existing dst
 *   -i <src>         input
 *   -c:v libx264     widely-supported video codec
 *   -preset fast     reasonable speed/size tradeoff for short clips
 *   -pix_fmt yuv420p required for browser <video> compatibility
 *   -movflags +faststart   put moov atom up front so playback can start before download finishes
 *   -c:a aac -b:a 128k     re-encode audio to a web-safe codec
 *   -map 0:v? -map 0:a?    pass through video and audio if present (skip subtitles, data tracks)
 */
export function transcodeToMp4(
  srcPath: string,
  dstPath: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  if (!ffmpegPath) {
    return Promise.reject(
      new Error(
        "ffmpeg-static binary not available — installation may have failed",
      ),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath as unknown as string, [
      "-y",
      "-i", srcPath,
      "-map", "0:v?",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "128k",
      dstPath,
    ]);

    // Ring-buffer the last ~4 KB of stderr so we can include it in error
    // messages without hoarding the whole output for long encodes.
    const errChunks: string[] = [];
    let errBytes = 0;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errChunks.push(chunk);
      errBytes += chunk.length;
      while (errBytes > 4096 && errChunks.length > 1) {
        errBytes -= errChunks[0]!.length;
        errChunks.shift();
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`transcode timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const tail = errChunks.join("").trim().split("\n").slice(-6).join("\n");
        reject(new Error(`ffmpeg exit ${code}\n${tail}`));
      }
    });
  });
}
