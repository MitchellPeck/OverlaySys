import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckLinkStatus, SignalFormat } from "@overlaysys/core";
import { DeckLinkOutput, STALL_MS, type ChildLike } from "./output";

const FMT: SignalFormat = { id: "t", label: "t", width: 4, height: 2, rate: "60000/1001", fps: 60000 / 1001 };
const FRAME = 4 * 2 * 4;

class FakeChild implements ChildLike {
  writes: { buf: Buffer; cb: (err?: Error | null) => void }[] = [];
  signals: string[] = [];
  exitCode: number | null = null;
  ignoreSignals = false;
  private handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  private stderrFns: ((d: Buffer | string) => void)[] = [];
  stdin = {
    write: (buf: Buffer, cb: (err?: Error | null) => void) => {
      this.writes.push({ buf, cb });
      return true;
    },
    end: () => {},
  };
  stderr = { on: (_e: "data", fn: (d: Buffer | string) => void) => void this.stderrFns.push(fn) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(ev: string, fn: (...a: any[]) => void) {
    (this.handlers[ev] ??= []).push(fn);
    return this;
  }
  kill(sig: NodeJS.Signals = "SIGTERM") {
    this.signals.push(sig);
    if (!this.ignoreSignals || sig === "SIGKILL") this.exit(null, sig);
    return true;
  }
  say(text: string) {
    for (const f of this.stderrFns) f(text);
  }
  exit(code: number | null, signal: string | null = null) {
    if (this.exitCode !== null || this.exited) return;
    this.exited = true;
    this.exitCode = code ?? 1;
    for (const f of this.handlers.exit ?? []) f(code, signal);
  }
  exited = false;
  error(err: NodeJS.ErrnoException) {
    for (const f of this.handlers.error ?? []) f(err);
  }
  completeWrite(i = this.writes.length - 1) {
    this.writes[i]!.cb(null);
  }
}

let children: FakeChild[];
let statuses: DeckLinkStatus[];
let out: DeckLinkOutput;

beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  statuses = [];
  out = new DeckLinkOutput({
    ffmpeg: "/ff",
    device: "Dev",
    format: FMT,
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    onStatus: (s) => statuses.push(s),
    log: () => {},
  });
});
afterEach(() => vi.useRealTimers());

describe("DeckLinkOutput", () => {
  it("writes an opaque black frame first and reports running once it is taken", () => {
    out.start();
    expect(statuses.at(-1)).toEqual({ state: "starting" });
    const c = children[0]!;
    expect(c.writes).toHaveLength(1);
    const black = c.writes[0]!.buf;
    expect(black.length).toBe(FRAME);
    expect([...black.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    c.completeWrite();
    expect(statuses.at(-1)).toEqual({ state: "running" });
    expect(out.framesWritten).toBe(1);
  });

  it("keeps one write in flight and always sends the latest frame", () => {
    out.start();
    const c = children[0]!;
    out.setFrame(Buffer.alloc(FRAME, 1));
    out.setFrame(Buffer.alloc(FRAME, 2));
    expect(c.writes).toHaveLength(1);
    c.completeWrite();
    expect(c.writes).toHaveLength(2);
    expect(c.writes[1]!.buf[0]).toBe(2);
    c.completeWrite();
    expect(c.writes).toHaveLength(3);
    expect(c.writes[2]!.buf[0]).toBe(2);
  });

  it("rejects a frame of the wrong size", () => {
    expect(() => out.setFrame(Buffer.alloc(FRAME - 1))).toThrow();
  });

  it("restarts a card that stops taking frames", () => {
    out.start();
    const c = children[0]!;
    vi.advanceTimersByTime(STALL_MS + 1);
    expect(c.signals).toContain("SIGKILL");
    expect(statuses.at(-1)).toMatchObject({ state: "restarting", code: "stalled", attempt: 1, delayMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(children).toHaveLength(2);
  });

  it("classifies an exit and backs off on repeated failures", () => {
    out.start();
    children[0]!.say("[decklink] Could not enable video output!\n");
    children[0]!.exit(1);
    expect(statuses.at(-1)).toMatchObject({ state: "restarting", code: "device-busy", attempt: 1, delayMs: 1000 });
    vi.advanceTimersByTime(1000);
    children[1]!.exit(1);
    expect(statuses.at(-1)).toMatchObject({ state: "restarting", attempt: 2, delayMs: 2000 });
  });

  it("does not retry when ffmpeg is missing", () => {
    out.start();
    children[0]!.error(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    expect(statuses.at(-1)).toEqual({ state: "failed", code: "ffmpeg-not-found" });
    vi.advanceTimersByTime(60_000);
    expect(children).toHaveLength(1);
  });

  it("does not retry an ffmpeg without DeckLink output", () => {
    out.start();
    children[0]!.say("Unknown output format: 'decklink'\n");
    children[0]!.exit(1);
    expect(statuses.at(-1)).toEqual({ state: "failed", code: "no-decklink" });
  });

  it("stop() escalates SIGTERM to SIGKILL on a wedged ffmpeg and never restarts", async () => {
    out.start();
    const c = children[0]!;
    c.ignoreSignals = true;
    const done = out.stop();
    expect(c.signals).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(c.signals).toEqual(["SIGTERM", "SIGTERM", "SIGTERM"]);
    vi.advanceTimersByTime(1000);
    expect(c.signals.at(-1)).toBe("SIGKILL");
    await done;
    expect(statuses.at(-1)).toEqual({ state: "stopped" });
    vi.advanceTimersByTime(60_000);
    expect(children).toHaveLength(1);
  });

  it("a restarted process starts at a frame boundary with a whole frame", () => {
    out.start();
    out.setFrame(Buffer.alloc(FRAME, 7));
    children[0]!.exit(1);
    vi.advanceTimersByTime(1000);
    expect(children[1]!.writes[0]!.buf.length).toBe(FRAME);
    expect(children[1]!.writes[0]!.buf[0]).toBe(7);
  });
});
