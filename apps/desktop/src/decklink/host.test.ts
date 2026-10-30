import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckLinkOutputPref } from "@overlaysys/core";

// ── Fakes for electron and child_process ────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    windows: [] as FakeWin[],
    children: [] as FakeChild[],
    /** What `-sinks decklink` prints; a function lets a test change it over time. */
    sinks: (): { out: string; err: (Error & { code?: string; killed?: boolean }) | null } => ({
      out: "Auto-detected sinks for decklink:\n  112:a [UltraStudio] (none)\n  113:b [Other] (none)\n",
      err: null,
    }),
    listDelayMs: 0,
    childIgnoresKill: false,
    /** ffmpeg runs (listing or version) so far. */
    execCalls: 0,
  };
  class FakeWin {
    loaded: string[] = [];
    destroyed = false;
    handlers: Record<string, (() => void)[]> = {};
    webContents = { setFrameRate: () => {}, on: () => {} };
    constructor() {
      state.windows.push(this);
    }
    on(ev: string, fn: () => void) {
      (this.handlers[ev] ??= []).push(fn);
    }
    loadURL(u: string) {
      this.loaded.push(u);
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      for (const f of this.handlers.closed ?? []) f();
    }
  }
  class FakeChild {
    exitCode: number | null = null;
    exitFns: (() => void)[] = [];
    errorFns: ((err: Error & { code?: string }) => void)[] = [];
    stdin = { write: (_b: Buffer, _cb: () => void) => true, end: () => {}, on: () => {} };
    stderr = { on: () => {} };
    constructor() {
      state.children.push(this);
    }
    on(ev: string, fn: () => void) {
      if (ev === "exit") this.exitFns.push(fn);
      if (ev === "error") this.errorFns.push(fn);
      return this;
    }
    /** The binary vanished between listing and spawning. */
    failToSpawn() {
      for (const f of this.errorFns) f(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    }
    kill() {
      if (state.childIgnoresKill) return true;
      if (this.exitCode === null) {
        this.exitCode = 0;
        for (const f of this.exitFns) f();
      }
      return true;
    }
  }
  return { state, FakeWin, FakeChild };
});

vi.mock("electron", () => ({ BrowserWindow: h.FakeWin }));
vi.mock("node:child_process", () => ({
  spawn: () => new h.FakeChild(),
  execFile: (_cmd: string, args: string[], _o: unknown, cb: (err: unknown, out: string, errOut: string) => void) => {
    h.state.execCalls++;
    const r = args.includes("-version") ? { out: "ffmpeg version test", err: null } : h.state.sinks();
    if (h.state.listDelayMs > 0) setTimeout(() => cb(r.err, r.out, ""), h.state.listDelayMs);
    else queueMicrotask(() => cb(r.err, r.out, ""));
  },
}));

import { createDeckLinkHost } from "./host";

const A: DeckLinkOutputPref = { device: { name: "UltraStudio" }, format: "1080p59.94" };
const B: DeckLinkOutputPref = { device: { name: "Other" }, format: "1080p59.94" };

let events: { channelId: string; state: string; code?: string }[];
let openChanges: [string, boolean][];
let host: ReturnType<typeof createDeckLinkHost>;
let port = 4000;
let ffSetting: string | undefined;
let existing: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  h.state.windows = [];
  h.state.children = [];
  h.state.listDelayMs = 0;
  h.state.childIgnoresKill = false;
  h.state.execCalls = 0;
  ffSetting = "/ff/ffmpeg";
  existing = new Set(["/ff/ffmpeg"]);
  h.state.sinks = () => ({ out: "Auto-detected sinks for decklink:\n  112:a [UltraStudio] (none)\n  113:b [Other] (none)\n", err: null });
  events = [];
  openChanges = [];
  port = 4000;
  host = createDeckLinkHost({
    rendererUrl: (id, label) => `http://127.0.0.1:${port}/renderer/?channel=${id}&label=${label}`,
    attachAutoReload: () => {},
    notify: (ev) => {
      if (ev.kind === "decklink-status") {
        const s = ev.status as { state: string; code?: string };
        events.push({ channelId: ev.channelId, state: s.state, ...(s.code ? { code: s.code } : {}) });
      }
    },
    ffmpegSetting: () => ffSetting,
    stat: (p) => (existing.has(p) ? { isFile: () => true } : null),
    onOpenChange: (id, open) => openChanges.push([id, open]),
  });
});
afterEach(() => vi.useRealTimers());

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("DeckLink host — opens and closes in order (I3)", () => {
  it("a close issued while the open is still listing devices wins", async () => {
    h.state.listDelayMs = 3000;
    void host.open("stage", A);
    void host.close("stage");
    await settle(10_000);
    expect(host.isOpen("stage")).toBe(false);
    expect(h.state.children).toHaveLength(0);
  });

  it("switching device mid-open ends on the new device", async () => {
    h.state.listDelayMs = 3000;
    void host.open("stage", A);
    void host.open("stage", B, { force: true });
    await settle(10_000);
    expect(host.isOpen("stage")).toBe(true);
    expect(h.state.windows.at(-1)!.loaded.at(-1)).toContain("label=Other");
    expect(h.state.windows.filter((w) => !w.destroyed)).toHaveLength(1);
  });

  it("a format change reopens the output; the same pref does not", async () => {
    await host.open("stage", A);
    await settle();
    await host.open("stage", A);
    expect(h.state.windows).toHaveLength(1);
    await host.open("stage", { ...A, format: "other" });
    expect(h.state.windows).toHaveLength(2);
    expect(h.state.windows[0]!.destroyed).toBe(true);
  });
});

