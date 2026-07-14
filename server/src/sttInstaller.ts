// STT presence checker + auto-installer.
//
// Surfaces whether `whisper-stream` is on the user's PATH and whether the
// currently-selected model file exists on disk, then offers WS-driven
// flows for one-click install:
//
//   - whisper.cpp binary install via the platform's package manager
//     (brew on macOS, apt on Debian/Ubuntu, pacman on Arch, winget on
//     Windows). On platforms without an auto-installable package, the
//     UI shows the manual instructions instead.
//
//   - Model downloads from HuggingFace ggerganov/whisper.cpp (or a
//     user-supplied URL) into ~/whisper-models/ with progress streaming.
//
//   - SDL2 capture-device enumeration by spawning `whisper-stream -c -1
//     -m /dev/null` once and parsing the "init: found N capture devices"
//     stderr block — this matches what whisper-stream itself sees, so
//     the indices the UI shows are exactly the indices the user picks.

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs, createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import {
  PRESET_MODELS,
  buildAugmentedPath,
  expandHome,
  type SttBinaryPresence,
  type SttCaptureDevice,
  type SttInstallProgress,
  type SttModelFile,
  type SttPresence,
} from "@overlaysys/core";

// Same augmented PATH set the spawner uses (STT_PATH_AUGMENTS in core) —
// Homebrew on macOS lives at /opt/homebrew/bin which a Finder-launched
// Electron app doesn't see by default.
function augmentedPath(): string {
  return buildAugmentedPath(process.env["PATH"] ?? "", path.delimiter);
}

function augmentedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: augmentedPath() };
}

// ── Models directory ────────────────────────────────────────────────────

/**
 * Where downloaded model files live. Honours OVERLAYSYS_MODELS_DIR so the
 * packaged Electron build can route to a writable userData subpath; in dev
 * we land on ~/whisper-models/ which matches the legacy default command
 * users may already have populated.
 */
export function getModelsDir(): string {
  const override = process.env["OVERLAYSYS_MODELS_DIR"];
  if (override && override.length > 0) return path.resolve(override);
  return path.join(os.homedir(), "whisper-models");
}

async function ensureModelsDir(): Promise<string> {
  const dir = getModelsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * List every .bin file in the models directory plus any preset that isn't
 * on disk yet (so the UI can show "install <name>" for missing presets).
 * Returned entries are de-duplicated by absolute path.
 */
export async function listModels(): Promise<SttModelFile[]> {
  const dir = await ensureModelsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    entries = [];
  }
  const present: SttModelFile[] = [];
  for (const name of entries) {
    if (!name.endsWith(".bin")) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      present.push({
        path: full,
        filename: name,
        sizeBytes: stat.size,
        present: true,
      });
    } catch {
      // skip unreadable entries
    }
  }
  // Surface preset filenames that aren't on disk yet so the UI can offer
  // a one-click download for them too.
  const onDisk = new Set(present.map((m) => m.filename));
  for (const preset of PRESET_MODELS) {
    if (!onDisk.has(preset.filename)) {
      present.push({
        path: path.join(dir, preset.filename),
        filename: preset.filename,
        sizeBytes: null,
        present: false,
      });
    }
  }
  // Stable sort: present-first, then by filename.
  present.sort((a, b) => {
    if (a.present !== b.present) return a.present ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });
  return present;
}

/**
 * Resolve a possibly-tilde-prefixed model path and stat it. Used by the
 * presence check to report whether the user's currently-selected model
 * is actually on disk.
 */
async function statModel(modelPath: string): Promise<SttModelFile> {
  const resolved = path.resolve(expandHome(modelPath));
  const filename = path.basename(resolved);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      return { path: resolved, filename, sizeBytes: stat.size, present: true };
    }
  } catch {
    /* fall through */
  }
  return { path: resolved, filename, sizeBytes: null, present: false };
}

// ── Binary presence ─────────────────────────────────────────────────────

/**
 * Locate `whisper-stream` on the augmented PATH. Returns its absolute path
 * if found, otherwise null.
 *
 * Intentionally lightweight: we used to spawn `whisper-stream -h` to fish
 * out a version string from the GGML banner, but that triggers a full Metal
 * + audio-device init (~500MB RAM, ~3s on Apple Silicon) just to label
 * "Installed" — and on Macs it would race the real spawner for the audio
 * device. `which` plus a direct file-existence check on the common Homebrew
 * paths is enough; the UI only needs "is it there?" not "what version?"
 */
