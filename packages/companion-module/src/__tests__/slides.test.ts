import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import { actionDefinitions, dispatchAction } from "../actions";
import { presetDefinitions } from "../presets";
import { feedbackPredicate } from "../feedbacks";
import { projectVariables, variableDefinitions } from "../variables";

const withSession = () =>
  apply(initialState(), {
    type: "state",
    channel: "program",
    state: {
      channel: "program",
      active: null,
      slidesSession: {
        rowId: "r1",
        deckId: "d1",
        title: "Deck A",
        slideIdx: 1,
        slideCount: 4,
        lines: ["Line A"],
        blanked: false,
        atEnd: false,
      },
    } as never,
  });

describe("slides actions", () => {
  it("slides_advance with delta -1 sends delta -1", () => {
    const r = dispatchAction(initialState(), "slides_advance", { channel: "program", delta: -1 });
    expect(r.messages).toEqual([{ type: "slides_advance", channel: "program", delta: -1 }]);
    const f = dispatchAction(initialState(), "slides_advance", { channel: "program", delta: 1 });
    expect(f.messages).toEqual([{ type: "slides_advance", channel: "program", delta: 1 }]);
  });

  it("slides_goto sends the 1-based slide as a 0-based index", () => {
    expect(dispatchAction(initialState(), "slides_goto", { channel: "program", slide: 3 }).messages).toEqual([
      { type: "slides_goto", channel: "program", slideIdx: 2 },
    ]);
    expect(dispatchAction(initialState(), "slides_goto", { channel: "program", slide: 0 }).messages).toEqual([
      { type: "slides_goto", channel: "program", slideIdx: 0 },
    ]);
  });

  it("slides_goto is offered as an action", () => {
    const defs = actionDefinitions(initialState(), () => {});
    expect(defs.slides_goto?.name).toBe("Slides: go to slide N");
  });

  it("slides_blank and slides_end send their messages", () => {
    expect(dispatchAction(initialState(), "slides_blank", { channel: "program" }).messages).toEqual([
      { type: "slides_blank", channel: "program" },
    ]);
    expect(dispatchAction(initialState(), "slides_end", { channel: "program" }).messages).toEqual([
      { type: "slides_end", channel: "program" },
    ]);
  });
});

describe("slides presets", () => {
  it("presets use valid action options", () => {
    const defs = actionDefinitions(initialState(), () => {}) as Record<string, { options: { id: string }[] }>;
    const presets = presetDefinitions() as Record<string, any>;
    const slides = Object.values(presets).filter((p) => p.category === "Slides");
    expect(slides.map((p) => p.name)).toEqual(expect.arrayContaining(["Slides next", "Slides previous"]));
    const deltas: Record<string, number> = {};
    for (const p of slides) {
      for (const a of p.steps[0].down) {
        const def = defs[a.actionId];
        expect(def, a.actionId).toBeDefined();
        for (const k of Object.keys(a.options)) expect(def.options.some((o) => o.id === k), k).toBe(true);
        if (a.actionId === "slides_advance") {
          expect(a.options.channel).toBe("program");
          deltas[p.name] = a.options.delta;
        }
      }
    }
    expect(deltas["Slides next"]).toBe(1);
    expect(deltas["Slides previous"]).toBe(-1);
  });
});

describe("slides variables and feedback", () => {
  it("variables are empty with no session and filled with one", () => {
    const ids = variableDefinitions(["program"]).map((d) => d.variableId);
    for (const id of ["program_slides_deck", "program_slide_n", "program_slide_count"]) expect(ids).toContain(id);
    const none = projectVariables(initialState(), ["program"]);
    expect(none.program_slides_deck).toBe("");
    expect(none.program_slide_n).toBe("");
    expect(none.program_slide_count).toBe("");
    const v = projectVariables(withSession(), ["program"]);
    expect(v.program_slides_deck).toBe("Deck A");
    expect(v.program_slide_n).toBe("2");
    expect(v.program_slide_count).toBe("4");
  });

  it("slides_on_air follows slidesSession", () => {
    expect(feedbackPredicate(initialState(), "slides_on_air", { channel: "program" })).toBe(false);
    expect(feedbackPredicate(withSession(), "slides_on_air", { channel: "program" })).toBe(true);
  });
});

describe("slides rows from the rundown", () => {
  const withShow = (hint?: string) => {
    const s = initialState();
    s.loadedShowId = "show1";
    s.showCache.set("show1", {
      id: "show1",
      name: "S",
      rows: [{ kind: "slides", id: "sr1", deckId: "d1", ...(hint ? { channelHint: hint } : {}) }],
    } as never);
    return s;
  };

  it("take_row sends slides_take to the channel option, else the hint, else program", () => {
    expect(dispatchAction(withShow(), "take_row", { rowId: "sr1" }).messages).toEqual([
      { type: "slides_take", showId: "show1", rowId: "sr1", channel: "program" },
    ]);
    expect(dispatchAction(withShow("stage"), "take_row", { rowId: "sr1" }).messages[0]).toMatchObject({ channel: "stage" });
    expect(dispatchAction(withShow("stage"), "take_row", { rowId: "sr1", channel: "program" }).messages[0]).toMatchObject({
      channel: "program",
    });
  });

  it("take_row_by_index with channel preview cues the slides row", () => {
    const r = dispatchAction(withShow(), "take_row_by_index", { rowIndex: 1, channel: "preview" });
    expect(r.messages).toEqual([{ type: "slides_take", showId: "show1", rowId: "sr1", channel: "preview" }]);
  });

  it("PVW to PGM sends slides_take to the To channel", () => {
    const r = dispatchAction(withShow(), "take_row_pvw_pgm", { rowId: "sr1", fromChannel: "preview", toChannel: "program" });
    expect(r.messages).toEqual([{ type: "slides_take", showId: "show1", rowId: "sr1", channel: "program" }]);
  });

  it("row_is_active is true while the row's slides session is on program", () => {
    const s = withShow();
    expect(feedbackPredicate(s, "row_is_active", { rowId: "sr1" })).toBe(false);
    s.channelStates.set("program", {
      channel: "program",
      active: null,
      slidesSession: { rowId: "sr1", title: "D", slideIdx: 0, slideCount: 2, lines: [], blanked: false, atEnd: false },
    } as never);
    expect(feedbackPredicate(s, "row_is_active", { rowId: "sr1" })).toBe(true);
  });
});
