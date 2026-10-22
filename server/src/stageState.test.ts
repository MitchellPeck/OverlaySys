import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowSchema, type Show } from "@overlaysys/core";
import * as shows from "./shows";
import * as stage from "./stageState";

const show: Show = ShowSchema.parse({
  id: "show-1",
  name: "Sunday",
  projectId: "p",
  songs: [],
  sermonNotes: [
    { id: "n1", title: "Grace", body: "# One\na\n# Two\nb\n# Three\nc" },
    { id: "n2", title: "Other", body: "# X" },
  ],
  rows: [
    { kind: "graphic", id: "r1", templateId: "t", data: {}, sermonNotesId: "n1" },
    { kind: "graphic", id: "r2", templateId: "t", data: {} },
  ],
});

describe("stageState", () => {
  beforeEach(() => {
    stage._resetForTest();
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show-1" ? show : null));
  });
  afterEach(() => vi.restoreAllMocks());

  it("taking a row with a notes link selects that set", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    expect(stage.getStageState().notes).toEqual({ showId: "show-1", notesId: "n1" });
  });

  it("taking a row without a link keeps the active notes", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.dispatchStage({ type: "point", delta: 1 });
    await stage.onRowTaken({ showId: "show-1", rowId: "r2" });
    expect(stage.getStageState()).toMatchObject({ notes: { notesId: "n1" }, pointIdx: 1 });
  });

  it("re-taking the linked row doesn't reset the position", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.dispatchStage({ type: "point", delta: 2 });
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    expect(stage.getStageState().pointIdx).toBe(2);
  });

  it("a take from a different show clears the active notes", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.onRowTaken({ showId: "other-show", rowId: "x" });
    expect(stage.getStageState().notes).toBeNull();
  });

  it("navigation clamps against the active notes' point count", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "point", delta: 10 });
    expect(stage.getStageState().pointIdx).toBe(2);
  });

  it("two overflow reports for the same point advance once", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "overflow", direction: "next", atPoint: 0 });
    await stage.dispatchStage({ type: "overflow", direction: "next", atPoint: 0 });
    expect(stage.getStageState().pointIdx).toBe(1);
  });

  it("notifies subscribers only on change", async () => {
    const seen = vi.fn();
    const off = stage.subscribeStageState(seen);
    await stage.dispatchStage({ type: "point", delta: 1 }); // no notes → no-op
    expect(seen).not.toHaveBeenCalled();
    await stage.dispatchStage({ type: "message", text: "Wrap up", now: 1 });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("stageStateMessage reports headings and counts, and nulls for missing notes", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "point", delta: 1 });
    expect(await stage.stageStateMessage()).toMatchObject({
      type: "stage_state",
      pointCount: 3,
      title: "Grace",
      pointHeading: "Two",
      nextHeading: "Three",
    });
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "gone" });
    expect(await stage.stageStateMessage()).toMatchObject({ pointCount: 0, title: null, pointHeading: null, nextHeading: null });
  });
});