export async function checkBinary(): Promise<SttBinaryPresence> {
  // Fast path: probe a known set of canonical install locations directly.
  // Saves the whole `which` subprocess on the common case (Homebrew).
  const candidates = [
    "/opt/homebrew/bin/whisper-stream",
    "/usr/local/bin/whisper-stream",
    "/usr/bin/whisper-stream",
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return { path: candidate, version: null };
    } catch {
      // skip missing
    }
  }
  // Fallback: ask the system. Augmented PATH includes Homebrew dirs so this
  // catches non-canonical installs (e.g. /opt/local on MacPorts).
  const which = await runOnce("which", ["whisper-stream"], 2000);
  const raw = which.stdout.trim().split("\n")[0] ?? "";
  if (!raw) return { path: null, version: null };
  return { path: raw, version: null };
}

async function detectPackageManager(): Promise<SttPresence["packageManager"]> {
  const plat = process.platform;
  if (plat === "darwin") {
    return (await runOnce("which", ["brew"])).stdout.trim() ? "brew" : null;
  }
  if (plat === "linux") {
    if ((await runOnce("which", ["apt"])).stdout.trim()) return "apt";
    if ((await runOnce("which", ["pacman"])).stdout.trim()) return "pacman";
    return null;
  }
  if (plat === "win32") {
    return (await runOnce("where", ["winget"])).stdout.trim() ? "winget" : null;
  }
  return null;
}

/**
 * Whole-system presence check: binary + the selected model file. The UI
 * calls this once on page load and again after every install/download
 * completes so the status banner stays accurate.
 */
export async function checkPresence(modelPath: string): Promise<SttPresence> {
  const [binary, selectedModel, packageManager] = await Promise.all([
    checkBinary(),
    statModel(modelPath),
    detectPackageManager(),
  ]);
  const plat = process.platform;
  const platform: SttPresence["platform"] =
    plat === "darwin" || plat === "linux" || plat === "win32" ? plat : "other";
  return { binary, selectedModel, platform, packageManager };
}

// ── Capture device enumeration ──────────────────────────────────────────

// Cached result of the last whisper-stream enumeration probe. The probe is
// heavy (loads BLAS+Metal+ggml backends AND opens the default audio device),
// so we run it at most once per server lifetime unless the caller explicitly
// passes force=true to refresh. The in-flight promise short-circuits racing
// callers — a page that fires three "enumerate" messages in quick succession
// gets one spawn, not three.
let cachedDevices: SttCaptureDevice[] | null = null;
let inFlightEnumeration: Promise<SttCaptureDevice[]> | null = null;

/**
 * List SDL2 capture devices as whisper-stream sees them.
 *
 * Implementation: whisper-stream prints
 *
 *     init: found 3 capture devices:
 *     init:    - Capture device #0: 'MacBook Pro Microphone'
 *     init:    - Capture device #1: 'NDI Audio'
 *     init: ...
 *
 * to stderr before attempting to load the model. We feed it a guaranteed-
 * nonexistent model so it bails out right after enumeration. Even so, the
 * spawn loads ~500MB of backends and momentarily holds the default audio
 * device — so this is gated behind:
 *
 *   1. **Cache** — first successful result is reused for the server's lifetime
 *      so subsequent UI clicks return instantly.
 *
 *   2. **Single-flight** — concurrent callers await the same in-flight probe
 *      instead of spawning duplicates that contend for the audio device.
 *
 *   3. **Opt-in** — the UI no longer enumerates on page mount; it only runs
 *      this when the user clicks "rescan" or opens the device dropdown.
 *
 * Pass `force: true` to bypass the cache. Pass `probe: false` to forbid
 * spawning whisper-stream entirely (return the cache or a bare "System
 * default") — used when the real spawner is running so we never contend for
 * the capture device.
 */
