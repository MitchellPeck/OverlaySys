import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAugmentedPath as buildAugmentedPathCore,
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

// The set of PATH augments (Homebrew dirs etc.) lives in @overlaysys/core so
// the installer/presence checker resolves whisper-stream identically. See
// STT_PATH_AUGMENTS there.
function buildAugmentedPath(): string {
  return buildAugmentedPathCore(process.env["PATH"] ?? "", path.delimiter);
}

// In packaged Electron there's no system `node` on PATH — only the
// Electron binary at process.execPath, which runs as Node when
// ELECTRON_RUN_AS_NODE=1 is set. Use that binary to invoke the listener
// daemon from the bash pipeline so we don't depend on the user having
// node installed.
const NODE_BIN = process.execPath;

const RECENT_LOG_LIMIT = 100;

// Coalesce log-driven status broadcasts. whisper-stream (and the listener
// daemon) are chatty on stderr — emitting a full status snapshot per line
// floods every connected client and janks the operator UI. State TRANSITIONS
// (starting/running/stopped/error) still emit immediately; only log-append
// churn is throttled to at most one broadcast per window.
const LOG_EMIT_THROTTLE_MS = 500;

// How long to wait for a readiness signal before assuming the child is up.
// Covers custom commands (cloud STT etc.) whose output we can't pattern-match
// and any whisper output-format drift. If the child dies first, the exit
// handler reports the error instead.
const READY_FALLBACK_MS = 4000;

// After the previous child exits, wait briefly before relaunching on a
// restart so whisper-stream/SDL fully releases the capture device. Without
// this, a rapid stop→start races the dying process for the mic and the new
// instance fails to open audio ("rarely starts").
const RESTART_COOLDOWN_MS = 600;

// Lines that indicate whisper-stream has reached the point of acquiring the
// mic / is ready to listen. Once we see one we flip starting→running. These
// are best-effort across whisper.cpp versions — the READY_FALLBACK_MS timer
// flips to "running" anyway if none ever match (e.g. a custom command), so
// correctness never depends on the exact wording here.
const READY_RE =
  /\[start speaking\]|start speaking|processing \d+ samples|attempt to open .*capture device/i;

let child: ChildProcess | null = null;
let status: SttSpawnerStatus = {
  state: "idle",
  pid: null,
  startedAt: null,
  lastError: null,
  recentLogs: [],
};
let activeConfig: SttSpawnerConfig | null = null;
// WS URL the listener daemon should dial back to. Set by the server once its
// actual (possibly ephemeral) port is bound — WITHOUT this the listener falls
// back to its hardcoded ws://localhost:4000 default, so any server not on port
// 4000 silently receives zero hypotheses and STT looks completely dead even
// though whisper-stream is happily running.
let listenerWsUrl: string | null = null;
// Config queued while the previous child is still shutting down. The exiting
// child's handler picks this up and relaunches after the cooldown.
let pendingStart: SttSpawnerConfig | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
let logEmitTimer: ReturnType<typeof setTimeout> | null = null;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: SttSpawnerStatus) => void>();

function emit(): void {
  // A state transition supersedes any queued log-only emit.
  if (logEmitTimer) {
    clearTimeout(logEmitTimer);
    logEmitTimer = null;
  }
  // Snapshot the status so subscribers don't share a mutable reference.
  const snap: SttSpawnerStatus = { ...status, recentLogs: status.recentLogs.slice() };
  for (const fn of listeners) fn(snap);
}

// Coalesced emit for log churn — schedules at most one broadcast per window.
function scheduleLogEmit(): void {
  if (logEmitTimer) return;
  logEmitTimer = setTimeout(() => {
    logEmitTimer = null;
    const snap: SttSpawnerStatus = {
      ...status,
      recentLogs: status.recentLogs.slice(),
    };
    for (const fn of listeners) fn(snap);
  }, LOG_EMIT_THROTTLE_MS);
}

