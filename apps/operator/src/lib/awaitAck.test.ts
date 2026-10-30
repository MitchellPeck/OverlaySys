import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import { AckError, ackErrorText, errorMatches, requestOne, sendAndAwaitAck, type AckClient } from "./awaitAck";
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
    const p = sendAndAwaitAck(c, msg, { op: "save_show", id: "s1" });
    const assertion = expect(p).rejects.toMatchObject({ code: "server_error", message: "save s1: Disk full" });
    c.emit({ type: "error", code: "handler_error", message: "save s1: Disk full" });
    await assertion;
  });
  it("unrelated not_found and handler_error do not reject a pending save", async () => {
    const c = fake();
    let settled = false;
    const p = sendAndAwaitAck(c, msg, { op: "save_show", id: "s1" }).finally(() => (settled = true));
    c.emit({ type: "error", code: "not_found", message: "deck s1 not found" });
    c.emit({ type: "error", code: "handler_error", message: "template t9 failed" });
    c.emit({ type: "error", code: "bad_message", message: "nope" });
    await Promise.resolve();
    expect(settled).toBe(false);
    c.emit({ type: "ack", op: "save_show", id: "s1" });
    await p;
  });
  it("[I5] an op-tagged error of any code rejects with its reason at once", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, { type: "save_deck" } as never, { op: "save_deck", id: "d1" });
    c.emit({ type: "error", code: "invalid", message: "Duplicate slide id", op: "save_deck", id: "d1" });
    await expect(p).rejects.toMatchObject({ code: "server_error", message: "Duplicate slide id" });
    const q = sendAndAwaitAck(c, { type: "delete_template" } as never, { op: "delete_template", id: "t1" });
    c.emit({ type: "error", code: "protected", message: "built in", op: "delete_template", id: "t1" });
    await expect(q).rejects.toMatchObject({ message: "built in" });
  });

  it("[I5] op-tagged errors for another op or id are ignored", async () => {
    const c = fake();
    const p = sendAndAwaitAck(c, { type: "save_deck" } as never, { op: "save_deck", id: "d1" });
    c.emit({ type: "error", code: "invalid", message: "x", op: "save_deck", id: "d2" });
    c.emit({ type: "error", code: "not_found", message: "d1", op: "get_deck", id: "d1" });
    c.emit({ type: "ack", op: "save_deck", id: "d1" });
    await expect(p).resolves.toBeUndefined();
  });

  it("removes listeners and the timer after settle", async () => {
    const c = fake();
    const off = vi.fn();
    const offSt = vi.fn();
    const on = c.on;
    const onStatus = c.onStatus;
    c.on = (l) => {
      const u = on(l);
      return () => (off(), u());
    };
    c.onStatus = (l) => {
      const u = onStatus(l);
      return () => (offSt(), u());
    };
    const p = sendAndAwaitAck(c, msg, { op: "save_show" });
    c.emit({ type: "ack", op: "save_show" });
    await p;
    expect(off).toHaveBeenCalledTimes(1);
    expect(offSt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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

describe("errorMatches for a template save", () => {
  const save = { op: "save_template", id: "t1" };
  it("matches an error tagged with this save", () => {
    expect(errorMatches({ type: "error", code: "invalid", message: "x", op: "save_template", id: "t1" }, save)).toBe(true);
  });
  it("ignores an error from another request or template", () => {
    expect(errorMatches({ type: "error", code: "invalid", message: "x", op: "save_deck", id: "d1" }, save)).toBe(false);
    expect(errorMatches({ type: "error", code: "invalid", message: "x", op: "save_template", id: "t2" }, save)).toBe(false);
  });
  it("ignores an untagged error that doesn't name the template", () => {
    expect(errorMatches({ type: "error", code: "handler_error", message: "boom" }, save)).toBe(false);
  });
});
