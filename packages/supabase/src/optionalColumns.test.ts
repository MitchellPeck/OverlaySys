import { describe, expect, it } from "vitest";
import {
  hotkeyFromColumn,
  hotkeyToColumn,
  isMissingColumnError,
  isMissingTableError,
  showExtra,
} from "./optionalColumns";

describe("isMissingColumnError", () => {
  it("matches 42703 / PGRST204 only when the message names the column", () => {
    expect(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'extra' column of 'shows' in the schema cache" }, "extra")).toBe(true);
    expect(isMissingColumnError({ code: "42703", message: "column shows.extra does not exist" }, "extra")).toBe(true);
    expect(isMissingColumnError({ code: "42703", message: "column shows.other does not exist" }, "extra")).toBe(false);
    expect(isMissingColumnError({ code: "42703", message: "column shows.extra_old does not exist" }, "extra")).toBe(false);
    expect(isMissingColumnError({ code: "23505", message: "duplicate key on extra" }, "extra")).toBe(false);
    expect(isMissingColumnError(null, "extra")).toBe(false);
  });
});

describe("isMissingTableError", () => {
  it("matches 42P01 / PGRST205 and their messages", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ message: "relation overlaysys.decks does not exist" })).toBe(true);
    expect(isMissingTableError({ code: "42703", message: "column shows.extra does not exist" })).toBe(false);
    expect(isMissingTableError("nope")).toBe(false);
  });
});

describe("showExtra", () => {
  it("is the show minus its columned fields", () => {
    expect(showExtra({ id: "s", name: "n", projectId: "p", rows: [], songs: [], scheduledFor: "2026-11-01", sections: [{ id: "x", name: "Opening" }] } as never))
      .toEqual({ songs: [], scheduledFor: "2026-11-01", sections: [{ id: "x", name: "Opening" }] });
    expect(showExtra({ id: "s", name: "n", projectId: "p", rows: [], songs: [], updatedAt: "t", deletedAt: "d", futureKey: 1 } as never))
      .toEqual({ songs: [], futureKey: 1 });
  });
});

describe("hotkey column mapping", () => {
  it("maps F-keys through, null to none, undefined to null", () => {
    expect([hotkeyToColumn("F3"), hotkeyToColumn(null), hotkeyToColumn(undefined)]).toEqual(["F3", "none", null]);
    expect([hotkeyFromColumn("F3"), hotkeyFromColumn("none"), hotkeyFromColumn(null), hotkeyFromColumn("F99")]).toEqual(["F3", null, undefined, undefined]);
  });
});