function clearReadyTimer(): void {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
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

/**
 * Tell the spawner which WS URL to hand the listener daemon (via its WS_URL
 * env var) so it dials back to THIS server rather than its hardcoded default.
 * Call this once the server's real port is known. Takes effect on the next
 * start(); a spawner already running keeps its current listener.
 */
export function setListenerWsUrl(url: string): void {
  listenerWsUrl = url;
}

// Flip starting→running once the child is confirmed listening (readiness
// marker or fallback timer). No-op if we've already left "starting".
function markReady(): void {
  clearReadyTimer();
  if (status.state !== "starting") return;
  status = { ...status, state: "running", startedAt: Date.now() };
  emit();
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

  // If the previous child is still alive (e.g. a rapid stop→start), don't
  // spawn a competing whisper-stream that would fight it for the mic. Queue
  // the launch; the exiting child's handler relaunches after a cooldown.
  if (child) {
    appendLog("start queued — waiting for previous child to exit");
    pendingStart = config;
    scheduleLogEmit();
    return;
  }
  launch(config);
}

function launch(config: SttSpawnerConfig): void {
  // Build the full pipeline. The user's command's stdout gets piped into
  // the stdin daemon. We use bash -c so shell features (|, >, $VAR) work.
  // The listener side uses NODE_BIN (the calling process's binary) instead
  // of relying on `node` being on PATH — important for packaged Electron
  // where there's no system node, only Electron-as-node.
  const userCommand = buildSttCommand(config);
  const fullCommand = `${userCommand} | ${JSON.stringify(NODE_BIN)} ${JSON.stringify(LISTENER_PATH)}`;
  appendLog(`spawn: ${fullCommand}`);

  const augmentedPath = buildAugmentedPath();

  let c: ChildProcess;
  try {
    // Use detached: true so we own a process group and can kill all children
    // (including whisper-stream) with a single process.kill(-pid, SIGTERM).
    c = spawn("bash", ["-c", fullCommand], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: augmentedPath,
        // ELECTRON_RUN_AS_NODE makes process.execPath behave as a plain
        // Node binary when invoked. Required so the listener daemon
        // launched from the bash pipeline runs as JS, not as a new
        // Electron app instance.
        ELECTRON_RUN_AS_NODE: "1",
        // Point the listener daemon at THIS server. Without it the daemon
        // dials its hardcoded ws://localhost:4000 default and, on any other
        // port, silently delivers zero hypotheses. Falls back to any WS_URL
        // already in the environment when the server hasn't set one.
        ...(listenerWsUrl ? { WS_URL: listenerWsUrl } : {}),
      },
      detached: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`spawn failed: ${msg}`);
    status = { ...status, state: "error", pid: null, startedAt: null, lastError: msg };
    child = null;
    emit();
    return;
  }

  child = c;
  // Stay in "starting" — we don't claim "running" until the child is actually
  // listening. This keeps the operator's status pill honest: a whisper-stream
  // that dies during model/audio init a second later never briefly shows green.
  status = { ...status, state: "starting", pid: c.pid ?? null, startedAt: null };
  emit();

  // Fallback: if no readiness marker arrives (custom command, format drift)
  // but the child is still alive, treat it as running.
  clearReadyTimer();
  readyTimer = setTimeout(markReady, READY_FALLBACK_MS);

  // Capture stderr for logs (whisper init prints there; our daemon also
  // logs to stderr) and watch for the readiness marker.
  c.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    let ready = false;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      appendLog(line);
      if (!ready && READY_RE.test(line)) ready = true;
    }
    if (ready) markReady();
    else scheduleLogEmit();
  });

  // Capture stdout too — usually empty after the pipe but defensive.
  c.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) appendLog(`[stdout] ${line}`);
    }
    scheduleLogEmit();
  });

  // Both 'exit' and 'error' are terminal for a child. Node emits 'error'
  // WITHOUT a following 'exit' when a process fails to spawn, so each handler
  // must be able to finalize on its own — otherwise a spawn error would leave
  // `child` dangling and wedge every future start() in the pendingStart path.
  // `finalize` runs at most once per child (guarded by `c === child`, which it
  // nulls out) and is the single place that either relaunches a queued restart
  // or publishes the terminal state.
  const finalize = (opts: {
    code: number | null;
    signal: NodeJS.Signals | null;
    errorMsg: string | null;
  }): void => {
    if (c !== child) return; // already finalized, or superseded
    child = null;
    clearReadyTimer();
    const reason = opts.errorMsg
      ? `error ${opts.errorMsg}`
      : opts.signal
        ? `signal ${opts.signal}`
        : `exit ${opts.code}`;
    appendLog(`child ended: ${reason}`);

    // A restart was queued while this child was shutting down. Don't publish
    // a terminal state — relaunch after the cooldown so the device is free.
    if (pendingStart) {
      const next = pendingStart;
      pendingStart = null;
      scheduleLogEmit();
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        launch(next);
      }, RESTART_COOLDOWN_MS);
      return;
    }

    const wasIntentional = status.state === "stopped";
    const cleanExit = opts.errorMsg === null && opts.code === 0;
    status = {
      ...status,
      state: wasIntentional ? "stopped" : cleanExit ? "stopped" : "error",
      pid: null,
      lastError:
        wasIntentional || cleanExit ? null : `child ${reason}`,
    };
    emit();
  };

  c.on("exit", (code, signal) => finalize({ code, signal, errorMsg: null }));
  c.on("error", (err: Error) =>
    finalize({ code: null, signal: null, errorMsg: err.message }),
  );
}

export function stop(): void {
  // Cancel any queued restart / cooldown so a stop always wins.
  pendingStart = null;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  clearReadyTimer();

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

/**
 * Kill any leftover STT listener pipelines from a previous server instance
 * that exited ungracefully (SIGKILL, crash, power loss) — cases where the
 * exit handlers never ran, so a detached whisper-stream is still holding the
 * capture device. An orphan on the mic makes the next start fail to open
 * audio and die ("mic flickers then reverts"), intermittently.
 *
 * We match on the listener daemon's path, which is unique to our pipeline in
 * both dev and packaged builds (…/apps/lyric-listener/src/stdin.mjs). Killing
 * the listener node process breaks the pipe, so the upstream whisper-stream
 * dies on its next write (SIGPIPE) and releases the device. Best-effort: if
 * `pkill` is absent this is a no-op. Run once at boot, before any start.
 */
export function reapOrphans(): void {
  try {
    const p = spawn("pkill", ["-f", "lyric-listener/src/stdin.mjs"], {
      stdio: "ignore",
    });
    // pkill exits 1 when nothing matched — swallow so it never surfaces.
    p.on("error", () => {});
  } catch {
    /* pkill unavailable — nothing we can do */
  }
}

/**
 * Synchronously tear down the child process group. For use in process-exit
 * handlers ONLY — it does the bare minimum (send SIGTERM to the group) with no
 * timers, awaits, or broadcasts, since the 'exit' event allows only sync work.
 *
 * This is what prevents orphaned whisper-stream processes from surviving a
 * server restart (e.g. `tsx watch` reloading on a code change) and holding the
 * capture device — an orphan holding the mic makes the NEXT start's whisper
 * load for a few seconds, fail to open audio, and die ("mic flickers then
 * reverts"). Because the child is spawned detached (its own process group), it
 * would otherwise outlive us.
 */
export function shutdown(): void {
  pendingStart = null;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  if (logEmitTimer) {
    clearTimeout(logEmitTimer);
    logEmitTimer = null;
  }
  clearReadyTimer();
  const c = child;
  child = null;
  if (c?.pid) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      try {
        c.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}
