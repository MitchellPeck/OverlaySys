import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { PcoLiveRaw, Show } from "@overlaysys/core";
import * as shows from "../shows";
import * as timers from "../timers";
import { PcoAuthError, type PcoClient } from "./pcoClient";
import * as live from "./pcoLiveSync";
import { clearPcoAuthorization, isPcoConnected, setPcoAuthorization } from "./pcoTokens";

vi.mock("../shows", () => ({ getShow: vi.fn() }));

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function liveRaw(over: Partial<PcoLiveRaw> = {}): PcoLiveRaw {
  return {
    planTitle: "Sunday",
    items: [
      { id: "A", title: "Welcome", sequence: 1, itemType: "item", lengthSec: 300 },
      { id: "B", title: "Sermon", sequence: 2, itemType: "item", lengthSec: 600 },
    ],
    currentItemId: "B",
    currentStartedAt: iso(T0),
    nextItemId: null,
    serviceEndsAt: null,
    ...over,
  };
}
const notStarted = () => liveRaw({ currentItemId: null, currentStartedAt: null });

function showWithPlans(id: string, planIds: (string | null)[]): Show {
  return {
    id,
    name: id,
    rows: planIds.map((planId, i) => ({
      kind: "graphic",
      id: `r${i}`,
      templateId: "t",
      data: {},
      ...(planId ? { sourceRef: { provider: "pco", serviceTypeId: "st", planId, itemId: `i${i}` } } : {}),
    })),
  } as unknown as Show;
}

function fakeClient(getLive: PcoClient["getLive"]): PcoClient {
  return {
    listServiceTypes: vi.fn(),
    listPlans: vi.fn(),
    getPlanItems: vi.fn(),
    listSongArrangements: vi.fn(),
    getLive: vi.fn(getLive),
  } as unknown as PcoClient;
}

function useShows(...list: Show[]) {
  vi.mocked(shows.getShow).mockImplementation(async (id) => list.find((s) => s.id === id) ?? null);
}

/** Asserts the next getLive call happens exactly `ms` from now. */
async function expectNextCallAfter(client: PcoClient, ms: number) {
  const n = vi.mocked(client.getLive).mock.calls.length;
  await vi.advanceTimersByTimeAsync(ms - 1);
  expect(vi.mocked(client.getLive).mock.calls.length).toBe(n);
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.mocked(client.getLive).mock.calls.length).toBe(n + 1);
}

function state() {
  const m = live.liveSyncStateMessage();
  if (m.type !== "pco_live_state") throw new Error("wrong message");
  return m;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 + 60_000);
  timers._resetForTest();
  live._resetForTest();
});
afterEach(() => {
  live._resetForTest();
  vi.useRealTimers();
});

