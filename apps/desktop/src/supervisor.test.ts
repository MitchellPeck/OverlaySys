import { describe, expect, it } from "vitest";
import {
  RateLimiter,
  ReloadBackoff,
  isRecoverableLoadFailure,
  respawnDelayMs,
  shouldReloadAfterGone,
} from "./supervisor";
import { outputsOnRemovedDisplays } from "./displayGuard";

describe("respawnDelayMs", () => {
  it("doubles from 1s and caps", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => respawnDelayMs(n))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
  it("treats attempt < 1 as the first attempt", () => {
    expect(respawnDelayMs(0)).toBe(1000);
  });
});

describe("RateLimiter", () => {
  it("allows max events per window, then refuses until they age out", () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.tryAcquire(0)).toBe(true);
    expect(rl.tryAcquire(1000)).toBe(true);
    expect(rl.tryAcquire(2000)).toBe(true);
    expect(rl.tryAcquire(3000)).toBe(false);
    expect(rl.tryAcquire(60_001)).toBe(true);
  });
  it("reset clears history", () => {
    const rl = new RateLimiter(1, 60_000);
    rl.tryAcquire(0);
    rl.reset();
    expect(rl.tryAcquire(1)).toBe(true);
    expect(rl.count(2)).toBe(1);
  });
});

describe("ReloadBackoff (D8)", () => {
  const MIN = 60_000;
  it("reloads up to 3 times a minute, then waits a minute instead of giving up", () => {
    const b = new ReloadBackoff();
    expect(b.failed(0)).toEqual({ reload: true });
    expect(b.failed(1000)).toEqual({ reload: true });
    expect(b.failed(2000)).toEqual({ reload: true });
    expect(b.failed(3000)).toEqual({ reload: false, attempt: 1, delayMs: MIN });
  });

  it("doubles the wait each time the window keeps crashing, capped at 10 minutes", () => {
    const b = new ReloadBackoff();
    let now = 0;
    const waits: number[] = [];
    for (let round = 0; round < 6; round++) {
      // Crash on every load until the burst budget runs out.
      for (;;) {
        const d = b.failed(now);
        now += 1000;
        if (!d.reload) {
          waits.push(d.delayMs);
          now += d.delayMs;
          b.retrying(now);
          break;
        }
      }
    }
    expect(waits).toEqual([MIN, 2 * MIN, 4 * MIN, 8 * MIN, 10 * MIN, 10 * MIN]);
  });

  it("the retry after a wait counts toward the next burst", () => {
    const b = new ReloadBackoff();
    for (const t of [0, 1, 2]) b.failed(t);
    expect(b.failed(3)).toMatchObject({ reload: false, attempt: 1 });
    b.retrying(MIN + 3);
    expect(b.failed(MIN + 10)).toEqual({ reload: true });
    expect(b.failed(MIN + 20)).toEqual({ reload: true });
    expect(b.failed(MIN + 30)).toMatchObject({ reload: false, attempt: 2 });
  });

  it("starts over once the window has run a minute without crashing", () => {
    const b = new ReloadBackoff();
    for (const t of [0, 1, 2]) b.failed(t);
    expect(b.failed(3)).toMatchObject({ attempt: 1 });
    b.retrying(MIN + 3);
    // Stable for over a minute after the retry.
    const t = 3 * MIN;
    expect(b.failed(t)).toEqual({ reload: true });
    b.failed(t + 1);
    b.failed(t + 2);
    expect(b.failed(t + 3)).toEqual({ reload: false, attempt: 1, delayMs: MIN });
  });
});

describe("load failure / crash policy", () => {
  it("ignores aborted and sub-frame loads", () => {
    expect(isRecoverableLoadFailure(-3, true)).toBe(false);
    expect(isRecoverableLoadFailure(-102, false)).toBe(false);
    expect(isRecoverableLoadFailure(-102, true)).toBe(true);
  });
  it("does not reload after a clean exit", () => {
    expect(shouldReloadAfterGone("clean-exit")).toBe(false);
    expect(shouldReloadAfterGone("crashed")).toBe(true);
    expect(shouldReloadAfterGone("oom")).toBe(true);
  });
});

describe("outputsOnRemovedDisplays", () => {
  it("returns outputs whose display is gone, leaving default-display windows", () => {
    expect(
      outputsOnRemovedDisplays(
        [
          { channelId: "program", displayId: 2 },
          { channelId: "stage", displayId: 1 },
          { channelId: "alpha", displayId: undefined },
        ],
        [1],
      ),
    ).toEqual(["program"]);
  });
});
