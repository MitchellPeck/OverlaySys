import { describe, expect, it } from "vitest";
import type { ChannelState, GraphicRow, Show, VideoRow } from "@overlaysys/core";
import { editedFieldKeys, effectiveRowData, graphicRowMessage, upNextRows, withEffectiveData } from "./rowData";
import { rowAirState } from "./rowAirState";

type Row = Show["rows"][number];

const graphic = (id: string, data: Record<string, string>, channelHint?: string): GraphicRow => ({
  kind: "graphic",
  id,
  templateId: "l3",
  data,
  ...(channelHint !== undefined ? { channelHint } : {}),
});
const video = (id: string): VideoRow =>
  ({ kind: "video", id, assetUrl: "/a.mp4", volume: 1, endAction: "clear" }) as VideoRow;
const showWith = (ids: string[]): Show =>
  ({ id: "show", name: "S", rows: ids.map((id) => graphic(id, {})), songs: [] }) as unknown as Show;

describe("effectiveRowData", () => {
  it("returns the row's data when there are no overrides", () => {
    expect(effectiveRowData(graphic("a", { title: "Hi" }), {})).toEqual({ title: "Hi" });
  });

  it("merges the row's overrides over its data", () => {
    const row = graphic("a", { title: "Hi", subtitle: "There" });
    expect(effectiveRowData(row, { a: { subtitle: "Edited", extra: "x" }, b: { title: "no" } })).toEqual({
      title: "Hi",
      subtitle: "Edited",
      extra: "x",
    });
  });

  it("does not mutate the row", () => {
    const row = graphic("a", { title: "Hi" });
    effectiveRowData(row, { a: { title: "Edited" } });
    expect(row.data).toEqual({ title: "Hi" });
  });
});

describe("editedFieldKeys", () => {
  it("lists keys whose override differs from the original", () => {
    const row = graphic("a", { title: "Hi", subtitle: "There" });
    expect(editedFieldKeys(row, { a: { subtitle: "Edited", extra: "x" } })).toEqual(["subtitle", "extra"]);
  });

  it("ignores overrides equal to the original", () => {
    const row = graphic("a", { title: "Hi" });
    expect(editedFieldKeys(row, { a: { title: "Hi" } })).toEqual([]);
  });

  it("is empty with no overrides for the row", () => {
    expect(editedFieldKeys(graphic("a", { title: "Hi" }), { b: { title: "x" } })).toEqual([]);
  });
});

describe("withEffectiveData", () => {
  it("passes non-graphic rows through untouched", () => {
    const v = video("v");
    expect(withEffectiveData(v, { v: { title: "x" } })).toBe(v);
  });

  it("returns a graphic row with effective data", () => {
    const row = graphic("a", { title: "Hi" });
    expect(withEffectiveData(row, { a: { title: "Edited" } })).toEqual({ ...row, data: { title: "Edited" } });
    expect(row.data).toEqual({ title: "Hi" });
  });

  it("lets rowAirState light a row taken with edited data", () => {
    const row = graphic("a", { title: "Hi" });
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: { templateId: "l3", data: { title: "Edited" }, phase: "on", takenAt: 1 } },
    };
    const overrides = { a: { title: "Edited" } };
    expect(rowAirState(row, states, {})).toBeNull();
    expect(rowAirState(withEffectiveData(row, overrides), states, {})).toBe("program");
  });
});

describe("graphicRowMessage", () => {
  it("builds a cue with the preview default and the same key order as before", () => {
    const row = graphic("a", { title: "Hi" });
    expect(JSON.stringify(graphicRowMessage(row, "cue", {}))).toBe(
      JSON.stringify({ type: "cue", channel: "preview", templateId: "l3", data: row.data }),
    );
  });

  it("builds a take with the program default", () => {
    const row = graphic("a", { title: "Hi" });
    expect(JSON.stringify(graphicRowMessage(row, "take", {}))).toBe(
      JSON.stringify({ type: "take", channel: "program", templateId: "l3", data: row.data }),
    );
  });

  it("a graphic row hinted to program cues on preview", () => {
    const row = graphic("r", { title: "A" }, "program");
    expect(graphicRowMessage(row, "cue", {}, "s")).toMatchObject({ type: "cue", channel: "preview" });
    expect(graphicRowMessage(row, "take", {}, "s")).toMatchObject({ type: "take", channel: "program" });
  });

  it("a graphic row hinted to another output takes there but still cues on preview", () => {
    const row = graphic("r", { title: "A" }, "stage-1");
    expect(graphicRowMessage(row, "cue", {}, "s")).toMatchObject({ type: "cue", channel: "preview" });
    expect(graphicRowMessage(row, "take", {}, "s")).toMatchObject({ type: "take", channel: "stage-1" });
  });

  it("sends effective data", () => {
    const row = graphic("a", { title: "Hi", sub: "x" });
    expect(graphicRowMessage(row, "take", { a: { title: "Edited" } })).toEqual({
      type: "take",
      channel: "program",
      templateId: "l3",
      data: { title: "Edited", sub: "x" },
    });
  });
});

describe("upNextRows", () => {
  const show = showWith(["1", "2", "3", "4", "5", "6"]);
  const ids = (rows: Row[]) => rows.map((r) => r.id);

  it("returns the next three rows after the selection", () => {
    expect(ids(upNextRows(show, "2"))).toEqual(["3", "4", "5"]);
  });

  it("returns fewer near the end", () => {
    expect(ids(upNextRows(show, "5"))).toEqual(["6"]);
  });

  it("returns nothing when the selection is the last row", () => {
    expect(upNextRows(show, "6")).toEqual([]);
  });

  it("returns nothing when the selection is missing or null", () => {
    expect(upNextRows(show, "nope")).toEqual([]);
    expect(upNextRows(show, null)).toEqual([]);
  });

  it("returns nothing with no show", () => {
    expect(upNextRows(null, "1")).toEqual([]);
  });

  it("honours n", () => {
    expect(ids(upNextRows(show, "1", 2))).toEqual(["2", "3"]);
    expect(ids(upNextRows(show, "1", 10))).toEqual(["2", "3", "4", "5", "6"]);
  });
});

describe("graphicRowMessage source", () => {
  const row = graphic("g1", { a: "1" });
  it("adds the rundown source when a show id is given", () => {
    const msg = graphicRowMessage(row, "take", {}, "show-1");
    expect(msg).toMatchObject({ type: "take", source: { showId: "show-1", rowId: "g1" } });
  });
  it("omits source without a show id", () => {
    expect(graphicRowMessage(row, "cue", {})).not.toHaveProperty("source");
  });
});
