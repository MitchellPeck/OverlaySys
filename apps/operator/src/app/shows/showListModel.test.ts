import { describe, expect, it } from "vitest";
import type { ShowMeta } from "@/lib/store";
import { matchesWhen, showListStatus, showSorts } from "./showListModel";

const m = (id: string, name: string, scheduledFor?: string, updatedAt?: string): ShowMeta => ({
  id, name, projectId: "p", rowCount: 0, scheduledFor, updatedAt,
});
const sort = (id: string, items: ShowMeta[]) =>
  [...items].sort(showSorts.find((s) => s.id === id)!.compare).map((s) => s.id);

describe("showSorts", () => {
  const items = [
    m("none", "Misc"),
    m("old", "A", "2026-01-04"),
    m("new", "B", "2026-10-25"),
    m("tieB", "Zed", "2026-06-01", "2026-06-02T00:00:00Z"),
    m("tieA", "Amy", "2026-06-01", "2026-06-03T00:00:00Z"),
  ];
  it("date-desc newest first, undated last, ties by updatedAt", () => {
    expect(sort("date-desc", items)).toEqual(["new", "tieA", "tieB", "old", "none"]);
  });
  it("date-asc oldest first, undated still last", () => {
    expect(sort("date-asc", items)).toEqual(["old", "tieA", "tieB", "new", "none"]);
  });
  it("date from name when no scheduledFor", () => {
    expect(sort("date-desc", [m("a", "Service 1/5/2026"), m("b", "Service 3/1/2026")])).toEqual(["b", "a"]);
  });
  it("name-asc", () => {
    expect(sort("name-asc", [m("1", "b"), m("2", "A")])).toEqual(["2", "1"]);
  });
});

describe("matchesWhen", () => {
  const now = new Date(2026, 9, 28);
  it("upcoming includes today; past excludes it; none is undated", () => {
    expect(matchesWhen(m("a", "x", "2026-10-28"), "upcoming", now)).toBe(true);
    expect(matchesWhen(m("a", "x", "2026-10-28"), "past", now)).toBe(false);
    expect(matchesWhen(m("a", "x", "2026-10-27"), "past", now)).toBe(true);
    expect(matchesWhen(m("a", "x"), "none", now)).toBe(true);
    expect(matchesWhen(m("a", "x"), "upcoming", now)).toBe(false);
  });
});

describe("showListStatus", () => {
  it("connecting and open-before-first-list are loading, never error", () => {
    expect(showListStatus({ cloud: false, conn: "connecting", listed: false })).toEqual({ loading: true, error: null });
    expect(showListStatus({ cloud: false, conn: "open", listed: false })).toEqual({ loading: true, error: null });
  });
  it("open with a list is ready; closed is the only error", () => {
    expect(showListStatus({ cloud: false, conn: "open", listed: true })).toEqual({ loading: false, error: null });
    expect(showListStatus({ cloud: false, conn: "closed", listed: false }).error).toBe("Not connected to the server");
  });
  it("cloud ignores the socket", () => {
    expect(showListStatus({ cloud: true, conn: "closed", listed: true })).toEqual({ loading: false, error: null });
  });
});
