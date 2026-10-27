import { describe, expect, it } from "vitest";
import { defaultStageWidget } from "@overlaysys/core";
import {
  applyStageWidgetPatch, decodeTimerSource, encodeTimerSource, moveInOrder, nextSelection, parseNumberDraft, timerSourceOptions,
} from "./stageInspectorLogic";

const rect = { x: 0, y: 0, w: 100, h: 100 };

describe("timer source encoding", () => {
  it("round-trips every shape", () => {
    for (const s of ["firstActive", "currentItem", { channel: "c1" }, { timerId: "t:1" }] as const) {
      expect(decodeTimerSource(encodeTimerSource(s))).toEqual(s);
    }
  });
  it("lists options and flags a missing stored source", () => {
    const opts = timerSourceOptions({ timerId: "gone" }, [{ id: "c1", name: "Main" }], [{ id: "t1", label: "Sermon" }]);
    expect(opts.map((o) => o.label)).toEqual([
      "First active",
      "Current item",
      "Channel: Main",
      "Timer: Sermon",
      "Missing timer (falls back to first active)",
    ]);
    expect(opts.at(-1)!.value).toBe("timer:gone");
    expect(timerSourceOptions({ channel: "c9" }, [], []).at(-1)!.label).toBe("(missing) Channel: c9");
    expect(timerSourceOptions({ channel: "c1" }, [{ id: "c1", name: "Main" }], [])).toHaveLength(3);
  });
});

describe("applyStageWidgetPatch", () => {
  const w = defaultStageWidget("clock", "a", rect);
  it("clamps w/h to the minimum", () => {
    expect(applyStageWidgetPatch(w, { rect: { w: 3, h: -5 } }).rect).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });
  it("merges props and style, removing undefined keys", () => {
    const withBg = applyStageWidgetPatch(w, { style: { background: "#111" }, props: { seconds: true } });
    expect(withBg.style.background).toBe("#111");
    expect((withBg.props as { seconds: boolean }).seconds).toBe(true);
    const cleared = applyStageWidgetPatch(withBg, { style: { background: undefined } });
    expect("background" in cleared.style).toBe(false);
  });
});

describe("list helpers", () => {
  it("moveInOrder clamps", () => {
    const l = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveInOrder(l, "a", 2).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(moveInOrder(l, "c", -4).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("nextSelection", () => {
    expect(nextSelection(["a"], "b", false)).toEqual(["b"]);
    expect(nextSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextSelection(["a", "b"], "b", true)).toEqual(["a"]);
  });
});

describe("parseNumberDraft", () => {
  it("clamps to bounds", () => {
    expect(parseNumberDraft("3", { min: 20 })).toBe(20);
    expect(parseNumberDraft("100", { min: 20 })).toBe(100);
    expect(parseNumberDraft("-5", { min: 0 })).toBe(0);
    expect(parseNumberDraft("2", { min: 0, max: 1 })).toBe(1);
  });
  it("snaps weight to steps of 100 within 100-900", () => {
    expect(parseNumberDraft("640", { min: 100, max: 900, step: 100 })).toBe(600);
    expect(parseNumberDraft("5", { min: 100, max: 900, step: 100 })).toBe(100);
    expect(parseNumberDraft("1200", { min: 100, max: 900, step: 100 })).toBe(900);
  });
  it("rounds ints and rejects junk", () => {
    expect(parseNumberDraft("3.6", { int: true })).toBe(4);
    expect(parseNumberDraft("", {})).toBeNull();
    expect(parseNumberDraft("abc", {})).toBeNull();
  });
});
