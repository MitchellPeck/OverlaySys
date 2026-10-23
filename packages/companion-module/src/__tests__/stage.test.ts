import { describe, expect, it } from "vitest";
import { INITIAL_STAGE_STATE } from "@overlaysys/core";
import { dispatchAction } from "../actions";
import { feedbackPredicate } from "../feedbacks";
import { apply } from "../state";
import { initialState } from "../types";
import { projectVariables } from "../variables";

const stageMsg = (pointIdx: number, pointCount: number, message: { text: string; sentAt: number } | null = null) =>
  ({
    type: "stage_state",
    state: { ...INITIAL_STAGE_STATE, notes: pointCount ? { showId: "s", notesId: "n" } : null, pointIdx, message },
    pointCount,
    title: pointCount ? "Grace" : null,
    pointHeading: pointCount ? `P${pointIdx + 1}` : null,
    nextHeading: pointCount && pointIdx + 1 < pointCount ? `P${pointIdx + 2}` : null,
  }) as const;

describe("companion stage", () => {
  it("stores stage_state", () => {
    const s = apply(initialState(), stageMsg(1, 3));
    expect(s.stage?.pointCount).toBe(3);
  });

  it("maps actions to client messages", () => {
    const s = initialState();
    expect(dispatchAction(s, "notes_next_point", {}).messages).toEqual([{ type: "notes_point", delta: 1 }]);
    expect(dispatchAction(s, "notes_prev_point", {}).messages).toEqual([{ type: "notes_point", delta: -1 }]);
    expect(dispatchAction(s, "notes_goto_point", { index: 3 }).messages).toEqual([{ type: "notes_point", index: 2 }]);
    expect(dispatchAction(s, "notes_scroll_down", {}).messages).toEqual([{ type: "notes_scroll", delta: 0.33 }]);
    expect(dispatchAction(s, "notes_scroll_up", { amount: 0.5 }).messages).toEqual([{ type: "notes_scroll", delta: -0.5 }]);
    expect(dispatchAction(s, "notes_top", {}).messages).toEqual([{ type: "notes_reset" }]);
    expect(dispatchAction(s, "stage_message_send", { text: "Wrap up" }).messages).toEqual([{ type: "stage_message", text: "Wrap up" }]);
    expect(dispatchAction(s, "stage_message_send", { text: "  " }).messages).toEqual([]);
    // The server rejects messages over 200 chars; trim and cut rather than drop.
    expect(dispatchAction(s, "stage_message_send", { text: `  ${"x".repeat(250)}  ` }).messages).toEqual([
      { type: "stage_message", text: "x".repeat(200) },
    ]);
    expect(dispatchAction(s, "stage_message_clear", {}).messages).toEqual([{ type: "stage_message_clear" }]);
  });

  it("notes_select uses the loaded show and maps 'none' to null", () => {
    const s = { ...initialState(), loadedShowId: "s" };
    expect(dispatchAction(s, "notes_select", { notesId: "n1" }).messages).toEqual([{ type: "notes_select", showId: "s", notesId: "n1" }]);
    expect(dispatchAction(s, "notes_select", { notesId: "__none__" }).messages).toEqual([{ type: "notes_select", showId: "s", notesId: null }]);
    expect(dispatchAction(initialState(), "notes_select", { notesId: "n1" }).messages).toEqual([]);
  });

  it("exposes variables, blank without notes", () => {
    const v = projectVariables(apply(initialState(), stageMsg(1, 3, { text: "Hi", sentAt: 1 })), []);
    expect(v).toMatchObject({ notes_title: "Grace", notes_point: "2", notes_point_count: "3", notes_point_heading: "P2", notes_next_heading: "P3", stage_message: "Hi" });
    const blank = projectVariables(apply(initialState(), stageMsg(0, 0)), []);
    expect(blank).toMatchObject({ notes_title: "", notes_point: "", notes_point_count: "0", notes_point_heading: "", stage_message: "" });
  });

  it("feedbacks", () => {
    const mid = apply(initialState(), stageMsg(1, 3));
    const first = apply(initialState(), stageMsg(0, 3));
    const last = apply(initialState(), stageMsg(2, 3, { text: "x", sentAt: 1 }));
    const none = apply(initialState(), stageMsg(0, 0));
    expect(feedbackPredicate(mid, "notes_active", {})).toBe(true);
    expect(feedbackPredicate(none, "notes_active", {})).toBe(false);
    expect(feedbackPredicate(first, "notes_at_first", {})).toBe(true);
    expect(feedbackPredicate(mid, "notes_at_first", {})).toBe(false);
    expect(feedbackPredicate(last, "notes_at_last", {})).toBe(true);
    expect(feedbackPredicate(none, "notes_at_last", {})).toBe(false);
    expect(feedbackPredicate(last, "stage_message_showing", {})).toBe(true);
    expect(feedbackPredicate(mid, "stage_message_showing", {})).toBe(false);
  });
});
