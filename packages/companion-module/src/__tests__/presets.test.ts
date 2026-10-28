import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { actionDefinitions } from "../actions";
import { presetDefinitions } from "../presets";

describe("presets", () => {
  const defs = actionDefinitions(initialState(), () => {}) as Record<
    string,
    { options: { id: string; type: string; choices?: { id: string }[] }[] }
  >;
  const presets = presetDefinitions() as Record<string, any>;
  const actions = Object.entries(presets).flatMap(([key, p]) =>
    ((p.steps ?? []) as any[]).flatMap((s) =>
      [...(s.down ?? []), ...(s.up ?? [])].map((a) => ({ key, ...a })),
    ),
  );

  it("every dropdown option value is a valid choice", () => {
    for (const a of actions) {
      const def = defs[a.actionId];
      expect(def, `${a.key}: unknown action ${a.actionId}`).toBeDefined();
      for (const [optId, value] of Object.entries(a.options ?? {})) {
        const opt = def.options.find((o) => o.id === optId);
        if (opt?.type !== "dropdown") continue;
        expect(
          opt.choices!.some((c) => c.id === value),
          `${a.key}: ${a.actionId}.${optId}=${JSON.stringify(value)}`,
        ).toBe(true);
      }
    }
  });

  it("no preset has an empty rowId", () => {
    for (const a of actions) {
      if ("rowId" in (a.options ?? {})) expect(a.options.rowId, a.key).not.toBe("");
    }
  });

  it("Row 3 takes by index 3 with the default channel", () => {
    const down = presets["rundown_row_3"].steps[0].down[0];
    expect(down.actionId).toBe("take_row_by_index");
    expect(down.options).toEqual({ rowIndex: 3, channel: "" });
    const fb = presets["rundown_row_3"].feedbacks as any[];
    expect(fb.map((f) => f.feedbackId)).toEqual(["row_at_index_is_active", "row_at_index_is_cursor"]);
    expect(fb.every((f) => f.options.rowIndex === 3)).toBe(true);
  });
});

describe("Hotcards presets", () => {
  it("has one fire_hotcard button per cached card", () => {
    const state = {
      hotcards: [
        { id: "h1", name: "Lower third", projectId: "p", templateId: "t" },
        { id: "h2", name: "Welcome", projectId: "p", templateId: "t" },
      ],
    };
    const p = Object.values(presetDefinitions(state)).filter((x: any) => x.category === "Hotcards") as any[];
    expect(p).toHaveLength(2);
    expect(p[0].steps[0].down[0]).toMatchObject({ actionId: "fire_hotcard", options: { hotcardId: "h1" } });
    expect(p[0].feedbacks[0]).toMatchObject({ feedbackId: "hotcard_on_air", style: { bgcolor: 0xe5484d } });
  });
  it("has none without hotcards", () => {
    expect(Object.values(presetDefinitions()).some((x: any) => x.category === "Hotcards")).toBe(false);
  });
});
