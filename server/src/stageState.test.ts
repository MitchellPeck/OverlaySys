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

  it("a take from another show that links notes commits once", async () => {
    const show2: Show = ShowSchema.parse({
      id: "show-2",
      name: "Other",
      projectId: "p",
      songs: [],
      sermonNotes: [{ id: "m1", title: "M", body: "# M" }],
      rows: [{ kind: "graphic", id: "q", templateId: "t", data: {}, sermonNotesId: "m1" }],
    });
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show-1" ? show : id === "show-2" ? show2 : null));
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    const seen = vi.fn();
    stage.subscribeStageState(seen);
    await stage.onRowTaken({ showId: "show-2", rowId: "q" });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(stage.getStageState().notes).toEqual({ showId: "show-2", notesId: "m1" });
  });

  it("onRowTaken keeps changes dispatched while the show loads", async () => {
    let resolve!: (s: Show) => void;
    vi.spyOn(shows, "getShow").mockImplementation(() => new Promise<Show>((r) => (resolve = r)));
    const taken = stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.dispatchStage({ type: "message", text: "Hi", now: 1 });
    resolve(show);
    await taken;
    expect(stage.getStageState().message).toEqual({ text: "Hi", sentAt: 1 });
    expect(stage.getStageState().notes).toEqual({ showId: "show-1", notesId: "n1" });
  });
  it("stageStateMessage clamps pointIdx when the notes shrink", async () => {
    let current = show;
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show-1" ? current : null));
    const six = "# P1\na\n# P2\nb\n# P3\nc\n# P4\nd\n# P5\ne\n# P6\nf";
    current = { ...show, sermonNotes: [{ id: "n1", title: "Grace", body: six }] };
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "point", index: 5 });
    await stage.dispatchStage({ type: "scroll", delta: 0.5 });
    expect(stage.getStageState()).toMatchObject({ pointIdx: 5, scrollOffset: 0.5 });
    current = { ...show, sermonNotes: [{ id: "n1", title: "Grace", body: "# P1\na\n# P2\nb\n# P3\nc\n# P4\nd" }] };
    const msg = await stage.stageStateMessage();
    expect(msg).toMatchObject({ pointCount: 4, pointHeading: "P4", nextHeading: null, state: { pointIdx: 3, scrollOffset: 0 } });
  });

  it("reconcileActiveNotes clears notes whose set was deleted", async () => {
    let current = show;
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show-1" ? current : null));
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.reconcileActiveNotes();
    expect(stage.getStageState().notes).toEqual({ showId: "show-1", notesId: "n1" });
    current = { ...show, sermonNotes: [show.sermonNotes![1]!] };
    await stage.reconcileActiveNotes();
    expect(stage.getStageState().notes).toBeNull();
  });

  it("reconcileActiveNotes clears notes whose show was deleted", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    vi.spyOn(shows, "getShow").mockResolvedValue(null);
    await stage.reconcileActiveNotes();
    expect(stage.getStageState().notes).toBeNull();
  });
});