export async function enumerateCaptureDevices(
  opts: { force?: boolean; probe?: boolean } = {},
): Promise<SttCaptureDevice[]> {
  if (!opts.force && cachedDevices) return cachedDevices;
  // Caller forbade spawning a probe (spawner is live). Return whatever we
  // already know without touching the audio device.
  if (opts.probe === false) {
    return cachedDevices ?? [{ id: -1, name: "System default" }];
  }
  if (inFlightEnumeration) return inFlightEnumeration;

  inFlightEnumeration = (async (): Promise<SttCaptureDevice[]> => {
    try {
      if (!(await checkBinary()).path) {
        const fallback: SttCaptureDevice[] = [
          { id: -1, name: "System default" },
        ];
        cachedDevices = fallback;
        return fallback;
      }
      const devices = await probeDevicesStreaming();
      cachedDevices = devices;
      return devices;
    } finally {
      inFlightEnumeration = null;
    }
  })();

  return inFlightEnumeration;
}

/**
 * The in-flight device-enumeration probe, if one is running, else null. The
 * spawner-start path awaits this so it never launches whisper-stream while
 * the probe still holds (or is loading toward) the capture device.
 */
export function enumerationInFlight(): Promise<SttCaptureDevice[]> | null {
  return inFlightEnumeration;
}

/**
 * Spawn whisper-stream and parse its stderr live, killing the process the
 * moment we have the full device list — BEFORE it gets to
 * `SDL_OpenAudioDevice`, which would briefly grab the user's mic and block
 * a real spawner-start from succeeding.
 *
 * The order whisper-stream prints to stderr is:
 *
 *   1. backend loads (~2-3s on Apple Silicon, lots of lines)
 *   2. `init: found N capture devices:`
 *   3. N × `init:    - Capture device #X: 'name'`
 *   4. `init: attempt to open default capture device ...`   ← we kill BEFORE this
 *   5. SDL_OpenAudioDevice grabs the mic
 *
 * We watch for lines (2) and (3), kill once we have all N entries, and the
 * real spawner can start cleanly afterward. If the binary's output format
 * ever changes, we fall through to a hard 12s timeout and return whatever
 * we managed to collect.
 */
function probeDevicesStreaming(): Promise<SttCaptureDevice[]> {
  return new Promise((resolve) => {
    const bogusModel = path.join(
      os.tmpdir(),
      `overlaysys-enumprobe-${Date.now()}.bin`,
    );
    const devices: SttCaptureDevice[] = [
      { id: -1, name: "System default" },
    ];
    let expectedCount: number | null = null;
    let buffer = "";
    let settled = false;

    const child = spawn(
      "whisper-stream",
      ["-c", "-1", "-m", bogusModel],
      { env: augmentedEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );

    const finish = (): void => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
      clearTimeout(hardTimeout);
      resolve(devices);
    };

    const hardTimeout = setTimeout(finish, 12_000);

    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // Process completed lines only — partial lines might be split across
      // chunks. Leave the trailing fragment in the buffer.
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // Header tells us how many entries to expect.
        const hdr = /found\s+(\d+)\s+capture devices/i.exec(line);
        if (hdr) {
          expectedCount = Number(hdr[1]);
          continue;
        }
        const m = /Capture device #(\d+):\s*'([^']*)'/.exec(line);
        if (m) {
          const id = Number(m[1]);
          const name = m[2] ?? "";
          if (Number.isFinite(id) && name) devices.push({ id, name });
          // Once we've collected the expected number of entries, kill the
          // probe before it tries to open audio.
          if (
            expectedCount !== null &&
            devices.length - 1 >= expectedCount
          ) {
            finish();
            return;
          }
        }
        // Belt-and-suspenders: if for some reason we miss the count header
        // (output format change), kill the moment whisper-stream announces
        // it's about to open the device. SDL_OpenAudioDevice runs right
        // after this fprintf, so there's a tiny race but it's the best we
        // can do without parsing all output.
        if (/attempt to open/i.test(line)) {
          finish();
          return;
        }
      }
    });

    child.on("exit", finish);
    child.on("error", finish);
  });
}

// ── Install jobs ────────────────────────────────────────────────────────

/**
 * Active jobs (binary install + model downloads) keyed by their jobId.
 * Subscribers receive every progress update for every job — the UI filters
 * on whichever jobId it's interested in.
 */
const jobListeners = new Set<(p: SttInstallProgress) => void>();
const activeJobs = new Map<string, { abort: () => void; last: SttInstallProgress }>();

export function subscribeInstall(fn: (p: SttInstallProgress) => void): () => void {
  jobListeners.add(fn);
  // Replay last-known state of each active job so a new subscriber gets
  // an immediate snapshot without waiting for the next progress tick.
  for (const j of activeJobs.values()) fn(j.last);
  return () => {
    jobListeners.delete(fn);
  };
}

