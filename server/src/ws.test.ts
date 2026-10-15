import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import { handleConnection } from "./ws";
import * as channels from "./channels";

/**
 * Minimal stand-in for a `ws` socket: an EventEmitter with the readyState +
 * send surface handleConnection touches. Messages the server sends are
 * decoded into `sent` so tests can assert on the sequence.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
  /** Deliver a client message as the ws library would. */
  async client(msg: unknown): Promise<void> {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
    // handleConnection's listener is async; let it settle.
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

function states(sock: FakeSocket, channel: string) {
  return sock.sent.filter((m) => m.type === "state" && m.channel === channel);
}

describe("ws subscribe", () => {
  it("pushes current state immediately on subscribe", async () => {
    const ch = `t-${Date.now()}-a`;
    channels.take(ch, "tpl", { a: "1" });
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const got = states(sock, ch);
    expect(got).toHaveLength(1);
    expect(got[0]?.type === "state" && got[0].state.active?.templateId).toBe("tpl");
  });

  it("re-pushes current state on a duplicate subscribe instead of going silent", async () => {
    // A mirror renderer that re-subscribes after learning its source (or a
    // client that retries) must be able to resync from the server's copy;
    // a silent no-op leaves it painting whatever it last saw.
    const ch = `t-${Date.now()}-b`;
    channels.take(ch, "tpl", { a: "1" });
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    channels.take(ch, "tpl2", { a: "2" });
    // The live subscription already delivered tpl2; a duplicate subscribe
    // must deliver it once more rather than nothing.
    const before = states(sock, ch).length;
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const after = states(sock, ch);
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1];
    expect(last?.type === "state" && last.state.active?.templateId).toBe("tpl2");
  });

  it("keeps a single live listener per channel across duplicate subscribes", async () => {
    const ch = `t-${Date.now()}-c`;
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const before = states(sock, ch).length;
    channels.take(ch, "tpl", {});
    await new Promise((r) => setImmediate(r));
    // Exactly one delta for the take — not one per subscribe call.
    expect(states(sock, ch).length).toBe(before + 1);
  });
});
