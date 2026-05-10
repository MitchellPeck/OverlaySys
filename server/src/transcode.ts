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

/**
 * What the upload pipeline should do with a given video source.
 *   - `passthrough`: already web-safe, store verbatim (final ext = source ext)
 *   - `h264-mp4`: opaque non-web-safe → transcode to MP4/H.264 (final ext = .mp4)
 *   - `vp9-webm-alpha`: source has an alpha channel → transcode to VP9/WebM
 *     with yuva420p so transparency survives (final ext = .webm)
 *
 * H.264 cannot carry alpha at all. VP9-in-WebM is the only widely-supported
 * web container that does, and it decodes natively in Chromium (which is
 * what OBS Browser Source and the Electron renderer use).
 */
export type TranscodeKind = "passthrough" | "h264-mp4" | "vp9-webm-alpha";

export type TranscodePlan = {
  kind: TranscodeKind;
  finalExt: string;
};

export async function planTranscode(
  srcPath: string,
  srcExt: string,
): Promise<TranscodePlan> {
  const ext = srcExt.toLowerCase();
  // Probe for alpha first, regardless of source extension. Even a `.mov` with
  // ProRes 4444 alpha needs to become WebM to render in `<video>`; even a
  // `.mp4` could theoretically be alpha (rare but possible).
  const pixFmt = await probePixFmt(srcPath).catch(() => null);
  const hasAlpha = !!pixFmt && pixFmtHasAlpha(pixFmt);

  if (hasAlpha) return { kind: "vp9-webm-alpha", finalExt: ".webm" };
  if (WEB_SAFE_EXTS.has(ext)) return { kind: "passthrough", finalExt: ext };
  return { kind: "h264-mp4", finalExt: ".mp4" };
}

function pixFmtHasAlpha(pix: string): boolean {
  // Pixel-format names containing alpha: yuva*, bgra, rgba, argb, abgr,
  // ya*, gbrap, ayuv, etc. Conservative substring match — false positives
  // are harmless (we'd just preserve alpha in a video that didn't need it),
  // false negatives strip transparency.
  return /^(yuva|bgra|rgba|argb|abgr|ya[0-9]|gbrap|ayuv)/i.test(pix);
}

/**
 * Run ffmpeg with `-i` only and no output — it prints stream info to stderr
 * before erroring out with "Output file ... was not found". Parse the
 * stream line for the video pixel format. Returns null if no video stream
 * or if the parse fails.
 *
 * Cheaper than adding ffprobe-static as a separate dependency.
 */
function probePixFmt(srcPath: string): Promise<string | null> {
  if (!ffmpegPath) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    const child = spawn(ffmpegPath as unknown as string, [
      "-hide_banner",
      "-i", srcPath,
    ]);
    let err = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      err += d;
    });
    child.on("close", () => {
      // Example lines we want to match:
      //   "Stream #0:0: Video: prores (4ap4 / 0x34706134), yuva444p10le, 1920x1080..."
      //   "Stream #0:0(eng): Video: h264 (High), yuv420p(tv, bt709), 1920x1080..."
      // Capture the token immediately after "Video: <codec...>, " up to the
      // next comma or open-paren, ignoring any "(...)" appended to it.
      const m = err.match(/Stream\s+#\S+:\s*Video:[^,]+,\s*([a-z0-9]+)/i);
      resolve(m?.[1] ?? null);
    });
    child.on("error", () => resolve(null));
  });
}

/**
 * Spawn ffmpeg with the given args. Resolves on exit code 0, rejects with
 * the ffmpeg stderr tail on non-zero exit or with a timeout error if the
 * process runs longer than `timeoutMs`. Shared by all transcode entry points.
 */
function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  if (!ffmpegPath) {
    return Promise.reject(
      new Error(
        "ffmpeg-static binary not available — installation may have failed",
      ),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath as unknown as string, args);

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

/**
 * Transcode `srcPath` to H.264/AAC MP4 at `dstPath`. Use for opaque video.
 * H.264 cannot carry alpha — use `transcodeToWebmAlpha` for transparent
 * sources.
 *
 * Args explained:
 *   -y               overwrite existing dst
 *   -i <src>         input
 *   -map 0:v?/0:a?   pass through video and audio if present (skip subs/data)
 *   -c:v libx264     widely-supported video codec
 *   -preset fast     reasonable speed/size tradeoff for short clips
 *   -pix_fmt yuv420p required for browser <video> compatibility
 *   -movflags +faststart   put moov atom up front so playback can start before download finishes
 *   -c:a aac -b:a 128k     re-encode audio to a web-safe codec
 */
export function transcodeToMp4(
  srcPath: string,
  dstPath: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  return runFfmpeg(
    [
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
    ],
    timeoutMs,
  );
}

/**
 * Transcode `srcPath` to VP9/Opus WebM at `dstPath`, preserving the alpha
 * channel via `yuva420p`. Use for video sources that have transparency
 * (probed via pixel format).
 *
 * Args explained:
 *   -c:v libvpx-vp9         VP9 encoder (the one that supports alpha)
 *   -pix_fmt yuva420p       4:2:0 chroma + alpha plane
 *   -auto-alt-ref 0         REQUIRED for VP9 alpha — alt-refs are incompatible
 *                           with the alpha track and produce a transparent
 *                           or corrupted output silently if left enabled
 *   -row-mt 1               row-based multithreading for faster encode
 *   -b:v 0 -crf 30          constant-quality mode; 30 is a reasonable default
 *                           for graphics overlays (lower = bigger + sharper)
 *   -c:a libopus -b:a 96k   web-safe audio codec
 */
export function transcodeToWebmAlpha(
  srcPath: string,
  dstPath: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  return runFfmpeg(
    [
      "-y",
      "-i", srcPath,
      "-map", "0:v?",
      "-map", "0:a?",
      "-c:v", "libvpx-vp9",
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-row-mt", "1",
      "-b:v", "0",
      "-crf", "30",
      "-c:a", "libopus",
      "-b:a", "96k",
      dstPath,
    ],
    timeoutMs,
  );
}