function emitProgress(p: SttInstallProgress): void {
  const entry = activeJobs.get(p.jobId);
  if (entry) entry.last = p;
  for (const fn of jobListeners) fn(p);
}

export function cancelInstall(jobId: string): boolean {
  const entry = activeJobs.get(jobId);
  if (!entry) return false;
  entry.abort();
  return true;
}

export function listActiveJobs(): SttInstallProgress[] {
  return Array.from(activeJobs.values(), (j) => j.last);
}

// ── Binary install ──────────────────────────────────────────────────────

/**
 * Auto-install the whisper.cpp binary via the detected package manager.
 * Returns the jobId the UI subscribes to for progress updates. Throws if
 * no package manager is available (the UI should fall back to manual
 * install instructions in that case).
 */
export function installBinary(): string {
  const jobId = "binary";
  if (activeJobs.has(jobId)) return jobId;
  const plat = process.platform;
  let cmd: string;
  let args: string[];
  if (plat === "darwin") {
    cmd = "brew";
    args = ["install", "whisper-cpp"];
  } else if (plat === "linux") {
    cmd = "sh";
    args = [
      "-c",
      "if command -v apt >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y whisper.cpp; elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm whisper.cpp; else echo 'no supported package manager' >&2; exit 1; fi",
    ];
  } else if (plat === "win32") {
    cmd = "winget";
    args = ["install", "--id", "ggerganov.whisper.cpp", "--silent", "--accept-package-agreements", "--accept-source-agreements"];
  } else {
    throw new Error(`Auto-install not supported on ${plat}`);
  }

  const initial: SttInstallProgress = {
    jobId,
    state: "running",
    progress: null,
    bytesDownloaded: null,
    bytesTotal: null,
    message: `running: ${cmd} ${args.join(" ")}`,
    error: null,
  };
  let cancelled = false;
  let child: ChildProcess | null = null;
  activeJobs.set(jobId, {
    abort: () => {
      cancelled = true;
      try {
        child?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
    last: initial,
  });
  emitProgress(initial);

  try {
    child = spawn(cmd, args, {
      env: augmentedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const done: SttInstallProgress = {
      ...initial,
      state: "error",
      message: msg,
      error: msg,
    };
    activeJobs.delete(jobId);
    emitProgress(done);
    return jobId;
  }

  let lastLine = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lastLine = line.trim();
    }
    emitProgress({ ...initial, message: lastLine });
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lastLine = line.trim();
    }
    emitProgress({ ...initial, message: lastLine });
  });
  child.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    activeJobs.delete(jobId);
    emitProgress({
      ...initial,
      state: "error",
      message: msg,
      error: msg,
    });
  });
  child.on("exit", (code, signal) => {
    activeJobs.delete(jobId);
    if (cancelled || signal === "SIGTERM") {
      emitProgress({
        ...initial,
        state: "cancelled",
        message: "cancelled",
      });
      return;
    }
    if (code === 0) {
      emitProgress({
        ...initial,
        state: "done",
        progress: 1,
        message: "installed",
      });
    } else {
      const err = `exit code ${code ?? "?"}: ${lastLine || "install failed"}`;
      emitProgress({
        ...initial,
        state: "error",
        message: err,
        error: err,
      });
    }
  });

  return jobId;
}

// ── Binary uninstall ────────────────────────────────────────────────────

/**
 * Uninstall the whisper.cpp binary via the detected package manager. Uses
 * the same job-tracking machinery as `installBinary` (jobId="binary") so
 * the UI's existing progress card surfaces uninstall status too.
 *
 * Throws if no auto-uninstallable package manager is available — the UI
 * should suppress the Uninstall button entirely in that case.
 */
