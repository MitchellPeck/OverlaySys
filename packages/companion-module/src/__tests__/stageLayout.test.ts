import { describe, expect, it } from "vitest";
import { actionDefinitions, dispatchAction } from "../actions";
import { apply } from "../state";
import { initialState } from "../types";
import { projectVariables, variableDefinitions } from "../variables";

const stageChannel = { id: "stage1", name: "Stage 1", kind: "stage" } as never;

describe("companion stage layout", () => {
  it("Automatic sends layoutId null", () => {
    const s = initialState();
    expect(dispatchAction(s, "set_stage_layout", { channel: "stage1", layoutId: "" }).messages).toEqual([
      { type: "set_stage_layout", channel: "stage1", layoutId: null },
    ]);
    expect(dispatchAction(s, "set_stage_layout", { channel: "stage1", layoutId: "speaker" }).messages).toEqual([
      { type: "set_stage_layout", channel: "stage1", layoutId: "speaker" },
    ]);
  });

  it("offers Automatic plus the layouts, on stage channels only", () => {
    let s = apply(initialState(), {
      type: "stage_layout_list",
      layouts: [{ id: "speaker", name: "Speaker" }],
    } as never);
    s = { ...s, channels: [stageChannel, { id: "program", name: "Program", kind: "graphics" } as never] };
    const opts = actionDefinitions(s).set_stage_layout!.options as { id: string; choices: { id: string; label: string }[] }[];
    expect(opts.find((o) => o.id === "channel")!.choices.map((c) => c.id)).toEqual(["stage1"]);
    expect(opts.find((o) => o.id === "layoutId")!.choices).toEqual([
      { id: "", label: "Automatic (rules)" },
      { id: "speaker", label: "Speaker" },
    ]);
  });

  it("projects variables from stage_layout_status", () => {
    let s = apply(initialState(), {
      type: "stage_layout_list",
      layouts: [{ id: "speaker", name: "Speaker" }],
    } as never);
    s = { ...s, channels: [stageChannel] };
    expect(variableDefinitions([], s).map((d) => d.variableId)).toEqual(
      expect.arrayContaining(["stage1_stage_layout", "stage1_stage_layout_reason"]),
    );
    s = apply(s, {
      type: "stage_layout_status",
      screens: [{ channel: "stage1", layoutId: "speaker", reason: "rule:song", manual: null }],
    } as never);
    const v = projectVariables(s, []);
    expect(v.stage1_stage_layout).toBe("Speaker");
    expect(v.stage1_stage_layout_reason).toBe("rule: song");
    s = apply(s, {
      type: "stage_layout_status",
      screens: [{ channel: "stage1", layoutId: "speaker", reason: "manual", manual: "speaker" }],
    } as never);
    expect(projectVariables(s, []).stage1_stage_layout_reason).toBe("manual");
  });
});
