import { describe, expect, it } from "vitest";
import type { ChannelState, Show } from "@overlaysys/core";
import { anythingOnAir, channelHasContent, clearChannelMessages, onAirCaption } from "./onAir";

const show = {
  id: "show",
  name: "Show",
  rows: [{ kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lyr" }],
  songs: [],
} as unknown as Show;
const ctx = { show, songs: [{ id: "s1", title: "Way Maker" }], templates: [{ id: "l3", name: "Lower third" }] };
const session = {
  songId: "s1",
  lyricTemplateId: "lyr",
  arrangement: [],
  cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false,
  trustMode: false,
  startedAt: 1,
};

describe("onAirCaption", () => {
  it("names a live song", () => {
    expect(onAirCaption({ channel: "program", active: null, songSession: session }, ctx)).toBe("Way Maker");
  });

  it("names a graphic by template and its title-ish field", () => {
    const st: ChannelState = { channel: "program", active: { templateId: "l3", data: { name: "Sam" }, phase: "on", takenAt: 1 } };
    expect(onAirCaption(st, ctx)).toBe("Lower third · Sam");
  });

  it("names a song intro from its row", () => {
    const st: ChannelState = {
      channel: "program",
      active: { templateId: "intro", data: {}, phase: "on", takenAt: 1, subTakeContext: { songRowId: "r1", sub: "intro" } },
    };
    expect(onAirCaption(st, ctx)).toBe("Way Maker · intro");
  });

  it("is null for an empty or outgoing channel", () => {
    expect(onAirCaption(undefined, ctx)).toBeNull();
    expect(onAirCaption({ channel: "program", active: { templateId: "l3", data: {}, phase: "out", takenAt: 1 } }, ctx)).toBeNull();
  });
});

describe("anythingOnAir / channelHasContent", () => {
  it("sees a graphic, ignores a blanked song and an empty channel", () => {
    const g: ChannelState = { channel: "program", active: { templateId: "l3", data: {}, phase: "on", takenAt: 1 } };
    expect(anythingOnAir({ program: g })).toBe(true);
    expect(anythingOnAir({ program: { channel: "program", active: null, songSession: { ...session, blanked: true } } })).toBe(false);
    expect(anythingOnAir({ program: { channel: "program", active: null } })).toBe(false);
    expect(channelHasContent({ channel: "program", active: null, songSession: { ...session, blanked: true } })).toBe(true);
  });
});

const videoMedia = {
  rowId: "v1",
  assetUrl: "/assets/v.mp4",
  volume: 1,
  endAction: "clear",
  transitionIn: { style: "fade", durationMs: 500 },
  transitionOut: { style: "fade", durationMs: 500 },
  takenAt: 1,
  paused: false,
  playback: { status: "playing", currentTime: 3, duration: 60, updatedAt: 1 },
} as NonNullable<ChannelState["media"]>;

describe("clearChannelMessages", () => {
  it("clears graphics only when no media is on the channel", () => {
    expect(clearChannelMessages({ channel: "program", active: null }, "program")).toEqual([{ type: "clear", channel: "program" }]);
    expect(clearChannelMessages(undefined, "preview")).toEqual([{ type: "clear", channel: "preview" }]);
  });

  it("adds media_clear when a video is on the channel", () => {
    expect(clearChannelMessages({ channel: "program", active: null, media: videoMedia }, "program")).toEqual([
      { type: "clear", channel: "program" },
      { type: "media_clear", channel: "program" },
    ]);
  });
});