export function uninstallBinary(): string {
  const jobId = "binary";
  if (activeJobs.has(jobId)) return jobId;
  const plat = process.platform;
  let cmd: string;
  let args: string[];
  if (plat === "darwin") {
    cmd = "brew";
    args = ["uninstall", "whisper-cpp"];
  } else if (plat === "linux") {
    cmd = "sh";
    args = [
      "-c",
      "if command -v apt >/dev/null 2>&1; then sudo apt-get remove -y whisper.cpp; elif command -v pacman >/dev/null 2>&1; then sudo pacman -R --noconfirm whisper.cpp; else echo 'no supported package manager' >&2; exit 1; fi",
    ];
  } else if (plat === "win32") {
    cmd = "winget";
    args = ["uninstall", "--id", "ggerganov.whisper.cpp", "--silent"];
  } else {
    throw new Error(`Auto-uninstall not supported on ${plat}`);
  }

  const initial: SttInstallProgress = {
    jobId,
    state: "running",
    progress: null,
    bytesDownloaded: null,
    bytesTotal: null,
    message: `running: ${cmd} ${args.join(" ")}`,
    error: null,
  };
  let cancelled = false;
  let child: ChildProcess | null = null;
  activeJobs.set(jobId, {
    abort: () => {
      cancelled = true;
      try {
        child?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
    last: initial,
  });
  emitProgress(initial);

  try {
    child = spawn(cmd, args, {
      env: augmentedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    activeJobs.delete(jobId);
    emitProgress({ ...initial, state: "error", message: msg, error: msg });
    return jobId;
  }

  let lastLine = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lastLine = line.trim();
    }
    emitProgress({ ...initial, message: lastLine });
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lastLine = line.trim();
    }
    emitProgress({ ...initial, message: lastLine });
  });
  child.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    activeJobs.delete(jobId);
    emitProgress({ ...initial, state: "error", message: msg, error: msg });
  });
  child.on("exit", (code, signal) => {
    activeJobs.delete(jobId);
    if (cancelled || signal === "SIGTERM") {
      emitProgress({ ...initial, state: "cancelled", message: "cancelled" });
      return;
    }
    if (code === 0) {
      emitProgress({
        ...initial,
        state: "done",
        progress: 1,
        message: "uninstalled",
      });
    } else {
      const err = `exit code ${code ?? "?"}: ${lastLine || "uninstall failed"}`;
      emitProgress({ ...initial, state: "error", message: err, error: err });
    }
  });

  return jobId;
}

// ── Model delete ────────────────────────────────────────────────────────

/**
 * Delete a downloaded model file from the managed models dir.
 *
 * Safety rails:
 *   - filename must end in .bin (refuses arbitrary files)
 *   - filename must not contain path separators or `..` (no traversal)
 *   - resolved absolute path MUST be inside `getModelsDir()` (defence in
 *     depth even if a future change weakens the filename validation)
 *
 * Returns the resolved path that was deleted. Throws if validation fails
 * or the file isn't present. Caller is responsible for stopping the
 * spawner first if the file is in active use; this function does NOT
 * stop the spawner because that would race with concurrent UI actions.
 */
export async function deleteModel(filename: string): Promise<string> {
  if (!filename.endsWith(".bin")) {
    throw new Error("filename must end with .bin");
  }
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("filename must not contain path separators");
  }
  const dir = path.resolve(getModelsDir());
  const target = path.resolve(path.join(dir, filename));
  // Belt-and-suspenders: the filename sanitisation above already prevents
  // traversal, but verify the resolved path is still under the models dir
  // before unlinking. Trailing separator protects against the prefix-match
  // pitfall ("/foo/models-evil" passing a check for "/foo/models").
  const dirPrefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (target !== dir && !target.startsWith(dirPrefix)) {
    throw new Error("refusing to delete outside the models directory");
  }
  await fs.unlink(target);
  return target;
}

/**
 * Download a whisper.cpp ggml model file into the managed models dir.
 *
 * `filename` controls the on-disk name (must end in .bin). For presets
 * from PRESET_MODELS the caller passes the canonical filename so the next
 * `listModels()` recognises it; for custom URLs the caller can derive a
 * sensible filename from the URL or accept user input.
 *
 * Supports HTTP and HTTPS, transparently follows redirects (HuggingFace
 * redirects from /resolve/main/ to a CDN). Progress is reported via the
 * shared install-job channel — the jobId is the filename.
 */
