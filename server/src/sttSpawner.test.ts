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

});
