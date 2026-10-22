import { describe, expect, it } from "vitest";
import { NONE_SLIDE, StageFeedSchema } from "./stageFeed";
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
      serverNow: 1,
    };
    expect(StageFeedSchema.parse(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  });
});
