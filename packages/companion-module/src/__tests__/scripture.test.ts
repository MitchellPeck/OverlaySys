import { describe, expect, it } from "vitest";
import type { ScriptureRow, Show } from "@overlaysys/core";
import { initialState } from "../types";
import { dispatchAction } from "../actions";
import { feedbackPredicate } from "../feedbacks";
import { projectVariables } from "../variables";
import { rowDisplayLabel } from "../labels";

const scripture = {
  kind: "scripture", id: "sr", reference: "John 3:16-18", translation: "KJV", templateId: "body", channelHint: "lower",
  slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "x" }] }],
} as ScriptureRow;
const graphic = { kind: "graphic", id: "g", templateId: "t", data: {} } as Show["rows"][number];

function state() {
  const s = initialState();
  const show = { id: "show1", name: "S", projectId: "p", rows: [graphic, scripture], songs: [] } as unknown as Show;
  s.showCache.set("show1", show);
  s.loadedShowId = "show1";
  s.loadedShowRowCursor = 1;
  return s;
}

describe("scripture actions", () => {
  it("intro by id / index / cursor", () => {
    expect(dispatchAction(state(), "scripture_take_intro", { showId: "show1", rowId: "sr", channel: "" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr" },
    ]);
    expect(dispatchAction(state(), "scripture_take_intro_by_index", { rowIndex: 2, channel: "program" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr", channel: "program" },
    ]);
    expect(dispatchAction(state(), "scripture_take_intro_at_cursor", { channel: "" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr" },
    ]);
  });

  it("intro by index on a non-scripture row does nothing", () => {
    expect(dispatchAction(state(), "scripture_take_intro_by_index", { rowIndex: 1 }).messages).toEqual([]);
  });

  it("slide N is 1-based in options and 0-based on the wire", () => {
    expect(dispatchAction(state(), "scripture_take_slide_by_index", { rowIndex: 2, slide: 3, channel: "" }).messages).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 2 },
    ]);
    expect(dispatchAction(state(), "scripture_goto", { channel: "program", slide: 1 }).messages).toEqual([
      { type: "scripture_goto", channel: "program", slideIdx: 0 },
    ]);
  });

  it("advance clamps delta to ±1 and end", () => {
    expect(dispatchAction(state(), "scripture_advance", { channel: "program", delta: -1 }).messages).toEqual([
      { type: "scripture_advance", channel: "program", delta: -1 },
    ]);
    expect(dispatchAction(state(), "scripture_advance", { channel: "program", delta: 5 }).messages).toEqual([
      { type: "scripture_advance", channel: "program", delta: 1 },
    ]);
    expect(dispatchAction(state(), "scripture_end", { channel: "program" }).messages).toEqual([
      { type: "scripture_end", channel: "program" },
    ]);
  });

  it("generic take_row on a scripture row takes slide 1 instead of nothing", () => {
    expect(dispatchAction(state(), "take_row_at_cursor", { channel: "" }).messages).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 0, channel: "lower" },
    ]);
  });

  it("song-aware take: intro → intro, lyrics → slide 1, outro → nothing", () => {
    const go = (sub: string) => dispatchAction(state(), "take_row_song_aware", { target: "cursor", sub, channel: "" }).messages;
    expect(go("intro")).toEqual([{ type: "scripture_take_intro", showId: "show1", rowId: "sr" }]);
    expect(go("lyrics")).toEqual([{ type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 0 }]);
    expect(go("outro")).toEqual([]);
  });
});

describe("scripture feedbacks, variables, labels", () => {
  function live() {
    const s = state();
    s.channelStates.set("program", {
      channel: "program",
      active: { templateId: "body", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "sr", sub: "slide", slideIdx: 1 } },
      scriptureSession: { rowId: "sr", reference: "John 3:16-18", slideIdx: 1, slideCount: 3, slideReference: "John 3:17", text: "For God sent" },
      queuedScripture: { rowId: "sr", reference: "John 3:16-18" },
    } as never);
    return s;
  }

  it("feedbacks", () => {
    const s = live();
    expect(feedbackPredicate(s, "scripture_active", { channel: "program" })).toBe(true);
    expect(feedbackPredicate(s, "scripture_queued", { channel: "program" })).toBe(true);
    expect(feedbackPredicate(s, "scripture_slide_is", { channel: "program", slide: 2 })).toBe(true);
    expect(feedbackPredicate(s, "scripture_slide_is", { channel: "program", slide: 1 })).toBe(false);
    expect(feedbackPredicate(s, "row_is_active", { rowId: "sr" })).toBe(true);
    expect(feedbackPredicate(s, "row_at_index_is_active", { rowIndex: 2 })).toBe(true);
  });

  it("variables", () => {
    const v = projectVariables(live(), ["program"]);
    expect(v.program_scripture_ref).toBe("John 3:17");
    expect(v.program_scripture_slide).toBe("2/3");
    expect(v.program_scripture_text).toBe("For God sent");
    expect(v.program_scripture_queued_ref).toBe("John 3:16-18");
    expect(v.rundown_2_is_active).toBe("yes");
    const empty = projectVariables(state(), ["program"]);
    expect(empty.program_scripture_slide).toBe("");
  });

  it("rundown label shows the reference", () => {
    expect(rowDisplayLabel(state(), scripture)).toBe("John 3:16-18");
  });
});
