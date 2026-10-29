// One Blackmagic device output: a long-lived ffmpeg that owns the card, fed
// whole BGRA frames on stdin. Free of any `electron` import so it stays
// unit-testable; main.ts feeds it frames from an offscreen window.
//
// Lessons from Narthex TV's playout.py that shape this:
// - The card paces the program: a write completes when the device wants the
//   next frame, so exactly one write is ever in flight and the next one starts
//   from its callback, carrying whatever frame is newest (repeats are fine).
// - A DeckLink that underruns can stop taking frames for good. A write that
//   hasn't completed in STALL_MS means a stuck card: kill and reopen it.
// - An ffmpeg left holding the card blocks every later run, and a wedged one
//   ignores the first SIGTERMs, so stop() escalates to SIGKILL.

import type { DeckLinkErrorCode, DeckLinkStatus, SignalFormat } from "@overlaysys/core";
import { respawnDelayMs } from "../supervisor";
import { buildOutputArgs, classifyFfmpegError } from "./ffmpeg";

/** A card that takes no frame for this long is stuck. */
export const STALL_MS = 5000;
/** Running this long resets the restart backoff. */
const STABLE_MS = 60_000;
const LOG_EVERY_MS = 10_000;
const STDERR_KEEP = 4096;
/** Failures a restart can't fix. */
const NO_RETRY: ReadonlySet<DeckLinkErrorCode> = new Set(["ffmpeg-not-found", "no-decklink"]);

export interface ChildLike {
  stdin: {
    write(buf: Buffer, cb: (err?: Error | null) => void): boolean;
    end?(): void;
    on?(event: "error", fn: (err: Error) => void): unknown;
  } | null;
  stderr: { on(event: "data", fn: (d: Buffer | string) => void): unknown } | null;
  on(event: "exit", fn: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", fn: (err: NodeJS.ErrnoException) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  exitCode: number | null;
}

export type SpawnLike = (cmd: string, args: string[]) => ChildLike;

export interface DeckLinkOutputOptions {
  ffmpeg: string;
  device: string;
  format: SignalFormat;
  spawn: SpawnLike;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onStatus: (s: DeckLinkStatus) => void;
  log: (line: string) => void;
}

export class DeckLinkOutput {
  private readonly frameBytes: number;
  private readonly black: Buffer;
  private frame: Buffer | null = null;
  private child: ChildLike | null = null;
  private stderr = "";
  private inFlight = false;
  private stallTimer: unknown = null;
  private restartTimer: unknown = null;
  private stopping = false;
  private stopWaiters: (() => void)[] = [];
  private killTimers: unknown[] = [];
  private pendingCode: DeckLinkErrorCode | null = null;
  private attempt = 0;
  private runningSince: number | null = null;
  private windowStart = 0;
  private windowFrames = 0;
  private _framesWritten = 0;

  constructor(private readonly o: DeckLinkOutputOptions) {
    this.frameBytes = o.format.width * o.format.height * 4;
    this.black = Buffer.alloc(this.frameBytes);
    for (let i = 3; i < this.frameBytes; i += 4) this.black[i] = 255;
  }

  get framesWritten(): number {
    return this._framesWritten;
  }

  start(): void {
    this.stopping = false;
    this.spawnChild();
  }

  /** The newest frame: exactly width × height × 4 bytes of BGRA. */
  setFrame(frame: Buffer): void {
    if (frame.length !== this.frameBytes) {
      throw new Error(`frame is ${frame.length} bytes, expected ${this.frameBytes}`);
    }
    this.frame = frame;
    this.pump();
  }

  /** Close the card for good; resolves once ffmpeg has exited. */
  stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer !== null) {
      this.o.clearTimer(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) {
      this.o.onStatus({ state: "stopped" });
      return Promise.resolve();
    }
    const done = new Promise<void>((resolve) => this.stopWaiters.push(resolve));
    try {
      child.stdin?.end?.();
    } catch {
      /* already closed */
    }
    child.kill("SIGTERM");
    for (const [ms, sig] of [
      [1000, "SIGTERM"],
      [2000, "SIGTERM"],
      [3000, "SIGKILL"],
    ] as const) {
      this.killTimers.push(
        this.o.setTimer(() => {
          if (this.child === child) child.kill(sig);
        }, ms),
      );
    }
    return done;
  }

