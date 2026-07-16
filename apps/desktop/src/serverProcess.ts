// Reap a server child left behind by a previous desktop session that exited
// without cleaning up — a crash, a force-quit, or SIGKILL, where main.ts's
// before-quit/exit handlers never ran. Such a child gets reparented to
// launchd (PPID 1) and keeps holding the fixed server port (4000), which
// makes EVERY later launch fail to bind it.
//
// The stdin watchdog in the server (OVERLAYSYS_HOST_PIPE) prevents new
// orphans going forward; this is the backstop that clears one that already
// exists (e.g. from a build shipped before the watchdog).
//
// We record each spawned server's PID to <userData>/server.pid and, on the
// next boot, kill whatever PID is in there if it is still alive. Precise by
// construction: we only ever signal a PID we ourselves wrote.

import fs from "node:fs";

/** Read a recorded server PID, or null if the file is missing/garbage. */
export function readPidFile(file: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Record the current server child's PID for the next boot to reap. */
export function writePidFile(file: string, pid: number): void {
  try {
    fs.writeFileSync(file, `${pid}\n`, "utf8");
  } catch {
    /* best-effort — a missing pidfile only weakens the reap backstop */
  }
}

/** Remove the PID record (server exited cleanly — nothing to reap). */
export function clearPidFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Is `pid` a live process we can signal? Uses the signal-0 probe, which
 * checks existence without delivering a signal. Guards non-positive PIDs so
 * we never accidentally probe/target a process group (kill(0, ...) etc).
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM → exists but not ours to signal; still "alive".
    return (err as { code?: string }).code === "EPERM";
  }
}

/**
 * Kill the server recorded from a previous session, if it is still running,
 * so it releases the port before we spawn a fresh one. SIGTERM first, then
 * SIGKILL as a fallback for a wedged process (the observed orphan ignored
 * SIGTERM). Best-effort and synchronous; the server's own ephemeral-port
 * fallback covers any residual bind race.
 */
export function reapPreviousServer(file: string): void {
  const pid = readPidFile(file);
  if (pid !== null && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  clearPidFile(file);
}
