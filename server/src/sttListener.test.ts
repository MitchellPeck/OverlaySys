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
});