describe("DeckLink host — robustness", () => {
  it("retries a device that isn't there yet at launch (I5)", async () => {
    let attached = false;
    h.state.sinks = () => ({
      out: attached ? "Auto-detected sinks for decklink:\n  112:a [UltraStudio] (none)\n" : "Auto-detected sinks for decklink:\n",
      err: null,
    });
    await host.open("stage", A);
    expect(events.at(-1)).toMatchObject({ state: "restarting", code: "device-not-found" });
    attached = true;
    await settle(1100);
    expect(host.isOpen("stage")).toBe(true);
  });

  it("stops retrying a missing device once the output is closed", async () => {
    h.state.sinks = () => ({ out: "Auto-detected sinks for decklink:\n", err: null });
    await host.open("stage", A);
    await host.close("stage");
    h.state.sinks = () => ({ out: "Auto-detected sinks for decklink:\n  112:a [UltraStudio] (none)\n", err: null });
    await settle(60_000);
    expect(host.isOpen("stage")).toBe(false);
  });

  it("a close finishes even when ffmpeg won't die (M1)", async () => {
    await host.open("stage", A);
    h.state.childIgnoresKill = true;
    const done = host.close("stage");
    await settle(5000);
    await expect(done).resolves.toBeUndefined();
    expect(openChanges.at(-1)).toEqual(["stage", false]);
  });

  it("reports a bad ffmpeg path as an ffmpeg problem, not a missing device (M5)", async () => {
    h.state.sinks = () => ({ out: "", err: Object.assign(new Error("spawn EACCES"), { code: "EACCES" }) });
    const r = await (async () => {
      const p = host.listDevices();
      await settle();
      return p;
    })();
    expect(r).toMatchObject({ ok: false, code: "ffmpeg-not-found" });
  });

  it("reloads device renderers on the server's new port (I2)", async () => {
    await host.open("stage", A);
    port = 5123;
    host.reloadAll();
    expect(h.state.windows[0]!.loaded.at(-1)).toContain("127.0.0.1:5123");
  });
});

describe("DeckLink host — recovering from a failure a restart can't fix (D5)", () => {
  it("closes an output whose ffmpeg vanished, and reopening starts it again", async () => {
    await host.open("stage", A);
    h.state.children[0]!.failToSpawn();
    await settle();
    expect(events.at(-1)).toMatchObject({ state: "failed", code: "ffmpeg-not-found" });
    expect(host.isOpen("stage")).toBe(false);
    expect(h.state.windows[0]!.destroyed).toBe(true);
    expect(openChanges.at(-1)).toEqual(["stage", false]);

    await host.open("stage", A);
    expect(host.isOpen("stage")).toBe(true);
    expect(h.state.children).toHaveLength(2);
    expect(h.state.windows.filter((w) => !w.destroyed)).toHaveLength(1);
  });

  it("retries failed outputs when asked (the ffmpeg path changed)", async () => {
    h.state.sinks = () => ({ out: "", err: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) });
    await host.open("stage", A);
    expect(events.at(-1)).toMatchObject({ state: "failed", code: "ffmpeg-not-found" });
    h.state.sinks = () => ({ out: "Auto-detected sinks for decklink:\n  112:a [UltraStudio] (none)\n", err: null });
    await host.retryFailed();
    expect(host.isOpen("stage")).toBe(true);
  });

  it("leaves running and closed outputs alone on a retry", async () => {
    await host.open("stage", A);
    await host.open("lobby", B);
    await host.close("lobby");
    await host.retryFailed();
    expect(h.state.windows).toHaveLength(2);
    expect(host.isOpen("stage")).toBe(true);
    expect(host.isOpen("lobby")).toBe(false);
  });
});

describe("DeckLink host — the stored ffmpeg path is checked before it runs", () => {
  it("refuses a stored path that isn't ffmpeg without running it", async () => {
    ffSetting = "/bin/sh";
    existing.add("/bin/sh");
    await host.open("stage", A);
    expect(h.state.execCalls).toBe(0);
    expect(h.state.children).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ state: "failed", code: "ffmpeg-not-found" });
  });

  it("refuses a stored path with nothing there", async () => {
    ffSetting = "/gone/ffmpeg";
    const r = await host.listDevices();
    expect(r).toMatchObject({ ok: false, code: "ffmpeg-not-found" });
    expect(h.state.execCalls).toBe(0);
  });
});
