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
    const v = mapPcoLive(raw());
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
    const v = mapPcoLive(raw({ currentItemId: null, currentStartedAt: null, nextItemId: null }));
    expect(v.status).toBe("notStarted");
    expect(v.current).toBeNull();
    expect(v.itemIndex).toBe(0);
    expect(v.itemCount).toBe(3);
  });

  it("leaves plannedEndAt undefined when the service time is missing", () => {
    const v = mapPcoLive(raw({ serviceEndsAt: null }));
    expect(v.plannedEndAt).toBeUndefined();
    expect(serviceDeltaSec(v, NOW)).toBeNull();
  });

  it("leaves lengthSec undefined when the current item has none", () => {
    const r = raw();
    r.items[2] = { id: "b", title: "B", sequence: 3, itemType: "item" };
    const v = mapPcoLive(r);
    expect(v.current?.lengthSec).toBeUndefined();
    // current counts 0 remaining: projected end = now + 900 s; planned = now + 1200 s
    expect(serviceDeltaSec(v, NOW)).toBe(-300);
  });
});

describe("serviceDeltaSec", () => {
  it("is positive when the service will run over", () => {
    expect(serviceDeltaSec(mapPcoLive(raw()), NOW)).toBe(200);
  });
  it("is null with no current item", () => {
    expect(serviceDeltaSec(mapPcoLive(raw({ currentItemId: null })), NOW)).toBeNull();
  });
});
