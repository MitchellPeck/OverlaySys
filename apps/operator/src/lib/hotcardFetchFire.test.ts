import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import type { Hotcard } from "@overlaysys/core";
import { HOTCARD_FETCH_FIRE_TIMEOUT_MS, changesOnAir, fetchHotcardForFire, type FetchFireClient } from "./hotcardFetchFire";
import type { WsStatus } from "./wsClient";

/** A fake socket whose send() reports to onSend listeners, as WsClient does. */
function fake(status: WsStatus = "open") {
  const msgL = new Set<(m: ServerMessage) => void>();
  const stL = new Set<(s: WsStatus) => void>();
  const sendL = new Set<(m: ClientMessage) => void>();
  const c = {
    status,
    sent: [] as ClientMessage[],
    send: (m: ClientMessage) => {
      sendL.forEach((l) => l(m));
      c.sent.push(m);
    },
    on: (l: (m: ServerMessage) => void) => (msgL.add(l), () => void msgL.delete(l)),
    onStatus: (l: (s: WsStatus) => void) => (stL.add(l), () => void stL.delete(l)),
    onSend: (l: (m: ClientMessage) => void) => (sendL.add(l), () => void sendL.delete(l)),
    getStatus: (): WsStatus => c.status,
    emit: (m: unknown) => msgL.forEach((l) => l(m as ServerMessage)),
    setStatus: (s: WsStatus) => {
      c.status = s;
      stL.forEach((l) => l(s));
    },
  };
  return c satisfies FetchFireClient;
}

const card = (id: string) => ({ id, name: id, templateId: "l3", data: {}, channelHint: "program" }) as unknown as Hotcard;
const take = { type: "take", channel: "program", templateId: "l3", data: {} } as ClientMessage;

describe("fetchHotcardForFire", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks for the card and resolves with it when it arrives", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    expect(c.sent).toEqual([{ type: "get_hotcard", hotcardId: "h1" }]);
    c.emit({ type: "hotcard", hotcard: card("h2") });
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toMatchObject({ id: "h1" });
  });

  it("gives up when another take goes out from this console first", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.send(take);
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toBeNull();
  });

  it("gives up when a clear goes out first", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.send({ type: "clear", channel: "program" });
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toBeNull();
  });

  it("gives up when any channel changes first (another console, Companion)", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.emit({ type: "state", channel: "program", state: { channel: "program", active: null } });
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toBeNull();
  });

  it("is not cancelled by unrelated requests", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.send({ type: "get_template", templateId: "l3" });
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toMatchObject({ id: "h1" });
  });

  it("a newer press supersedes a waiting one", async () => {
    const c = fake();
    const first = fetchHotcardForFire(c, "h1");
    const second = fetchHotcardForFire(c, "h2");
    c.emit({ type: "hotcard", hotcard: card("h1") });
    c.emit({ type: "hotcard", hotcard: card("h2") });
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toMatchObject({ id: "h2" });
  });

  it("gives up after the timeout so the take never lands late", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    vi.advanceTimersByTime(HOTCARD_FETCH_FIRE_TIMEOUT_MS);
    c.emit({ type: "hotcard", hotcard: card("h1") });
    await expect(p).resolves.toBeNull();
  });

  it("gives up on a disconnect", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.setStatus("closed");
    await expect(p).resolves.toBeNull();
  });

  it("gives up at once when not connected", async () => {
    const c = fake("closed");
    await expect(fetchHotcardForFire(c, "h1")).resolves.toBeNull();
  });

  it("gives up when the server says the card is not found", async () => {
    const c = fake();
    const p = fetchHotcardForFire(c, "h1");
    c.emit({ type: "error", code: "not_found", message: "h1", op: "get_hotcard", id: "h1" });
    await expect(p).resolves.toBeNull();
  });
});

describe("changesOnAir", () => {
  it("counts takes, cues and clears of every kind", () => {
    for (const type of ["take", "cue", "clear", "clear_all_channels", "take_pvw_to_pgm", "song_take", "media_take", "slides_take", "scripture_end"]) {
      expect(changesOnAir({ type } as ClientMessage)).toBe(true);
    }
  });
  it("does not count requests and saves", () => {
    for (const type of ["get_hotcard", "get_template", "save_show", "subscribe", "list_shows"]) {
      expect(changesOnAir({ type } as ClientMessage)).toBe(false);
    }
  });
});
