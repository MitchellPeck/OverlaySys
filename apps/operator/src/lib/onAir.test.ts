import { describe, expect, it } from "vitest";
import type { ChannelState, Show } from "@overlaysys/core";
import { anythingOnAir, channelHasContent, channelIsLive, clearChannelMessages, onAirCaption, pvwTakeMessages } from "./onAir";

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
    expect(onAirCaption(st, ctx)).toBe("Lower third: Sam");
  });

  it("names a song intro from its row", () => {
    const st: ChannelState = {
      channel: "program",
      active: { templateId: "intro", data: {}, phase: "on", takenAt: 1, subTakeContext: { songRowId: "r1", sub: "intro" } },
    };
    expect(onAirCaption(st, ctx)).toBe("Way Maker · intro");
  });

  it("leads with Blanked when the song session is blanked", () => {
    expect(onAirCaption({ channel: "program", active: null, songSession: { ...session, blanked: true } }, ctx)).toBe("Blanked · Way Maker");
  });

  it("lists video and graphic layers", () => {
    const st: ChannelState = {
      channel: "program",
      active: { templateId: "l3", data: { name: "Pastor Placeholder" }, phase: "on", takenAt: 1 },
      media: { ...videoMedia, label: "Announcements" },
    };
    const c = { ...ctx, templates: [{ id: "l3", name: "L3" }] };
    expect(onAirCaption(st, c)).toBe("Video: Announcements · L3: Pastor Placeholder");
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

  it("counts program and other outputs, never preview (a cue is not on air)", () => {
    const g = (channel: string): ChannelState => ({ channel, active: { templateId: "l3", data: {}, phase: "on", takenAt: 1 } });
    expect(anythingOnAir({ preview: g("preview"), program: { channel: "program", active: null } })).toBe(false);
    expect(anythingOnAir({ preview: { channel: "preview", active: null, songSession: session } })).toBe(false);
    expect(anythingOnAir({ lyrics: g("lyrics") })).toBe(true);
    expect(anythingOnAir({ preview: g("preview"), program: g("program") })).toBe(true);
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

const photoMedia = {
  ...videoMedia,
  rowId: "p1",
  assetUrl: "/assets/p.png",
  label: "Welcome",
  mediaType: "image",
  // A photo has no playback; the server leaves it idle rather than reporting "ended".
  playback: { status: "ended", currentTime: 0, duration: 0, updatedAt: 1 },
} as NonNullable<ChannelState["media"]>;

describe("photos in the media slot", () => {
  it("an image row in the media slot is on air", () => {
    const st: ChannelState = { channel: "program", active: null, media: photoMedia };
    expect(channelIsLive(st)).toBe(true);
    expect(anythingOnAir({ program: st })).toBe(true);
    expect(onAirCaption(st, ctx)).toBe("Photo: Welcome");
    expect(clearChannelMessages(st, "program")).toContainEqual({ type: "media_clear", channel: "program" });
  });
});

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

// [P2b.11] draft preview
describe("an unsaved designer draft on preview", () => {
  const active = { templateId: "__draft__l3", data: { name: "Ada" }, phase: "in" as const, takenAt: 1 };
  it("offers no Take (the server would refuse it)", () => {
    expect(pvwTakeMessages({ channel: "preview", active }, "show1")).toEqual([]);
  });
  it("is captioned with its template's name, marked unsaved", () => {
    expect(onAirCaption({ channel: "preview", active }, ctx)).toBe("Lower third (unsaved draft): Ada");
  });
});
// [/P2b.11]

describe("pvwTakeMessages", () => {
  const pvw = (extra: Partial<ChannelState>): ChannelState => ({ channel: "preview", active: null, ...extra });
  it("promotes a cued song with its session", () => {
    expect(pvwTakeMessages(pvw({ songSession: session, liveRow: { showId: "show1", rowId: "row3" } }), "show1")).toEqual([
      { type: "song_take_pvw_to_pgm", showId: "show1", songRowId: "row3", fromChannel: "preview", toChannel: "program" },
    ]);
  });
  it("moves a cued scripture slide to program and ends the preview session", () => {
    const scriptureSession = { rowId: "row5", reference: "John 3", slideIdx: 2, slideCount: 4, slideReference: "John 3:3", text: "t" };
    expect(pvwTakeMessages(pvw({ scriptureSession, liveRow: { showId: "show1", rowId: "row5" } }), "show1")).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "row5", slideIdx: 2, channel: "program" },
      { type: "scripture_end", channel: "preview" },
    ]);
  });
  it("takes a cued scripture slide under the show it was cued from", () => {
    const scriptureSession = { rowId: "row5", reference: "John 3", slideIdx: 1, slideCount: 4, slideReference: "John 3:3", text: "t" };
    expect(pvwTakeMessages(pvw({ scriptureSession, liveRow: { showId: "showA", rowId: "row5" } }), "showB")).toEqual([
      { type: "scripture_take_slide", showId: "showA", rowId: "row5", slideIdx: 1, channel: "program" },
      { type: "scripture_end", channel: "preview" },
    ]);
  });
  it("swaps a scripture session whose liveRow doesn't match", () => {
    const scriptureSession = { rowId: "row5", reference: "John 3", slideIdx: 1, slideCount: 4, slideReference: "John 3:3", text: "t" };
    expect(pvwTakeMessages(pvw({ scriptureSession, liveRow: { showId: "showA", rowId: "other" } }), "showB")).toEqual([
      { type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" },
    ]);
  });
  it("swaps a plain graphic", () => {
    expect(pvwTakeMessages(pvw({ active: { templateId: "l3", data: {}, phase: "on", takenAt: 1 } }), "show1")).toEqual([
      { type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" },
    ]);
  });
  it("swaps a song cued from another show instead of promoting it", () => {
    expect(pvwTakeMessages(pvw({ songSession: session, liveRow: { showId: "other", rowId: "r" } }), "show1")).toEqual([
      { type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" },
    ]);
  });
  it("is empty with nothing cued", () => {
    expect(pvwTakeMessages(undefined, "show1")).toEqual([]);
    expect(pvwTakeMessages(pvw({}), "show1")).toEqual([]);
  });
});
