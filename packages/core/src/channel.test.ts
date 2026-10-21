import { describe, expect, it } from "vitest";
import { ChannelStateSchema, ChannelMediaSchema } from "./channel";

const media = {
  rowId: "r1",
  assetUrl: "/assets/abc.mp4",
  volume: 1,
  endAction: "clear",
  takenAt: 1000,
  paused: false,
  playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: 1000 },
};

describe("ChannelMediaSchema", () => {
  it("parses a fresh take", () => {
    const m = ChannelMediaSchema.parse(media);
    expect(m.seek).toBeUndefined();
    expect(m.playback.status).toBe("loading");
  });

  it("defaults missing transitions to a 500 ms fade", () => {
    const m = ChannelMediaSchema.parse(media);
    expect(m.transitionIn).toEqual({ style: "fade", durationMs: 500 });
    expect(m.transitionOut).toEqual({ style: "fade", durationMs: 500 });
  });

  it("parses seek and error", () => {
    const m = ChannelMediaSchema.parse({
      ...media,
      seek: { time: 12.5, seq: 3 },
      playback: { ...media.playback, status: "error", error: "boom" },
    });
    expect(m.seek).toEqual({ time: 12.5, seq: 3 });
    expect(m.playback.error).toBe("boom");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      ChannelMediaSchema.parse({ ...media, playback: { ...media.playback, status: "buffering" } }),
    ).toThrow();
  });
});

describe("ChannelStateSchema.media", () => {
  it("is optional (legacy state)", () => {
    const s = ChannelStateSchema.parse({ channel: "program", active: null });
    expect(s.media).toBeUndefined();
  });

  it("accepts null and a media object", () => {
    expect(ChannelStateSchema.parse({ channel: "p", active: null, media: null }).media).toBeNull();
    expect(ChannelStateSchema.parse({ channel: "p", active: null, media }).media?.rowId).toBe("r1");
  });
});
