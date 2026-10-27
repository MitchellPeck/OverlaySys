import { describe, expect, it } from "vitest";
import type { PcoLiveRaw } from "./pcoTypes";
import { mapPcoLive, serviceDeltaSec } from "./pcoLive";

const NOW = Date.parse("2026-10-27T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function raw(over: Partial<PcoLiveRaw> = {}): PcoLiveRaw {
  return {
    planTitle: "Sunday",
    items: [
      { id: "h", title: "Header", sequence: 1, itemType: "header" },
      { id: "a", title: "A", sequence: 2, itemType: "item", lengthSec: 300 },
      { id: "b", title: "B", sequence: 3, itemType: "item", lengthSec: 600 },
      { id: "c", title: "C", sequence: 4, itemType: "song", lengthSec: 900 },
    ],
    currentItemId: "b",
    currentStartedAt: iso(NOW - 100_000),
    nextItemId: "c",
    serviceEndsAt: iso(NOW + 1_200_000),
    ...over,
  };
}

describe("mapPcoLive", () => {
  it("excludes headers from count, index and later length", () => {
    const v = mapPcoLive(raw(), NOW);
    expect(v.status).toBe("live");
    expect(v.itemIndex).toBe(2);
    expect(v.itemCount).toBe(3);
    expect(v.laterLengthSec).toBe(900);
    expect(v.current).toEqual({ id: "b", title: "B", startedAt: NOW - 100_000, lengthSec: 600 });
    expect(v.next).toEqual({ title: "C" });
    expect(v.plannedEndAt).toBe(NOW + 1_200_000);
    expect(v.planTitle).toBe("Sunday");
  });

  it("reports notStarted with no current item", () => {
    const v = mapPcoLive(raw({ currentItemId: null, currentStartedAt: null, nextItemId: null }), NOW);
    expect(v.status).toBe("notStarted");
    expect(v.current).toBeNull();
    expect(v.itemIndex).toBe(0);
    expect(v.itemCount).toBe(3);
  });

  it("treats a current item without a usable start time as not started", () => {
    for (const currentStartedAt of [null, "not a date"]) {
      const v = mapPcoLive(raw({ currentStartedAt }), NOW);
      expect(v.status).toBe("notStarted");
      expect(v.current).toBeNull();
      expect(v.next).toBeNull();
      expect(v.itemIndex).toBe(0);
    }
  });

  it("leaves plannedEndAt undefined when the service time is missing", () => {
    const v = mapPcoLive(raw({ serviceEndsAt: null }), NOW);
    expect(v.plannedEndAt).toBeUndefined();
    expect(serviceDeltaSec(v, NOW)).toBeNull();
  });

  it("falls back to the next non-header item when the current item is a header", () => {
    const v = mapPcoLive(raw({ currentItemId: "h", nextItemId: null }), NOW);
    expect(v.status).toBe("live");
    expect(v.current).toMatchObject({ id: "a", title: "A", lengthSec: 300 });
    expect(v.itemIndex).toBe(1);
    expect(v.next).toEqual({ title: "B" });
  });

  it("prefers PCO's nextItemId over the sequence successor when it is a real item", () => {
    expect(mapPcoLive(raw({ currentItemId: "a", nextItemId: "c" }), NOW).next).toEqual({ title: "C" });
  });

  it("falls back to the sequence successor when nextItemId is a header, unknown or null", () => {
    expect(mapPcoLive(raw({ currentItemId: "a", nextItemId: "h" }), NOW).next).toEqual({ title: "B" });
    expect(mapPcoLive(raw({ currentItemId: "a", nextItemId: "zzz" }), NOW).next).toEqual({ title: "B" });
    expect(mapPcoLive(raw({ currentItemId: "a", nextItemId: null }), NOW).next).toEqual({ title: "B" });
  });

  it("ignores a nextItemId that names the current item (sequence fallback)", () => {
    expect(mapPcoLive(raw({ currentItemId: "a", nextItemId: "a" }), NOW).next).toEqual({ title: "B" });
  });

  it("a trailing header with no item after it is not started", () => {
    const r = raw({ currentItemId: "z" });
    r.items.push({ id: "z", title: "Closing", sequence: 9, itemType: "header" });
    const v = mapPcoLive(r, NOW);
    expect(v.status).toBe("notStarted");
    expect(v.current).toBeNull();
  });

  it("reports ended with no current item once the planned end has passed", () => {
    const none = { currentItemId: null, currentStartedAt: null, nextItemId: null };
    expect(mapPcoLive(raw({ ...none, serviceEndsAt: iso(NOW - 1) }), NOW).status).toBe("ended");
    expect(mapPcoLive(raw({ ...none, serviceEndsAt: iso(NOW + 1) }), NOW).status).toBe("notStarted");
    expect(mapPcoLive(raw({ ...none, serviceEndsAt: null }), NOW).status).toBe("notStarted");
    // a current item is live even past the planned end
    expect(mapPcoLive(raw({ serviceEndsAt: iso(NOW - 1) }), NOW).status).toBe("live");
  });

  it("leaves lengthSec undefined when the current item has none", () => {
    const r = raw();
    r.items[2] = { id: "b", title: "B", sequence: 3, itemType: "item" };
    const v = mapPcoLive(r, NOW);
    expect(v.current?.lengthSec).toBeUndefined();
    // current counts 0 remaining: projected end = now + 900 s; planned = now + 1200 s
    expect(serviceDeltaSec(v, NOW)).toBe(-300);
  });
});

describe("serviceDeltaSec", () => {
  it("is positive when the service will run over", () => {
    expect(serviceDeltaSec(mapPcoLive(raw(), NOW), NOW)).toBe(200);
  });
  it("is null with no current item", () => {
    expect(serviceDeltaSec(mapPcoLive(raw({ currentItemId: null }), NOW), NOW)).toBeNull();
  });
});
