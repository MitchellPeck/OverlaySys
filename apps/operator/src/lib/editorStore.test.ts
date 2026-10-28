import { beforeEach, describe, expect, it } from "vitest";
import type { Template } from "@overlaysys/core";
import { blankTemplate, duplicateLayers, nudgeLayers, removeLayers } from "@overlaysys/editor-kit";
import { useEditor } from "./editorStore";
import { isLocalDraftEdit, shouldAdoptIncoming } from "./stageDesigner";

const st = () => useEditor.getState();

function withLayers(ids: string[]): Template {
  const t = blankTemplate("tpl", "T");
  return {
    ...t,
    layers: ids.map((id) => ({
      id,
      name: id,
      visible: true,
      transform: { x: 0, y: 0, w: 10, h: 10, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 },
      type: "shape" as const,
      shape: "rect" as const,
      fill: { kind: "solid" as const, color: "#fff" },
      cornerRadius: 0,
      sides: 6,
      starPoints: 5,
      starInnerRatio: 0.5,
      blur: 0,
    })),
    timelines: {
      in: { duration: 1, tracks: [{ layerId: ids[0] ?? "x", property: "x", keyframes: [{ t: 0, value: 0, easing: "power2.out" }] }] },
      out: { duration: 0.5, tracks: [] },
    },
  };
}

describe("useEditor", () => {
  beforeEach(() => st().setDraft(withLayers(["a", "b"])));

  it("setDraft resets history, selection and puts the playhead on the design pose", () => {
    st().selectLayers(["a"]);
    st().commit(nudgeLayers(["a"], 1, 0));
    st().setDraft(withLayers(["a"]));
    expect(st().history).toEqual([]);
    expect(st().selectedLayerIds).toEqual([]);
    expect(st().selectedLayerId).toBeNull();
    expect(st().scrubTime).toBe(1);
    expect(st().dirty).toBe(false);
  });

  it("pushHistory + cancelDrag leaves no undo step and restores the draft", () => {
    const before = st().draft;
    st().pushHistory();
    st().applyLive(nudgeLayers(["a"], 50, 0));
    expect(st().history).toHaveLength(1);
    st().cancelDrag();
    expect(st().draft).toBe(before);
    expect(st().history).toHaveLength(0);
    expect(st().dirty).toBe(false);
  });

  it("a drag is one undo step", () => {
    st().pushHistory();
    st().applyLive(nudgeLayers(["a"], 5, 0));
    st().applyLive(nudgeLayers(["a"], 5, 0));
    expect(st().history).toHaveLength(1);
    st().undo();
    expect(st().draft!.layers[0]!.transform.x).toBe(0);
  });

  it("selectLayers replaces or toggles; the primary is the last selected", () => {
    st().selectLayers(["a"]);
    st().selectLayers(["b"], true);
    expect(st().selectedLayerIds).toEqual(["a", "b"]);
    expect(st().selectedLayerId).toBe("b");
    st().selectLayers(["b"], true);
    expect(st().selectedLayerIds).toEqual(["a"]);
    expect(st().selectedLayerId).toBe("a");
    st().setSelectedLayer(null);
    expect(st().selectedLayerIds).toEqual([]);
  });

  it("commit and undo prune selected ids that no longer exist", () => {
    st().selectLayers(["a", "b"]);
    st().commit(removeLayers(["b"]));
    expect(st().selectedLayerIds).toEqual(["a"]);
    const created: string[] = [];
    st().commit(duplicateLayers(["a"], created, () => "a2"));
    st().selectLayers(created);
    st().undo();
    expect(st().selectedLayerIds).toEqual([]);
  });

  it("keyframe selection survives edits but not the removal of its track", () => {
    st().setSelectedKeyframe({ trackKey: "a::x", index: 0 });
    st().commit(nudgeLayers(["b"], 1, 1));
    expect(st().selectedKeyframe).toEqual({ trackKey: "a::x", index: 0 });
    st().commit(removeLayers(["a"]));
    expect(st().selectedKeyframe).toBeNull();
  });

  it("an own-save echo is not adopted, so history and selection survive a save", () => {
    st().selectLayers(["a"]);
    st().commit(nudgeLayers(["a"], 3, 0));
    const sent = st().draft!;
    st().markSaved();
    const echo = { ...sent, updatedAt: "2026-10-28T00:00:00Z" };
    expect(shouldAdoptIncoming({ draft: st().draft, dirty: st().dirty, awaitingEchoId: "tpl" }, echo)).toBe(false);
    // Even without the marker, a copy that only differs by updatedAt isn't adopted.
    expect(shouldAdoptIncoming({ draft: st().draft, dirty: st().dirty, awaitingEchoId: null }, echo)).toBe(false);
    expect(st().history).toHaveLength(1);
    expect(st().selectedLayerIds).toEqual(["a"]);
  });

  it("isLocalDraftEdit sees edits, not loads", () => {
    const prev = { draft: st().draft, dirty: false };
    st().commit(nudgeLayers(["a"], 1, 0));
    expect(isLocalDraftEdit(prev, { draft: st().draft, dirty: st().dirty })).toBe(true);
    const p2 = { draft: st().draft, dirty: st().dirty };
    st().setDraft(withLayers(["z"]));
    expect(isLocalDraftEdit(p2, { draft: st().draft, dirty: st().dirty })).toBe(false);
  });
});
