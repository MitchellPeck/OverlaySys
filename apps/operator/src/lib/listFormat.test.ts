import { describe, expect, it } from "vitest";
import { formatDuration, formatRelative, formatServiceDate, plural } from "./listFormat";

const now = new Date(2026, 9, 28, 12, 0);

describe("formatServiceDate", () => {
  it("omits the year for the current year", () => {
    expect(formatServiceDate("2026-11-01", now)).toBe("Sun 1 Nov");
  });
  it("includes the year otherwise", () => {
    expect(formatServiceDate("2025-11-02", now)).toBe("Sun 2 Nov 2025");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(2550)).toBe("42:30");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(5)).toBe("0:05");
  });
});

describe("formatRelative", () => {
  it("covers each range", () => {
    expect(formatRelative("2026-10-28T11:59:30", now)).toBe("just now");
    expect(formatRelative("2026-10-28T11:55:00", now)).toBe("5 min ago");
    expect(formatRelative("2026-10-28T09:00:00", now)).toBe("3 h ago");
    expect(formatRelative("2026-10-27T10:00:00", now)).toBe("yesterday");
    expect(formatRelative("2026-10-26T12:00:00", now)).toBe("2 days ago");
    expect(formatRelative("2026-10-24T12:00:00", now)).toBe("4 days ago");
    expect(formatRelative("2026-10-10T12:00:00", now)).toBe("Sat 10 Oct");
  });
  it("is empty for missing or invalid input", () => {
    expect(formatRelative(undefined, now)).toBe("");
    expect(formatRelative("nope", now)).toBe("");
  });
});

describe("plural", () => {
  it("pluralises", () => {
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(9, "item")).toBe("9 items");
    expect(plural(2, "match", "matches")).toBe("2 matches");
  });
});
