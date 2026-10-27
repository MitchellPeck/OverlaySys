import { describe, expect, it } from "vitest";
import { NONE_SLIDE, StageFeedSchema, StageTimerSchema } from "./stageFeed";
import { SPEAKER_LAYOUT } from "./stageLayout";

describe("StageFeedSchema", () => {
  it("round-trips an empty feed", () => {
    const feed = {
      layout: SPEAKER_LAYOUT,
      current: NONE_SLIDE,
      next: NONE_SLIDE,
      row: null,
      nextRow: null,
      timers: [],
      video: null,
      notes: null,
      message: null,
      serverNow: 1,
    };
    expect(StageFeedSchema.parse(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  });

  it("carries notes and a message", () => {
    const feed = {
      layout: SPEAKER_LAYOUT,
      current: NONE_SLIDE,
      next: NONE_SLIDE,
      row: null,
      nextRow: null,
      timers: [],
      video: null,
      notes: { id: "n", title: "Sermon", points: [{ heading: "A", markdown: "# A" }], pointIdx: 0, scrollOffset: 0 },
      message: { text: "Wrap up", sentAt: 5 },
      serverNow: 1,
    };
    expect(StageFeedSchema.parse(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  });
});

describe("StageTimerSchema", () => {
  it("standalone timer without channel parses", () => {
    const t = { id: "a", source: "manual", overtime: true, running: false, label: "x", mode: "countdown", value: "1" };
    expect(StageTimerSchema.parse(t)).toEqual(t);
  });
});
