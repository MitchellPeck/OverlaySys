import { describe, expect, it } from "vitest";
import type { RowLike } from "./rowLike";
import * as a from "./slidesRowView";

const row: RowLike = { kind: "slides", id: "r1", deckId: "d1" };

// Plan 3 (P3.13) replaces these with real cases; they pin the stub's neutral values.
describe("slides adapter stubs", () => {
  it("is disabled and neutral", () => {
    expect(a.slidesAddItemEnabled).toBe(false);
    expect(a.slidesRowViewFor(row, undefined)).toBeNull();
    expect(a.slidesAirState(row, {})).toBeNull();
    expect(a.slidesThumbState(row, 0, {})).toBeNull();
    expect(a.slidesThumbMessages("s", row, 0, "preview")).toBeNull();
    expect(a.slidesRowTakeMessages("s", row, "cue")).toBeNull();
    expect(a.slidesKeyChannel({})).toBeNull();
    expect(a.slidesAdvanceMessage(1)).toBeNull();
    expect(a.slidesBlankMessage()).toBeNull();
  });

  it("has a frozen empty deck cache and no deck", () => {
    const c = a.useDeckCache();
    expect(c).toEqual({});
    expect(Object.isFrozen(c)).toBe(true);
    expect(a.useDeckFor(row)).toBeUndefined();
  });
});