  /** Last resort on process exit: no time to wait, free the card now. */
  killNow(): void {
    this.stopping = true;
    this.child?.kill("SIGKILL");
  }

  private status(s: DeckLinkStatus): void {
    this.o.onStatus(s);
  }

  private spawnChild(): void {
    this.restartTimer = null;
    this.stderr = "";
    this.pendingCode = null;
    this.inFlight = false;
    this.runningSince = null;
    this.status({ state: "starting" });
    const child = this.o.spawn(this.o.ffmpeg, buildOutputArgs(this.o.device, this.o.format));
    this.child = child;
    child.stderr?.on("data", (d) => {
      const text = String(d);
      this.o.log(`[decklink] ${this.o.device}: ${text.trimEnd()}`);
      this.stderr = (this.stderr + text).slice(-STDERR_KEEP);
    });
    // A dead or missing ffmpeg turns the next write into EPIPE, emitted on
    // stdin. Unhandled, that would take down the whole desktop app; the exit
    // (or spawn error) handler below is what restarts the output.
    child.stdin?.on?.("error", (err) => {
      this.o.log(`[decklink] ${this.o.device}: pipe closed (${err.message})`);
    });
    child.on("error", (err) => {
      if (this.child !== child) return;
      this.pendingCode = err.code === "ENOENT" ? "ffmpeg-not-found" : "exited";
      this.onExit(child);
    });
    child.on("exit", () => this.onExit(child));
    this.windowStart = this.o.now();
    this.windowFrames = 0;
    this.pump();
  }

  private pump(): void {
    const child = this.child;
    if (!child || !child.stdin || this.inFlight || this.stopping) return;
    this.inFlight = true;
    this.stallTimer = this.o.setTimer(() => this.onStall(child), STALL_MS);
    child.stdin.write(this.frame ?? this.black, (err) => {
      if (this.child !== child) return;
      this.clearStall();
      this.inFlight = false;
      if (err) return; // the exit handler restarts
      this.countFrame();
      this.pump();
    });
  }

  private countFrame(): void {
    this._framesWritten++;
    this.windowFrames++;
    const now = this.o.now();
    if (this.runningSince === null) {
      this.runningSince = now;
      this.status({ state: "running" });
    }
    if (now - this.windowStart >= LOG_EVERY_MS) {
      this.o.log(`[decklink] ${this.o.device}: ${this.windowFrames} frames in ${Math.round((now - this.windowStart) / 1000)}s`);
      this.windowStart = now;
      this.windowFrames = 0;
    }
  }

  private onStall(child: ChildLike): void {
    if (this.child !== child) return;
    this.o.log(`[decklink] ${this.o.device}: the card stopped taking frames; restarting it`);
    this.pendingCode = "stalled";
    child.kill("SIGKILL");
  }

  private clearStall(): void {
    if (this.stallTimer !== null) {
      this.o.clearTimer(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private onExit(child: ChildLike): void {
    if (this.child !== child) return;
    this.child = null;
    this.clearStall();
    this.inFlight = false;
    if (this.stopping) {
      for (const t of this.killTimers) this.o.clearTimer(t);
      this.killTimers = [];
      this.status({ state: "stopped" });
      for (const w of this.stopWaiters.splice(0)) w();
      return;
    }
    const code = this.pendingCode ?? classifyFfmpegError(this.stderr);
    if (NO_RETRY.has(code)) {
      this.status({ state: "failed", code });
      return;
    }
    const now = this.o.now();
    if (this.runningSince !== null && now - this.runningSince >= STABLE_MS) this.attempt = 0;
    this.attempt++;
    const delayMs = respawnDelayMs(this.attempt);
    this.status({ state: "restarting", code, attempt: this.attempt, delayMs });
    this.restartTimer = this.o.setTimer(() => this.spawnChild(), delayMs);
  }
}
