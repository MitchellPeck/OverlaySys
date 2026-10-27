import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, hasRunningWork } from "../state";
import { initialState, type CompanionState } from "../types";
import { feedbackPredicate } from "../feedbacks";
import { projectVariables } from "../variables";
import type { PcoLiveStateMessage } from "@overlaysys/ws-protocol";

const LOCAL_NOW = 2_000_000;

const timersMsg = (anchor: number | null, pausedAt?: number) => ({
  type: "timers_state" as const,
  timers: [
    {
      id: "current-item",
      label: "Sermon",
      mode: "countdown" as const,
      durationMs: 600_000,
      anchor,
      pausedAt,
      overtime: true,
      source: "item" as const,
      rowId: "r1",
    },
  ],
});

afterEach(() => vi.useRealTimers());

describe("server clock offset", () => {
  it("stores serverTime - Date.now() from hello", () => {
    vi.useFakeTimers();
    vi.setSystemTime(LOCAL_NOW);
    const s = apply(initialState(), { type: "hello", protocolVersion: 1, serverTime: LOCAL_NOW + 5_000 });
    expect(s.serverTimeOffsetMs).toBe(5_000);
  });

  it("projects timers on the server clock when the local clock is skewed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(LOCAL_NOW);
    // Server is 90 s ahead; the timer (server anchor) has 60 s left on the server clock.
    let s = apply(initialState(), { type: "hello", protocolVersion: 1, serverTime: LOCAL_NOW + 90_000 });
    s = apply(s, timersMsg(LOCAL_NOW + 90_000 + 60_000));
    expect(projectVariables(s, []).item_timer).toBe("1:00");
    // Without the offset it would read 2:30.
    const naive = { ...s, serverTimeOffsetMs: 0 };
    expect(projectVariables(naive, []).item_timer).toBe("2:30");
    expect(feedbackPredicate(s, "item_timer_overtime", {})).toBe(false);
  });

  it("clears timers and PCO Live on reconnecting and local_reset_live", () => {
    let s: CompanionState = apply(initialState(), timersMsg(LOCAL_NOW));
    s = { ...s, pcoLive: { status: "live" } as unknown as PcoLiveStateMessage };
    const r = apply(s, { type: "local_reconnecting" });
    expect(r.timers).toEqual([]);
    expect(r.pcoLive).toBeNull();
    const c = apply(s, { type: "local_reset_live" });
    expect(c.timers).toEqual([]);
    expect(c.pcoLive).toBeNull();
  });
});

describe("hasRunningWork", () => {
  it("is true for a running timer, false for paused/stopped, true for live PCO", () => {
    expect(hasRunningWork(initialState())).toBe(false);
    expect(hasRunningWork(apply(initialState(), timersMsg(LOCAL_NOW)))).toBe(true);
    expect(hasRunningWork(apply(initialState(), timersMsg(LOCAL_NOW, LOCAL_NOW - 1)))).toBe(false);
    expect(hasRunningWork(apply(initialState(), timersMsg(null)))).toBe(false);
    const pco = { service: { status: "live" } } as unknown as PcoLiveStateMessage;
    expect(hasRunningWork({ ...initialState(), pcoLive: pco })).toBe(true);
  });
});
