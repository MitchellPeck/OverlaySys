import { describe, expect, it, beforeEach } from "vitest";
import * as listener from "./sttListener";

describe("sttListener", () => {
  beforeEach(() => {
    // Cleanup: disconnect any registered listeners
    for (const l of listener.list()) listener.disconnect(l.audioSourceId);
  });

  it("starts with no listeners", () => {
    expect(listener.list()).toEqual([]);
  });

  it("register adds an online listener", () => {
    listener.register("aud-1", "Studio Mic");
    const l = listener.list()[0];
    expect(l).toBeDefined();
    expect(l!.audioSourceId).toBe("aud-1");
    expect(l!.label).toBe("Studio Mic");
    expect(l!.online).toBe(true);
  });

  it("register is idempotent (upsert)", () => {
    listener.register("aud-1", "First");
    listener.register("aud-1", "Renamed");
    expect(listener.list()).toHaveLength(1);
    expect(listener.list()[0]!.label).toBe("Renamed");
  });

  it("disconnect flips online to false but keeps the entry", () => {
    listener.register("aud-1");
    listener.disconnect("aud-1");
    expect(listener.list()[0]!.online).toBe(false);
  });

  it("markHypothesisReceived updates lastSeen", async () => {
    listener.register("aud-1");
    const first = listener.list()[0]!.lastSeen;
    await new Promise((r) => setTimeout(r, 5));
    listener.markHypothesisReceived("aud-1");
    expect(listener.list()[0]!.lastSeen).toBeGreaterThan(first);
  });

  it("subscribe receives updates on register/disconnect", () => {
    const events: number[] = [];
    const off = listener.subscribe((listeners) => events.push(listeners.length));
    listener.register("aud-1");
    listener.disconnect("aud-1");
    off();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("hypotheses don't re-broadcast the list every time", () => {
    listener.register("aud-2");
    const events: number[] = [];
    const off = listener.subscribe((ls) => events.push(ls.length));
    const t0 = Date.now() + 60_000;
    listener.markHypothesisReceived("aud-2", t0);
    const afterFirst = events.length;
    for (let i = 1; i <= 20; i++) listener.markHypothesisReceived("aud-2", t0 + i * 100);
    expect(events.length).toBe(afterFirst);
    listener.markHypothesisReceived("aud-2", t0 + listener.LAST_SEEN_NOTIFY_MS + 1);
    expect(events.length).toBe(afterFirst + 1);
    off();
  });

  it("disconnect of an already-offline listener doesn't notify", () => {
    listener.register("aud-3");
    listener.disconnect("aud-3");
    const events: number[] = [];
    const off = listener.subscribe((ls) => events.push(ls.length));
    listener.disconnect("aud-3");
    expect(events).toEqual([]);
    off();
  });
});
