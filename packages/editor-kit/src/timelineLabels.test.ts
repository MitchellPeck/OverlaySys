import { describe, expect, it } from "vitest";
import type { Layer, Template, Track } from "@overlaysys/core";
import {
  TRACK_PROPERTY_LABELS,
  groupTracksByLayer,
  layersMissingOut,
  missingOutMessage,
} from "./timelineLabels";

const T = { x: 0, y: 0, w: 100, h: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };

function layer(id: string, name: string, children?: Layer[]): Layer {
  if (children) return { id, name, visible: true, transform: T, type: "group", children } as unknown as Layer;
  return { id, name, visible: true, transform: T, type: "shape", shape: "rect" } as unknown as Layer;
}
function track(layerId: string, property: Track["property"]): Track {
  return { layerId, property, keyframes: [{ t: 0, value: 0, easing: "power2.out" }] };
}
function tpl(layers: Layer[], inTracks: Track[], outTracks: Track[]): Template {
  return {
    id: "t",
    name: "T",
    size: { w: 1920, h: 1080 },
    fields: [],
    layers,
    timelines: { in: { duration: 1, tracks: inTracks }, out: { duration: 0.5, tracks: outTracks } },
    fonts: [],
  } as unknown as Template;
}

describe("TRACK_PROPERTY_LABELS", () => {
  it("names every property with its unit", () => {
    expect(TRACK_PROPERTY_LABELS.rotation.unit).toBe("°");
    expect(TRACK_PROPERTY_LABELS.scaleX).toEqual({ label: "Scale X", unit: "×" });
    expect(TRACK_PROPERTY_LABELS.opacity).toEqual({ label: "Opacity", unit: "" });
    expect(Object.keys(TRACK_PROPERTY_LABELS).sort()).toEqual(
      ["h", "opacity", "rotation", "scaleX", "scaleY", "w", "wipe", "x", "y"],
    );
  });
});

describe("layersMissingOut", () => {
  it("lists layers that animate in but not out", () => {
    const t = tpl(
      [layer("title", "Title"), layer("subtitle", "Subtitle")],
      [track("title", "opacity"), track("subtitle", "opacity"), track("subtitle", "y")],
      [track("title", "opacity")],
    );
    expect(layersMissingOut(t)).toEqual([{ layerId: "subtitle", name: "Subtitle" }]);
  });
  it("ignores layers with no in tracks, and walks groups in layer order", () => {
    const t = tpl(
      [layer("g", "Group", [layer("a", "A"), layer("b", "B")]), layer("c", "C")],
      [track("c", "x"), track("a", "x")],
      [],
    );
    expect(layersMissingOut(t)).toEqual([
      { layerId: "a", name: "A" },
      { layerId: "c", name: "C" },
    ]);
  });
  it("words the warning", () => {
    expect(missingOutMessage("Subtitle")).toBe("Subtitle has no out animation: it will cut");
  });
});

describe("groupTracksByLayer", () => {
  it("groups tracks under their layer in layer-panel order, keeping each track's index", () => {
    const layers = [layer("title", "Title"), layer("subtitle", "Subtitle")];
    const tracks = [track("title", "opacity"), track("subtitle", "y"), track("title", "x")];
    const groups = groupTracksByLayer(layers, tracks);
    expect(groups.map((g) => g.layerId)).toEqual(["subtitle", "title"]);
    expect(groups[1]!.name).toBe("Title");
    expect(groups[1]!.tracks.map((e) => [e.index, e.track.property])).toEqual([[0, "opacity"], [2, "x"]]);
  });
  it("puts tracks of unknown layers last, under a generic name", () => {
    const groups = groupTracksByLayer([layer("a", "A")], [track("gone", "x"), track("a", "y")]);
    expect(groups.map((g) => [g.layerId, g.name])).toEqual([["a", "A"], ["gone", "Missing layer"]]);
  });
});
