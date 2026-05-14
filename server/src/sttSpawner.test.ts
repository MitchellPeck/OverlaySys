import { describe, expect, it } from "vitest";
import * as spawner from "./sttSpawner";

describe("sttSpawner", () => {
  it("starts in idle or stopped state", () => {
    const s = spawner.getStatus();
    expect(["idle", "stopped"]).toContain(s.state);
  });

  it("getStatus returns a fresh snapshot each call", () => {
    const a = spawner.getStatus();
    const b = spawner.getStatus();
    expect(a).not.toBe(b);
    expect(a.recentLogs).not.toBe(b.recentLogs);
  });

  it("subscribe returns an unsubscribe function", () => {
    const off = spawner.subscribe(() => {
      // no-op
    });
    expect(typeof off).toBe("function");
    off(); // should not throw
  });

  it("getCurrentBias is null when no song is active", () => {
    expect(spawner.getCurrentBias()).toBeNull();
  });

  it("setBias is a no-op for the same value", () => {
    spawner.setBias(null);
    expect(spawner.getCurrentBias()).toBeNull();
  });

  it("setBias updates the stored bias", () => {
    spawner.setBias("amazing grace");
    expect(spawner.getCurrentBias()).toBe("amazing grace");
    spawner.setBias(null);
    expect(spawner.getCurrentBias()).toBeNull();
  });
});
