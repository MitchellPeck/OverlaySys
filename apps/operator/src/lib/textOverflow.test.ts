import { describe, expect, it } from "vitest";
import type { Template } from "@overlaysys/core";
import { measureTextLayers, overflowSummary, templateHasVisibleText, textFieldLayers } from "./textOverflow";

type Layers = Template["layers"];
const tf = { x: 0, y: 0, w: 100, h: 20 };
const text = (id: string, fieldKey: string | null, visible = true) =>
  ({ id, name: id, type: "text", visible, transform: tf, content: fieldKey ? { fieldKey } : "Literal", style: {} }) as unknown as Layers[number];
const group = (children: Layers, visible = true) =>
  ({ id: "g", name: "g", type: "group", visible, transform: tf, children }) as unknown as Layers[number];
const shape = { id: "s", name: "s", type: "shape", visible: true, transform: tf } as unknown as Layers[number];

describe("overflowSummary", () => {
  it("overflowSummary estimates characters shown", () =>
    expect(
      overflowSummary([{ key: "h", label: "Header", text: "x".repeat(35), scrollW: 700, clientW: 360, scrollH: 40, clientH: 40 }])[0],
    ).toMatchObject({ shown: 18, total: 35, message: "Header doesn't fit: about 18 of 35 characters shown" }));

  it("fitting text is not reported", () =>
    expect(overflowSummary([{ key: "h", label: "H", text: "ok", scrollW: 10, clientW: 10, scrollH: 10, clientH: 10 }])).toEqual([]));

  it("multiplies the width and height ratios", () => {
    const [s] = overflowSummary([{ key: "b", label: "Body", text: "x".repeat(100), scrollW: 200, clientW: 100, scrollH: 40, clientH: 20 }]);
    expect(s).toMatchObject({ key: "b", label: "Body", shown: 25, total: 100 });
  });

  it("ignores sub-pixel rounding, empty text and unmeasured boxes", () => {
    expect(overflowSummary([{ key: "a", label: "A", text: "abc", scrollW: 101, clientW: 100, scrollH: 20, clientH: 20 }])).toEqual([]);
    expect(overflowSummary([{ key: "a", label: "A", text: "", scrollW: 500, clientW: 100, scrollH: 20, clientH: 20 }])).toEqual([]);
    expect(overflowSummary([{ key: "a", label: "A", text: "abc", scrollW: 500, clientW: 0, scrollH: 20, clientH: 0 }])).toEqual([]);
  });
});

describe("templateHasVisibleText", () => {
  it("templateHasVisibleText looks inside groups and ignores hidden layers", () => {
    expect(templateHasVisibleText({ layers: [group([text("t", "a", false)])] })).toBe(false);
    expect(templateHasVisibleText({ layers: [group([text("t", "a")])] })).toBe(true);
  });

  it("a hidden group hides its text; no layers means no text", () => {
    expect(templateHasVisibleText({ layers: [group([text("t", "a")], false)] })).toBe(false);
    expect(templateHasVisibleText({ layers: [shape] })).toBe(false);
    expect(templateHasVisibleText({ layers: [] })).toBe(false);
  });
});

describe("textFieldLayers", () => {
  it("maps visible field-bound text layers to their field, through groups", () => {
    const layers: Layers = [text("t1", "name"), text("lit", null), group([text("t2", "title"), text("t3", "hidden", false)])];
    expect(textFieldLayers({ layers })).toEqual([
      { layerId: "t1", fieldKey: "name" },
      { layerId: "t2", fieldKey: "title" },
    ]);
  });
});

describe("measureTextLayers", () => {
  it("labels each bound layer's box from the template's fields and skips layers not in the DOM", () => {
    const tpl = {
      layers: [text("t1", "name"), text("t2", "title")],
      fields: [{ key: "name", label: "Name", type: "text" }],
    } as unknown as Pick<Template, "layers" | "fields">;
    const box = (sw: number) => ({ scrollWidth: sw, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
    const out = measureTextLayers(tpl, { name: "Long name" }, (id) => (id === "t1" ? { box: box(100), span: box(300) } : null));
    expect(out).toEqual([{ key: "name", label: "Name", text: "Long name", scrollW: 300, clientW: 100, scrollH: 20, clientH: 20 }]);
  });
});
