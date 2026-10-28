import { describe, expect, it } from "vitest";
import {
  RateLimiter,
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
