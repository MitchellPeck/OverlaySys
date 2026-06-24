import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSttCommand,
  type SttSpawnerConfig,
  type SttSpawnerStatus,
} from "@overlaysys/core";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
// In dev, the listener lives in the workspace under apps/lyric-listener.
// In packaged Electron, the host sets OVERLAYSYS_LISTENER_PATH to the
// daemon's path inside the app resources bundle.
const LISTENER_PATH = process.env["OVERLAYSYS_LISTENER_PATH"]
  ? path.resolve(process.env["OVERLAYSYS_LISTENER_PATH"])
  : path.resolve(REPO_ROOT, "apps", "lyric-listener", "src", "stdin.mjs");

// macOS GUI apps launched from Finder inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) — Homebrew's whisper-stream lives at
// /opt/homebrew/bin or /usr/local/bin and is invisible without an
// augment. Same on Linux for some XDG-launched apps. Prepend the common
// locations so the user's installed STT binary can be found.
const PATH_AUGMENTS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
];
function buildAugmentedPath(): string {
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

// In packaged Electron there's no system `node` on PATH — only the
// Electron binary at process.execPath, which runs as Node when
// ELECTRON_RUN_AS_NODE=1 is set. Use that binary to invoke the listener
// daemon from the bash pipeline so we don't depend on the user having
// node installed.
const NODE_BIN = process.execPath;

const RECENT_LOG_LIMIT = 100;

let child: ChildProcess | null = null;
let status: SttSpawnerStatus = {
  state: "idle",
  pid: null,
  startedAt: null,
  lastError: null,
  recentLogs: [],
};
let activeConfig: SttSpawnerConfig | null = null;
const listeners = new Set<(s: SttSpawnerStatus) => void>();

function emit(): void {
  // Snapshot the status so subscribers don't share a mutable reference.
  const snap: SttSpawnerStatus = { ...status, recentLogs: status.recentLogs.slice() };
  for (const fn of listeners) fn(snap);
}

function appendLog(line: string): void {
  status.recentLogs.push(line);
  while (status.recentLogs.length > RECENT_LOG_LIMIT) status.recentLogs.shift();
}

export function getStatus(): SttSpawnerStatus {
  return { ...status, recentLogs: status.recentLogs.slice() };
}

export function subscribe(fn: (s: SttSpawnerStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function start(config: SttSpawnerConfig): void {
  if (status.state === "running" || status.state === "starting") return;
  status = {
    state: "starting",
    pid: null,
    startedAt: null,
    lastError: null,
    recentLogs: [],
  };
  activeConfig = config;
  emit();

  // Build the full pipeline. The user's command's stdout gets piped into
  // the stdin daemon. We use bash -c so shell features (|, >, $VAR) work.
  // The listener side uses NODE_BIN (the calling process's binary) instead
  // of relying on `node` being on PATH — important for packaged Electron
  // where there's no system node, only Electron-as-node.
  const userCommand = buildSttCommand(config);
  const fullCommand = `${userCommand} | ${JSON.stringify(NODE_BIN)} ${JSON.stringify(LISTENER_PATH)}`;
  appendLog(`spawn: ${fullCommand}`);

  const augmentedPath = buildAugmentedPath();

  try {
    // Use detached: true so we own a process group and can kill all children
    // (including whisper-stream) with a single process.kill(-pid, SIGTERM).
    const c = spawn("bash", ["-c", fullCommand], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: augmentedPath,
        // ELECTRON_RUN_AS_NODE makes process.execPath behave as a plain
        // Node binary when invoked. Required so the listener daemon
        // launched from the bash pipeline runs as JS, not as a new
        // Electron app instance.
        ELECTRON_RUN_AS_NODE: "1",
      },
      detached: true,
    });
    child = c;
    status = {
      ...status,
      state: "running",
      pid: c.pid ?? null,
      startedAt: Date.now(),
    };
    emit();

    // Capture stderr for logs (whisper init prints there; our daemon also
    // logs to stderr).
    c.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) appendLog(line);
      }
      emit();
    });

    // Capture stdout too — usually empty after the pipe but defensive.
    c.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) appendLog(`[stdout] ${line}`);
      }
      emit();
    });

    c.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit ${code}`;
      appendLog(`child exited: ${reason}`);
      const wasIntentional = status.state === "stopped";
      status = {
        ...status,
        state: wasIntentional ? "stopped" : code === 0 ? "stopped" : "error",
        pid: null,
        lastError:
          wasIntentional || code === 0 ? null : `child exited with ${reason}`,
      };
      child = null;
      emit();
    });

    c.on("error", (err: Error) => {
      appendLog(`child error: ${err.message}`);
      status = {
        ...status,
        state: "error",
        lastError: err.message,
      };
      emit();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`spawn failed: ${msg}`);
    status = {
      state: "error",
      pid: null,
      startedAt: null,
      lastError: msg,
      recentLogs: status.recentLogs,
    };
    child = null;
    emit();
  }
}

export function stop(): void {
  // ALWAYS emit, even when there's no child and the recorded state was
  // already "stopped"/"idle". The operator UI uses the spawner_status
  // broadcast to clear its optimistic "Stopping…" pending state — if we
  // skip the emit on a no-op stop, the UI sits on "Stopping…" forever
  // because no confirmation broadcast ever arrives.
  if (!child) {
    appendLog("stop requested (no active child)");
    status = { ...status, state: "stopped", pid: null };
    emit();
    return;
  }
  appendLog("stop requested");
  // Set state BEFORE killing so the exit handler treats it as intentional.
  status = { ...status, state: "stopped" };
  emit();
  // Kill the whole process group so bash AND whisper-stream both receive SIGTERM.
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* swallow */
    }
  }
}

export function getActiveConfig(): SttSpawnerConfig | null {
  return activeConfig;
}
