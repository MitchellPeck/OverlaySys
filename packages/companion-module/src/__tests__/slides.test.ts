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
