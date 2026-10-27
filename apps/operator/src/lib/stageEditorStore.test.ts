import { beforeEach, describe, expect, it } from "vitest";
import { StageLayoutSchema, type StageLayout } from "@overlaysys/core";
import { useStageEditor } from "./stageEditorStore";
import { addWidget, nudgeWidgets } from "./stageLayoutOps";

const blank = StageLayoutSchema.parse({ id: "l", name: "L", widgets: [] }) as StageLayout;
const st = () => useStageEditor.getState();

describe("useStageEditor", () => {
  beforeEach(() => st().setDraft(blank));

  it("commit pushes history; undo/redo round-trip; no-op commit adds nothing", () => {
    st().commit(addWidget("text", "t1"));
    st().commit(() => {});
    expect(st().history).toHaveLength(1);
    expect(st().dirty).toBe(true);
    st().undo();
    expect(st().draft!.widgets).toHaveLength(0);
    st().redo();
    expect(st().draft!.widgets).toHaveLength(1);
  });
  it("applyLive changes draft without history; pushHistory snapshots once per drag", () => {
    st().commit(addWidget("text", "t1"));
    const hist = st().history.length;
    st().pushHistory();
    st().applyLive(nudgeWidgets(["t1"], 5, 0));
    st().applyLive(nudgeWidgets(["t1"], 5, 0));
    expect(st().history).toHaveLength(hist + 1);
    expect(st().draft!.widgets[0]!.rect.x).toBe(730);
    st().undo();
    expect(st().draft!.widgets[0]!.rect.x).toBe(720);
  });
  it("undo prunes selection ids that no longer exist", () => {
    st().commit(addWidget("text", "t1"));
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
    for (let i = 0; i < 60; i++) st().commit(addWidget("text", `w${i}`));
    expect(st().history).toHaveLength(50);
  });
  it("commit clears the redo stack", () => {
    st().commit(addWidget("text", "t1"));
    st().undo();
    expect(st().redoStack).toHaveLength(1);
    st().commit(addWidget("text", "t2"));
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
  it("sampleKind defaults to song", () => {
    expect(st().sampleKind).toBe("song");
  });
});
