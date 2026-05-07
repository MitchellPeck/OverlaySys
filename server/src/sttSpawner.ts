import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type SttSpawnerConfig, type SttSpawnerStatus } from "@overlaysys/core";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
// In dev, the listener lives in the workspace under apps/lyric-listener.
// In packaged Electron, the host sets OVERLAYSYS_LISTENER_PATH to the
// daemon's path inside the app resources bundle.
const LISTENER_PATH = process.env["OVERLAYSYS_LISTENER_PATH"]
  ? path.resolve(process.env["OVERLAYSYS_LISTENER_PATH"])
  : path.resolve(REPO_ROOT, "apps", "lyric-listener", "src", "stdin.mjs");

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
  const fullCommand = `${config.command} | node ${JSON.stringify(LISTENER_PATH)}`;
  appendLog(`spawn: ${fullCommand}`);

  try {
    // Use detached: true so we own a process group and can kill all children
    // (including whisper-stream) with a single process.kill(-pid, SIGTERM).
    const c = spawn("bash", ["-c", fullCommand], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
  if (!child) {
    if (status.state !== "idle" && status.state !== "stopped") {
      status = { ...status, state: "stopped", pid: null };
      emit();
    }
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
