import { describe, it, expect } from "vitest";
import { resolveShowDate, pickNextShow, toISODate } from "./showSchedule";

describe("resolveShowDate", () => {
  it("prefers a valid scheduledFor over the name", () => {
    expect(
      resolveShowDate({ name: "1/2/24 Service", scheduledFor: "2026-05-17" }),
    ).toBe("2026-05-17");
  });

  it("parses M/D/YY from the name", () => {
    expect(resolveShowDate({ name: "5/17/26 Service" })).toBe("2026-05-17");
  });

  it("parses M/D/YYYY from the name", () => {
    expect(resolveShowDate({ name: "Christmas 12/1/2026" })).toBe("2026-12-01");
  });

  it("falls back to the name when scheduledFor is malformed", () => {
    expect(
      resolveShowDate({ name: "5/17/26 Service", scheduledFor: "not-a-date" }),
    ).toBe("2026-05-17");
  });

  it("returns null when neither source has a date", () => {
    expect(resolveShowDate({ name: "Sunday Gathering" })).toBeNull();
  });

  it("rejects impossible month/day in the name", () => {
    expect(resolveShowDate({ name: "13/40/26" })).toBeNull();
  });
});

describe("pickNextShow", () => {
  const shows = [
    { id: "past", name: "1/1/20 Old", scheduledFor: undefined },
    { id: "soon", name: "Soonest", scheduledFor: "2026-07-20" },
    { id: "later", name: "7/27/26 Later" },
    { id: "nodate", name: "No Date Here" },
  ];

  it("selects the soonest show on or after today", () => {
    expect(pickNextShow(shows, "2026-07-14")).toBe("soon");
  });

  it("includes a show scheduled exactly today", () => {
    expect(pickNextShow(shows, "2026-07-20")).toBe("soon");
  });

  it("prefers an upcoming show over a nearer past one", () => {
    const mixed = [
      { id: "yesterday", name: "Y", scheduledFor: "2026-07-13" },
      { id: "next-year", name: "N", scheduledFor: "2027-06-01" },
    ];
    expect(pickNextShow(mixed, "2026-07-14")).toBe("next-year");
  });

  it("falls back to the most recent past show when nothing is upcoming", () => {
    expect(pickNextShow(shows, "2027-01-01")).toBe("later");
  });

  it("breaks upcoming ties by input order", () => {
    const tied = [
      { id: "b", name: "B", scheduledFor: "2026-08-01" },
      { id: "a", name: "A", scheduledFor: "2026-08-01" },
    ];
    expect(pickNextShow(tied, "2026-07-01")).toBe("b");
  });

  it("breaks past-fallback ties by input order", () => {
    const tied = [
      { id: "b", name: "B", scheduledFor: "2026-08-01" },
      { id: "a", name: "A", scheduledFor: "2026-08-01" },
    ];
    expect(pickNextShow(tied, "2027-01-01")).toBe("b");
  });

  it("returns null when no show has a resolvable date", () => {
    expect(
      pickNextShow(
        [
          { id: "x", name: "Sunday Gathering" },
          { id: "y", name: "Midweek", scheduledFor: "not-a-date" },
        ],
        "2026-07-14",
      ),
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickNextShow([], "2026-07-14")).toBeNull();
  });
});

describe("toISODate", () => {
  it("formats local Y-M-D with zero padding", () => {
    // Month is 0-based in Date; 2026-03-05.
    expect(toISODate(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});
