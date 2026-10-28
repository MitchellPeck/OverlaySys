import { beforeEach, describe, expect, it } from "vitest";
import { StageLayoutSchema, type StageLayout } from "@overlaysys/core";
import { useStageEditor } from "./stageEditorStore";
import { addWidgetOp, nudgeWidgets } from "./stageLayoutOps";

const blank = StageLayoutSchema.parse({ id: "l", name: "L", widgets: [] }) as StageLayout;
const st = () => useStageEditor.getState();

describe("useStageEditor", () => {
  beforeEach(() => st().setDraft(blank));

  it("commit pushes history; undo/redo round-trip; no-op commit adds nothing", () => {
    st().commit(addWidgetOp("text", "t1"));
    st().commit(() => {});
    expect(st().history).toHaveLength(1);
    expect(st().dirty).toBe(true);
    st().undo();
    expect(st().draft!.widgets).toHaveLength(0);
    st().redo();
    expect(st().draft!.widgets).toHaveLength(1);
  });
  it("applyLive changes draft without history; pushHistory snapshots once per drag", () => {
    st().commit(addWidgetOp("text", "t1"));
    const hist = st().history.length;
    st().pushHistory();
    st().applyLive(nudgeWidgets(["t1"], 5, 0));
    st().applyLive(nudgeWidgets(["t1"], 5, 0));
    expect(st().history).toHaveLength(hist + 1);
    expect(st().draft!.widgets[0]!.rect.x).toBe(10);
    st().undo();
    expect(st().draft!.widgets[0]!.rect.x).toBe(0);
  });
  it("undo prunes selection ids that no longer exist", () => {
    st().commit(addWidgetOp("text", "t1"));
    st().select(["t1"]);
    st().undo();
    expect(st().selectedIds).toEqual([]);
  });
  it("select supports additive toggle", () => {
    st().select(["a"]);
    st().select(["b"], true);
    expect(st().selectedIds).toEqual(["a", "b"]);
    st().select(["a"], true);
    expect(st().selectedIds).toEqual(["b"]);
  });
  it("history is capped at 50", () => {
    for (let i = 0; i < 60; i++) st().commit(addWidgetOp("text", `w${i}`));
    expect(st().history).toHaveLength(50);
  });
  it("commit clears the redo stack", () => {
    st().commit(addWidgetOp("text", "t1"));
    st().undo();
    expect(st().redoStack).toHaveLength(1);
    st().commit(addWidgetOp("text", "t2"));
    expect(st().redoStack).toHaveLength(0);
  });
  it("pushHistory is capped at 50", () => {
    for (let i = 0; i < 60; i++) {
      st().pushHistory();
      st().applyLive(nudgeWidgets([], 0, 0));
    }
    expect(st().history).toHaveLength(50);
  });
  it("undo and redo on empty stacks are no-ops", () => {
    const before = st().draft;
    st().undo();
    st().redo();
    expect(st().draft).toBe(before);
    expect(st().dirty).toBe(false);
    expect(st().history).toHaveLength(0);
    expect(st().redoStack).toHaveLength(0);
  });
  it("cancelDrag drops the drag's history entry and restores the pre-drag state", () => {
    st().commit(addWidgetOp("text", "t1"));
    st().commit(nudgeWidgets(["t1"], 1, 0));
    st().undo(); // redoStack has one entry the drag must not lose
    st().markSaved();
    const before = st().draft;
    const hist = st().history.length;
    const redo = st().redoStack;
    st().pushHistory();
    st().applyLive(nudgeWidgets(["t1"], 40, 0));
    st().cancelDrag();
    expect(st().draft).toBe(before);
    expect(st().history).toHaveLength(hist);
    expect(st().redoStack).toBe(redo);
    expect(st().dirty).toBe(false);
  });
  it("cancelDrag at the history cap restores the entry the snapshot evicted", () => {
    for (let i = 0; i < 50; i++) st().commit(addWidgetOp("text", `w${i}`));
    const oldest = st().history[0];
    st().pushHistory();
    st().cancelDrag();
    expect(st().history).toHaveLength(50);
    expect(st().history[0]).toBe(oldest);
  });
  it("cancelDrag without a pending drag push is a no-op", () => {
    st().commit(addWidgetOp("text", "t1"));
    const before = st().draft;
    st().cancelDrag();
    expect(st().draft).toBe(before);
    expect(st().history).toHaveLength(1);
    // A commit after pushHistory ends the drag window too.
    st().pushHistory();
    st().commit(nudgeWidgets(["t1"], 1, 0));
    const after = st().draft;
    st().cancelDrag();
    expect(st().draft).toBe(after);
  });
  it("sampleKind defaults to song", () => {
    expect(st().sampleKind).toBe("song");
  });
});
