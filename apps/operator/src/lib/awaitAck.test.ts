import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import { AckError, ackErrorText, requestOne, sendAndAwaitAck, type AckClient } from "./awaitAck";
import type { WsStatus } from "./wsClient";

function fake(status: WsStatus = "open") {
  const msgL = new Set<(m: ServerMessage) => void>();
  const stL = new Set<(s: WsStatus) => void>();
  const c = {
    status,
    send: vi.fn((_m: ClientMessage) => {}),
    on: (l: (m: ServerMessage) => void) => (msgL.add(l), () => void msgL.delete(l)),
    onStatus: (l: (s: WsStatus) => void) => (stL.add(l), () => void stL.delete(l)),
    getStatus: (): WsStatus => c.status,
    emit: (m: unknown) => msgL.forEach((l) => l(m as ServerMessage)),
    setStatus: (s: WsStatus) => {
      c.status = s;
      stL.forEach((l) => l(s));
    },
  };
  return c satisfies AckClient;
}
const msg = { type: "save_show" } as unknown as ClientMessage;

describe("awaitAck", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves on the matching ack", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, msg, { op: "save_show", id: "s1" });
    c.emit({ type: "ack", op: "save_show", id: "s1" });
    await expect(p).resolves.toBeUndefined();
  });
  it("ignores an ack for another id", async () => {
    const c = fake();
    let settled = false;
    const p = sendAndAwaitAck(c, msg, { op: "save_show", id: "s1" }).finally(() => (settled = true));
    c.emit({ type: "ack", op: "save_show", id: "s2" });
    await Promise.resolve();
    expect(settled).toBe(false);
    c.emit({ type: "ack", op: "save_show", id: "s1" });
    await p;
  });
  it("rejects at once with not_connected when closed", async () => {
    const c = fake("closed");
    await expect(sendAndAwaitAck(c, msg, { op: "save_show" })).rejects.toMatchObject({ code: "not_connected" });
    expect(c.send).not.toHaveBeenCalled();
  });
  it("rejects with disconnected when status leaves open", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, msg, { op: "save_show" });
    const assertion = expect(p).rejects.toMatchObject({ code: "disconnected" });
    c.setStatus("closed");
    await assertion;
  });
  it("rejects with timeout", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, msg, { op: "save_show" });
    const assertion = expect(p).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
  it("rejects with server_error carrying the server message", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, msg, { op: "save_show" });
    const assertion = expect(p).rejects.toMatchObject({ code: "server_error", message: "Disk full" });
    c.emit({ type: "error", code: "handler_error", message: "Disk full" });
    await assertion;
  });
  it("requestOne returns the picked payload", async () => {
    const c = fake();
    const p = requestOne(c, msg, (m) => ((m as { type: string }).type === "show" ? (m as unknown as { show: { id: string } }).show : undefined));
    c.emit({ type: "pong", t: 1 });
    c.emit({ type: "show", show: { id: "a" } });
    await expect(p).resolves.toEqual({ id: "a" });
  });
  it("an ack match without id resolves on the first ack for that op", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, msg, { op: "stt_config" });
    c.emit({ type: "ack", op: "stt_config" });
    await expect(p).resolves.toBeUndefined();
  });
  it("ackErrorText", () => {
    expect(ackErrorText(new AckError("timeout"))).toBe("The server didn't confirm in time.");
    expect(ackErrorText(new AckError("not_connected"))).toBe("Not connected to the server.");
    expect(ackErrorText(new AckError("disconnected"))).toBe("Disconnected before the server confirmed.");
  });
});
