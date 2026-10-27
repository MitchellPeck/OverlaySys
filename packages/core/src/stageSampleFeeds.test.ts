import { describe, expect, it } from "vitest";
import { StageFeedSchema } from "./stageFeed";
import { SPEAKER_LAYOUT } from "./stageLayout";
import { STAGE_SAMPLE_KINDS, STAGE_SAMPLE_LABELS, sampleStageFeed } from "./stageSampleFeeds";
import { decodeTimerValue } from "./timeField";

const now = 1_700_000_000_000;

describe("sampleStageFeed", () => {
  it.each(STAGE_SAMPLE_KINDS)("%s parses as a StageFeed and carries the layout", (k) => {
    const f = sampleStageFeed(k, SPEAKER_LAYOUT, now);
    expect(StageFeedSchema.parse(f)).toEqual(f);
    expect(f.layout).toBe(SPEAKER_LAYOUT);
    expect(f.serverNow).toBe(now);
  });
  it("labels every kind", () => {
    expect(Object.keys(STAGE_SAMPLE_LABELS).sort()).toEqual([...STAGE_SAMPLE_KINDS].sort());
  });
  it("song shows lyric current and next", () => {
    const f = sampleStageFeed("song", SPEAKER_LAYOUT, now);
    expect(f.current.kind).toBe("lyric");
    expect(f.next.kind).toBe("lyric");
    expect(f.row?.title).toBeTruthy();
  });
  it("notes has several points with the second active", () => {
    const f = sampleStageFeed("notes", SPEAKER_LAYOUT, now);
    expect(f.notes!.points.length).toBeGreaterThanOrEqual(3);
    expect(f.notes!.pointIdx).toBe(1);
  });
  it("itemOvertime is an item countdown 1:23 past zero", () => {
    const t = sampleStageFeed("itemOvertime", SPEAKER_LAYOUT, now).timers[0]!;
    expect(t).toMatchObject({ source: "item", mode: "countdown", overtime: true, running: true });
    expect(decodeTimerValue(t.value).anchor).toBe(now - 83_000);
  });
  it("pcoLive sets the service view", () => {
    const s = sampleStageFeed("pcoLive", SPEAKER_LAYOUT, now).service!;
    expect(s).toMatchObject({ source: "pco", status: "live", itemIndex: 4, itemCount: 12 });
    expect(s.plannedEndAt).toBeGreaterThan(now);
  });
  it("message sample is fresh", () => {
    expect(sampleStageFeed("message", SPEAKER_LAYOUT, now).message).toEqual({ text: "Wrap up", sentAt: now });
  });
});
