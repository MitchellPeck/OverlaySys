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
  expandHome,
  type SttBinaryPresence,
  type SttCaptureDevice,
  type SttInstallProgress,
  type SttModelFile,
  type SttPresence,
} from "@overlaysys/core";

// Same augmented PATH set the spawner uses — Homebrew on macOS lives at
// /opt/homebrew/bin which a Finder-launched Electron app doesn't see by
// default. Keep these in sync with sttSpawner.PATH_AUGMENTS.
const PATH_AUGMENTS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
];

function augmentedPath(): string {
  const existing = (process.env["PATH"] ?? "").split(path.delimiter);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...PATH_AUGMENTS, ...existing]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(path.delimiter);
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
 * plus a best-effort version string parsed from the --help banner (the
 * help output prints the build's ggml backend lines but no explicit version
 * tag, so we settle for the first non-empty diagnostic line). The version
 * field is best-effort — the UI uses it only to disambiguate "installed"
 * from "installed but old".
 */
export async function checkBinary(): Promise<SttBinaryPresence> {
  const which = await runOnce("which", ["whisper-stream"]);
  const raw = which.stdout.trim().split("\n")[0] ?? "";
  if (!raw) return { path: null, version: null };
  // Probe the help banner to fish out a backend line as a stand-in for
  // version (whisper-stream has no --version). Short timeout so a hung
  // binary doesn't wedge the UI.
  let version: string | null = null;
  const help = await runOnce("whisper-stream", ["-h"], 3000);
  // The first line that mentions "backend" or "ggml_metal" is a good
  // proxy for "this is a working whisper.cpp binary".
  const sig = help.stderr.split("\n").find((l) => /backend|ggml/i.test(l));
  if (sig) version = sig.trim();
  return { path: raw, version };
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
 * nonexistent model so it bails out cheaply right after enumeration. The
 * full call cost on an M-series Mac is ~100ms (mostly SDL/Metal init).
 *
 * The `-1` sentinel is prepended to the result so the UI can show
 * "System default" as the first option without special-casing.
 */
export async function enumerateCaptureDevices(): Promise<SttCaptureDevice[]> {
  if (!(await checkBinary()).path) {
    // Binary missing — nothing we can enumerate. The caller falls back
    // to showing only the "System default" entry.
    return [{ id: -1, name: "System default" }];
  }
  const bogusModel = path.join(os.tmpdir(), `overlaysys-enumprobe-${Date.now()}.bin`);
  const { stderr } = await runOnce(
    "whisper-stream",
    ["-c", "-1", "-m", bogusModel],
    8000,
  );
  const devices: SttCaptureDevice[] = [{ id: -1, name: "System default" }];
  // Regex matches lines like "init:    - Capture device #2: 'NDI Audio'".
  // The label is single-quoted by whisper-stream; we strip the quotes.
  const re = /Capture device #(\d+):\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const id = Number(m[1]);
    const name = m[2] ?? "";
    if (Number.isFinite(id) && name) devices.push({ id, name });
  }
  return devices;
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

// ── Model download ──────────────────────────────────────────────────────

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
