import { describe, expect, it } from "vitest";
import { CURRENT_ITEM_TIMER_ID, type StageTimerInstance } from "@overlaysys/core";
import {
  hotcardImageValue,
  uncachedHotcardIds,
  uncachedTemplateIds,
  orderStageTimers,
  readBool,
  showHasPcoItems,
  stagePreviewWarnings,
  stageMessageTooLong,
  stageTargetNames,
} from "./liveDrawerModel";

const t = (id: string, anchor: number | null, pausedAt: number | null = null) =>
  ({ id, anchor, pausedAt }) as unknown as StageTimerInstance;

describe("readBool", () => {
  const st = (v: string | null) => ({ getItem: () => v });
  it("uses the default when unset, malformed or storage missing", () => {
    expect(readBool(st(null), "k", true)).toBe(true);
    expect(readBool(st("yes"), "k", false)).toBe(false);
    expect(readBool(null, "k", true)).toBe(true);
  });
  it("reads true/false", () => {
    expect(readBool(st("false"), "k", true)).toBe(false);
    expect(readBool(st("true"), "k", false)).toBe(true);
  });
});

describe("orderStageTimers", () => {
  it("lists running, then paused, then not started, stable within a group", () => {
    const out = orderStageTimers([t("a", null), t("b", 1, 2), t("c", 1), t("d", null), t("e", 1)]);
    expect(out.map((x) => x.id)).toEqual(["c", "e", "b", "a", "d"]);
  });
});

describe("stagePreviewWarnings", () => {
  it("names the channel, falling back to its id", () => {
    const out = stagePreviewWarnings(
      [
        { channel: "s1", layoutId: "x" },
        { channel: "zz", layoutId: "y" },
      ],
      [{ id: "s1", name: "Pastor" }],
    );
    expect(out.map((o) => o.text)).toEqual([
      "Stage layout preview is showing on Pastor",
      "Stage layout preview is showing on zz",
    ]);
  });
});

describe("hotcardImageValue", () => {
  it("returns the first filled image field", () => {
    const fields = [
      { key: "t", type: "text" },
      { key: "a", type: "image" },
      { key: "b", type: "image" },
    ];
    expect(hotcardImageValue(fields, { t: "x", a: "", b: "/assets/b.png" })).toBe("/assets/b.png");
    expect(hotcardImageValue(fields, { t: "x" })).toBeNull();
    expect(hotcardImageValue(undefined, undefined)).toBeNull();
  });
});

describe("stageTargetNames / showHasPcoItems", () => {
  it("keeps only stage channels", () => {
    expect(stageTargetNames([{ id: "a", name: "A" }, { id: "b", name: "B", kind: "stage" }])).toEqual(["B"]);
  });
  it("detects sourceRef rows", () => {
    expect(showHasPcoItems([{ kind: "song" }])).toBe(false);
    expect(showHasPcoItems([{ kind: "song" }, { kind: "song", sourceRef: { provider: "pco" } }])).toBe(true);
    expect(showHasPcoItems(undefined)).toBe(false);
  });
});

describe("orderStageTimers pins the current item", () => {
  it("puts the current-item timer first even when not started", () => {
    const out = orderStageTimers([t("a", 1), t(CURRENT_ITEM_TIMER_ID, null)]);
    expect(out.map((x) => x.id)).toEqual([CURRENT_ITEM_TIMER_ID, "a"]);
  });
});

describe("hotcard hydration", () => {
  const cards = [
    { id: "a", projectId: "p" },
    { id: "b", projectId: "p" },
    { id: "c", projectId: "other" },
  ];
  it("lists only this project's uncached cards", () => {
    expect(uncachedHotcardIds(cards, "p", { a: {} })).toEqual(["b"]);
  });
  it("lists templates of cached cards that are not cached, once each", () => {
    const hc = { a: { templateId: "t1" }, b: { templateId: "t1" }, c: { templateId: "t9" } };
    expect(uncachedTemplateIds(cards, "p", hc, {})).toEqual(["t1"]);
    expect(uncachedTemplateIds(cards, "p", hc, { t1: {} })).toEqual([]);
  });
});

describe("stageMessageTooLong", () => {
  const stage = (o: object) => ({ id: "st", name: "Stage", kind: "stage", ...o });
  it("a short message fits the Speaker layout's bar", () =>
    expect(stageMessageTooLong("Wrap up", [stage({})])).toBe(false));
  it("a 200-character message is too long for the built-in message bar (fitFontSize floor 48)", () =>
    expect(stageMessageTooLong("x".repeat(200), [stage({ layoutId: "speaker" })])).toBe(true));
  it("no stage channel, or only custom layouts we can't measure: no hint", () => {
    expect(stageMessageTooLong("x".repeat(200), [{ id: "program", name: "Program", kind: "graphics" }])).toBe(false);
    expect(stageMessageTooLong("x".repeat(200), [stage({ layoutId: "my-custom" })])).toBe(false);
  });
  it("checks the per-kind rule layouts too", () =>
    expect(stageMessageTooLong("x".repeat(200), [stage({ layoutId: "my-custom", layoutRules: { song: "lyrics" } })])).toBe(true));
  it("empty text is never too long", () => expect(stageMessageTooLong("  ", [stage({})])).toBe(false));
});