export function downloadModel(url: string, filename: string): string {
  if (!filename.endsWith(".bin")) {
    throw new Error("filename must end with .bin");
  }
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("filename must not contain path separators");
  }
  const jobId = filename;
  if (activeJobs.has(jobId)) return jobId;

  const dest = path.join(getModelsDir(), filename);
  const tmp = `${dest}.${randomUUID()}.part`;
  let cancelled = false;
  let req: http.ClientRequest | null = null;
  let stream: WriteStream | null = null;

  const initial: SttInstallProgress = {
    jobId,
    state: "running",
    progress: null,
    bytesDownloaded: 0,
    bytesTotal: null,
    message: `downloading ${url}`,
    error: null,
  };
  activeJobs.set(jobId, {
    abort: () => {
      cancelled = true;
      try {
        req?.destroy(new Error("cancelled"));
      } catch {
        /* ignore */
      }
      try {
        stream?.destroy();
      } catch {
        /* ignore */
      }
    },
    last: initial,
  });
  emitProgress(initial);

  void (async () => {
    try {
      await ensureModelsDir();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      activeJobs.delete(jobId);
      emitProgress({ ...initial, state: "error", message: msg, error: msg });
      return;
    }
    try {
      stream = createWriteStream(tmp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      activeJobs.delete(jobId);
      emitProgress({ ...initial, state: "error", message: msg, error: msg });
      return;
    }

    let total: number | null = null;
    let received = 0;
    let lastEmit = 0;

    const onComplete = (): void => {
      stream?.end(() => {
        if (cancelled) {
          fs.unlink(tmp).catch(() => {});
          activeJobs.delete(jobId);
          emitProgress({ ...initial, state: "cancelled", message: "cancelled" });
          return;
        }
        fs.rename(tmp, dest)
          .then(() => {
            activeJobs.delete(jobId);
            emitProgress({
              jobId,
              state: "done",
              progress: 1,
              bytesDownloaded: received,
              bytesTotal: total,
              message: `saved ${path.basename(dest)} (${humanBytes(received)})`,
              error: null,
            });
          })
          .catch((err: Error) => {
            activeJobs.delete(jobId);
            emitProgress({
              ...initial,
              state: "error",
              message: err.message,
              error: err.message,
            });
          });
      });
    };
    const onError = (err: Error): void => {
      try {
        stream?.destroy();
      } catch {
        /* ignore */
      }
      fs.unlink(tmp).catch(() => {});
      activeJobs.delete(jobId);
      if (cancelled) {
        emitProgress({ ...initial, state: "cancelled", message: "cancelled" });
      } else {
        emitProgress({
          ...initial,
          state: "error",
          message: err.message,
          error: err.message,
        });
      }
    };

    const fetch = (target: string, redirects: number): void => {
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const lib = parsed.protocol === "http:" ? http : https;
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        onError(new Error(`unsupported URL protocol: ${parsed.protocol}`));
        return;
      }
      req = lib.get(
        target,
        { headers: { "User-Agent": "OverlaySys-Desktop" } },
        (res) => {
          // Follow up to 5 redirects (HuggingFace bounces through CDN).
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= 5) {
              onError(new Error("too many redirects"));
              res.resume();
              return;
            }
            res.resume();
            fetch(new URL(res.headers.location, target).toString(), redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            onError(new Error(`HTTP ${res.statusCode ?? "?"} from ${target}`));
            res.resume();
            return;
          }
          const lenHeader = res.headers["content-length"];
          if (typeof lenHeader === "string") {
            const n = Number(lenHeader);
            if (Number.isFinite(n)) total = n;
          }
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            stream?.write(chunk);
            // Throttle progress emissions to ~5/sec so we don't flood the
            // WS connection on fast LAN downloads.
            const now = Date.now();
            if (now - lastEmit >= 200) {
              lastEmit = now;
              emitProgress({
                jobId,
                state: "running",
                progress: total ? received / total : null,
                bytesDownloaded: received,
                bytesTotal: total,
                message: total
                  ? `${humanBytes(received)} / ${humanBytes(total)}`
                  : `${humanBytes(received)} downloaded`,
                error: null,
              });
            }
          });
          res.on("end", onComplete);
          res.on("error", onError);
        },
      );
      req.on("error", onError);
    };
    fetch(url, 0);
  })();

  return jobId;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface ProcResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a child process and capture all of its stdout/stderr. Used for
 * one-shot probes (which/help/device enumeration). Errors during spawn
 * resolve as an empty-stdout result rather than throwing so callers can
 * write straight-line "if (stdout) {...}" checks.
 */
function runOnce(cmd: string, args: string[], timeoutMs = 5000): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    };
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        env: augmentedEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      settle(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      settle(null);
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      settle(null);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      settle(code);
    });
  });
}