describe("pcoLiveSync", () => {
  it("start picks the most common plan", async () => {
    useShows(showWithPlans("s1", ["p1", null, "p2", "p2"]));
    const client = fakeClient(async () => liveRaw());
    expect(await live.startLiveSync("s1", { client })).toEqual({ ok: true });
    expect(client.getLive).toHaveBeenCalledWith("st", "p2");
    expect(state()).toMatchObject({ enabled: true, showId: "s1" });
  });

  it("breaks ties with the first row's plan", async () => {
    useShows(showWithPlans("s1", ["p1", "p2", "p2", "p1"]));
    const client = fakeClient(async () => liveRaw());
    await live.startLiveSync("s1", { client });
    expect(client.getLive).toHaveBeenCalledWith("st", "p1");
  });

  it("no PCO rows → error, not enabled", async () => {
    useShows(showWithPlans("s1", [null, null]));
    const client = fakeClient(async () => liveRaw());
    expect(await live.startLiveSync("s1", { client })).toEqual({
      ok: false,
      error: "This show has no Planning Center items.",
    });
    expect(client.getLive).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ enabled: false, showId: null, status: "idle", service: null });
  });

  it("not connected → error, not enabled", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const res = await live.startLiveSync("s1");
    expect(res.ok).toBe(false);
    expect(state().enabled).toBe(false);
  });

  it("poll every 5 s without overlap", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(() => new Promise((r) => setTimeout(() => r(liveRaw()), 7000)));
    await live.startLiveSync("s1", { client });
    expect(client.getLive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7000);
    expect(client.getLive).toHaveBeenCalledTimes(1);
    expect(state().status).toBe("live");
    await expectNextCallAfter(client, 5000);
  });

  it("network errors back off to 60 s and reset on success", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient(async () => liveRaw());
    const getLive = vi.mocked(client.getLive);
    getLive.mockResolvedValueOnce(liveRaw());
    for (let i = 0; i < 5; i++) getLive.mockRejectedValueOnce(new Error("offline"));
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    const before = state();
    expect(before.status).toBe("live");
    await expectNextCallAfter(client, 5000); // 1st failure
    for (const ms of [10_000, 20_000, 40_000, 60_000]) await expectNextCallAfter(client, ms); // failures 2-5
    // the view and status are kept through the errors
    expect(state()).toMatchObject({ status: "live", service: before.service, lastPolledAt: before.lastPolledAt });
    await expectNextCallAfter(client, 60_000); // succeeds
    await expectNextCallAfter(client, 5000);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("auth error stops with status error", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => {
      throw new PcoAuthError();
    });
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ enabled: true, status: "error", error: new PcoAuthError().message });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.getLive).toHaveBeenCalledTimes(1);
  });

  it("auth error drops the credential live sync used, but not a newer one", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    setPcoAuthorization("Basic old");
    const client = fakeClient(async () => {
      throw new PcoAuthError();
    });
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(isPcoConnected()).toBe(false);

    live._resetForTest();
    setPcoAuthorization("Basic old");
    let reject!: (e: Error) => void;
    const pending = fakeClient(() => new Promise((_, r) => (reject = r)));
    await live.startLiveSync("s1", { client: pending });
    setPcoAuthorization("Basic new");
    reject(new PcoAuthError());
    await vi.advanceTimersByTimeAsync(0);
    expect(isPcoConnected()).toBe(true);
    clearPcoAuthorization();
  });

  it("auth error clears the pco item timer", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => liveRaw());
    vi.mocked(client.getLive).mockResolvedValueOnce(liveRaw()).mockRejectedValue(new PcoAuthError());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(timers.getTimers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state().status).toBe("error");
    expect(timers.getTimers()).toEqual([]);
  });

  it("a stale in-flight poll resolving after stop changes nothing", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    let resolve!: (r: PcoLiveRaw) => void;
    const client = fakeClient(() => new Promise<PcoLiveRaw>((r) => (resolve = r)));
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getLive).toHaveBeenCalledTimes(1);
    live.stopLiveSync();
    resolve(liveRaw());
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ enabled: false, showId: null, status: "idle", service: null });
    expect(timers.getTimers()).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.getLive).toHaveBeenCalledTimes(1);
  });

  it("a stop that lands while the show is loading cancels the start", async () => {
    let release!: (s: Show) => void;
    vi.mocked(shows.getShow).mockImplementationOnce(() => new Promise<Show>((r) => (release = r)));
    const client = fakeClient(async () => liveRaw());
    const started = live.startLiveSync("s1", { client });
    live.stopLiveSync();
    release(showWithPlans("s1", ["p1"]));
    expect(await started).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getLive).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ enabled: false, status: "idle" });
  });

  it("restarting the same show keeps the previous view until the first poll", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    await live.startLiveSync("s1", { client: fakeClient(async () => liveRaw()) });
    await vi.advanceTimersByTimeAsync(0);
    expect(state().service?.status).toBe("live");
    await live.startLiveSync("s1", { client: fakeClient(() => new Promise(() => {})) });
    expect(state().service?.status).toBe("live");
    expect(timers.getTimers()).toHaveLength(1);
  });

  it("drives the item timer while live", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => liveRaw());
    vi.mocked(client.getLive).mockResolvedValueOnce(liveRaw()).mockResolvedValueOnce(notStarted());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(timers.getTimers()).toHaveLength(1);
    expect(timers.getTimers()[0]).toMatchObject({
      id: "current-item",
      source: "pco",
      rowId: "B",
      label: "Sermon",
      anchor: T0 + 600_000,
      durationMs: 600_000,
      overtime: true,
    });
    expect(timers.isItemTimerDriverExternal()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(timers.getTimers()).toEqual([]);
  });

  it("does not restart an unchanged pco item timer", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => liveRaw());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    const first = timers.getTimers();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.getLive).toHaveBeenCalledTimes(2);
    expect(timers.getTimers()).toBe(first);
  });

  it("stop clears a pco item timer but not a manual timer", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const manualId = timers.createTimer({ label: "Walk-in", mode: "countdown", durationMs: 60_000, overtime: true });
    const client = fakeClient(async () => liveRaw());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(timers.getTimers().map((t) => t.source)).toEqual(["pco", "manual"]);
    live.stopLiveSync();
    expect(timers.getTimers().map((t) => t.id)).toEqual([manualId]);
    expect(state()).toMatchObject({ enabled: false, showId: null, status: "idle", service: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getLive).toHaveBeenCalledTimes(1);
  });

  it("starting for a different show clears the pco item timer", async () => {
    useShows(showWithPlans("s1", ["p1"]), showWithPlans("s2", ["p9"]));
    const client = fakeClient(async () => liveRaw());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(timers.getTimers()).toHaveLength(1);
    const client2 = fakeClient(() => new Promise(() => {}));
    await live.startLiveSync("s2", { client: client2 });
    expect(timers.getTimers()).toEqual([]);
    expect(state().showId).toBe("s2");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getLive).toHaveBeenCalledTimes(1);
  });

  it("does not suppress take-based timers when not live", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => notStarted());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ enabled: true, status: "notStarted" });
    expect(state().service?.status).toBe("notStarted");
    expect(timers.isItemTimerDriverExternal()).toBe(false);
  });

  it("clears a take-based item timer while live on an item with no length", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    timers.dispatchTimers({
      type: "setItem",
      source: "item",
      rowId: "r0",
      label: "Take",
      anchor: T0 + 60_000,
      durationMs: 60_000,
      overtime: true,
    });
    const noLength = liveRaw({
      items: [{ id: "B", title: "Sermon", sequence: 1, itemType: "item" }],
    });
    await live.startLiveSync("s1", { client: fakeClient(async () => noLength) });
    await vi.advanceTimersByTimeAsync(0);
    expect(state().status).toBe("live");
    expect(timers.getTimers()).toEqual([]);
  });

  it("a parse failure sets status error, keeps polling and clears on success", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient(async () => liveRaw());
    const zod = new ZodError([]);
    vi.mocked(client.getLive).mockResolvedValueOnce(liveRaw()).mockRejectedValueOnce(zod);
    const l = vi.fn();
    live.subscribeLiveSync(l);
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    expect(timers.getTimers()).toHaveLength(1);
    l.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state()).toMatchObject({ enabled: true, status: "error", error: "Planning Center response not understood" });
    expect(state().service?.status).toBe("error");
    expect(timers.getTimers()).toEqual([]);
    expect(l).toHaveBeenCalledTimes(1);
    await expectNextCallAfter(client, 10_000); // backed off, still polling
    expect(state().status).toBe("live");
    expect(state().error).toBeUndefined();
    warn.mockRestore();
  });

  it("a non-auth request failure surfaces the error and clears it on success", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient(async () => liveRaw());
    const failure = new Error("Planning Center request failed (404): x");
    vi.mocked(client.getLive).mockResolvedValueOnce(liveRaw()).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
    const l = vi.fn();
    live.subscribeLiveSync(l);
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    l.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state()).toMatchObject({ enabled: true, status: "live", error: failure.message });
    expect(l).toHaveBeenCalledTimes(1);
    await expectNextCallAfter(client, 10_000); // same error again: no rebroadcast
    expect(l).toHaveBeenCalledTimes(1);
    await expectNextCallAfter(client, 20_000);
    expect(state().error).toBeUndefined();
    expect(l).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("does not rebroadcast an unchanged poll except a heartbeat", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const client = fakeClient(async () => liveRaw());
    await live.startLiveSync("s1", { client });
    await vi.advanceTimersByTimeAsync(0);
    const l = vi.fn();
    live.subscribeLiveSync(l);
    await vi.advanceTimersByTimeAsync(live.HEARTBEAT_MS - 5000);
    expect(client.getLive).toHaveBeenCalledTimes(live.HEARTBEAT_MS / 5000);
    expect(l).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(l).toHaveBeenCalledTimes(1);
    expect(state().lastPolledAt).toBe(Date.now());
    vi.mocked(client.getLive).mockResolvedValue(notStarted());
    await vi.advanceTimersByTimeAsync(5000);
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers on state changes", async () => {
    useShows(showWithPlans("s1", ["p1"]));
    const l = vi.fn();
    const off = live.subscribeLiveSync(l);
    await live.startLiveSync("s1", { client: fakeClient(async () => liveRaw()) });
    await vi.advanceTimersByTimeAsync(0);
    // One for start, one for the first poll's change.
    expect(l).toHaveBeenCalledTimes(2);
    off();
  });
});
