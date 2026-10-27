import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import { handleConnection } from "./ws";
import * as channels from "./channels";
import * as channelConfigs from "./channelConfigs";
import * as stageState from "./stageState";
import * as timers from "./timers";
import * as pcoLiveSync from "./pco/pcoLiveSync";

// Timer handlers and the liveRow hooks that live in ws.ts.

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
  async client(msg: unknown): Promise<void> {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
    await new Promise((r) => setImmediate(r));
  }
}

const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return silentLog;
  },
} as unknown as Parameters<typeof handleConnection>[2];

function connect(): FakeSocket {
  const sock = new FakeSocket();
  handleConnection(sock as never, {} as never, silentLog);
  return sock;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

afterEach(() => {
  vi.restoreAllMocks();
  // Not _resetForTest(): it would drop the listeners ws.ts registered at import.
  for (const t of timers.getTimers()) timers.dispatchTimers({ type: "delete", id: t.id });
});

describe("ws timer_* handlers", () => {
  const lastTimers = (sock: FakeSocket) =>
    sock.sent.filter((m): m is Extract<ServerMessage, { type: "timers_state" }> => m.type === "timers_state").at(-1);

  it("timer_create broadcasts a timers_state containing the new timer", async () => {
    const sock = connect();
    await sock.client({ type: "timer_create", label: "Sermon", mode: "countdown", durationMs: 60_000, overtime: true });
    const msg = lastTimers(sock);
    expect(msg?.timers).toEqual([
      expect.objectContaining({ label: "Sermon", mode: "countdown", durationMs: 60_000, source: "manual", anchor: null }),
    ]);
  });

  it("start, adjust and pause route to dispatchTimers and are reflected in the broadcast", async () => {
    const sock = connect();
    await sock.client({ type: "timer_create", label: "Up", mode: "countup", overtime: false });
    const id = timers.getTimers()[0]!.id;
    const spy = vi.spyOn(timers, "dispatchTimers");
    await sock.client({ type: "timer_start", id });
    await sock.client({ type: "timer_adjust", id, deltaMs: 5_000 });
    await sock.client({ type: "timer_pause", id });
    expect(spy).toHaveBeenCalledWith({ type: "start", id });
    expect(spy).toHaveBeenCalledWith({ type: "adjust", id, deltaMs: 5_000 });
    expect(spy).toHaveBeenCalledWith({ type: "pause", id });
    expect(lastTimers(sock)?.timers[0]?.pausedAt).toEqual(expect.any(Number));
  });

  it("resume, reset and delete route to dispatchTimers", async () => {
    const sock = connect();
    const spy = vi.spyOn(timers, "dispatchTimers");
    await sock.client({ type: "timer_resume", id: "x" });
    await sock.client({ type: "timer_reset", id: "x" });
    await sock.client({ type: "timer_delete", id: "x" });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      { type: "resume", id: "x" },
      { type: "reset", id: "x" },
      { type: "delete", id: "x" },
    ]);
  });
});

describe("ws onLiveRow hooks", () => {
  const SRC = { showId: "show-a", rowId: "row-1" };

  function spies(syncShow: string | null) {
    vi.spyOn(channelConfigs, "listChannelConfigs").mockResolvedValue([]);
    vi.spyOn(channelConfigs, "getChannelConfig").mockResolvedValue(null);
    vi.spyOn(timers, "onRowTaken").mockResolvedValue(undefined);
    return {
      notes: vi.spyOn(stageState, "onRowTaken").mockResolvedValue(undefined),
      stop: vi.spyOn(pcoLiveSync, "stopLiveSync").mockImplementation(() => {}),
      get: vi.spyOn(pcoLiveSync, "getLiveSyncShowId").mockReturnValue(syncShow),
    };
  }

  it("a preview take does nothing", async () => {
    const s = spies("show-b");
    channels.setLiveRow("preview", SRC);
    await flush();
    expect(s.notes).not.toHaveBeenCalled();
    expect(s.stop).not.toHaveBeenCalled();
    expect(timers.onRowTaken).not.toHaveBeenCalled();
  });

  it("a take of the synced show keeps sync running", async () => {
    const s = spies("show-a");
    channels.setLiveRow("program", SRC);
    await flush();
    expect(s.stop).not.toHaveBeenCalled();
  });

  it("only a take of a different show stops sync", async () => {
    const s = spies("show-b");
    channels.setLiveRow("program", SRC);
    await flush();
    expect(s.stop).toHaveBeenCalledTimes(1);
  });

  it("with no sync running nothing is stopped", async () => {
    const s = spies(null);
    channels.setLiveRow("program", SRC);
    await flush();
    expect(s.stop).not.toHaveBeenCalled();
  });

  it("sermon notes only follow takes on a stage-followed channel", async () => {
    const s = spies(null);
    channels.setLiveRow("lower-thirds", SRC);
    await flush();
    expect(s.notes).not.toHaveBeenCalled();
    channels.setLiveRow("program", SRC);
    await flush();
    expect(s.notes).toHaveBeenCalledTimes(1);
    expect(s.notes).toHaveBeenCalledWith(SRC);
  });
});
