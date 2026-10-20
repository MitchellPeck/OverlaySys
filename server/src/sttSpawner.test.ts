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

describe("sttSpawner stderr protocol", () => {
  it("classifies @@levels, @@error and plain log lines", () => {
    expect(spawner.classifyStderrLine("@@levels 0.50 0.25")).toEqual({
      kind: "levels",
      levels: [0.5, 0.25],
    });
    expect(spawner.classifyStderrLine("@@error Input device 'X' not found")).toEqual({
      kind: "error",
      message: "Input device 'X' not found",
    });
    expect(spawner.classifyStderrLine("[ffmpeg] something")).toEqual({ kind: "log" });
  });

  it("forwards levels, keeps them out of the log, and reports @@error as lastError", async () => {
    const levels: number[][] = [];
    const offLevels = spawner.subscribeLevels((l) => levels.push(l));
    const done = new Promise<void>((resolve) => {
      const off = spawner.subscribe((s) => {
        if (s.state === "error") {
          off();
          resolve();
        }
      });
    });
    spawner.start({
      autoStart: false,
      modelPath: "/none",
      stepMs: 500,
      lengthMs: 5000,
      captureDevice: -1,
      customCommand:
        `echo '@@levels 0.40 0.10' >&2; echo "@@error Input device 'X' not found" >&2; sleep 0.2; exit 1`,
      captureMode: "default",
      channelDevice: "",
      channels: [],
    });
    await done;
    offLevels();
    const st = spawner.getStatus();
    expect(st.lastError).toBe("Input device 'X' not found");
    expect(st.recentLogs.some((l) => l.startsWith("@@levels"))).toBe(false);
    expect(levels).toContainEqual([0.4, 0.1]);
    // Stopping (or a terminal state) clears the meter.
    expect(levels.at(-1)).toEqual([]);
  }, 10_000);
});
