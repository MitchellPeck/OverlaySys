import { describe, expect, it } from "vitest";
import type { ChannelState, Show } from "@overlaysys/core";
import { escArmText, rowFireMessages, sectionKeyAction, sectionKeyFor, sectionMissingText } from "./liveKeys";

const show = {
  id: "show-1",
  name: "Sunday",
  rows: [
    { kind: "graphic", id: "g", templateId: "l3", data: { name: "A" }, channelHint: "program" },
    { kind: "song", id: "s", songId: "song-1", lyricTemplateId: "lyr" },
    { kind: "scripture", id: "sc", reference: "Ref 1:1", slides: [{ text: "Line one" }, { text: "Line two" }] },
    { kind: "scripture", id: "empty", reference: "Ref 2:2", slides: [] },
    { kind: "video", id: "v", assetUrl: "/a/clip.mp4" },
  ],
  songs: [],
} as unknown as Show;
const ctx = {
  show,
  overrides: {},
  caches: { songCache: {}, templateCache: {} },
  channelStates: {} as Record<string, ChannelState>,
};
const row = (id: string) => show.rows.find((r) => r.id === id)!;

describe("rowFireMessages", () => {
  it("cue always targets preview (graphic with a program hint, song, scripture)", () => {
    expect(rowFireMessages(row("g"), "cue", ctx)[0]).toMatchObject({ type: "cue", channel: "preview" });
    expect(rowFireMessages(row("s"), "cue", ctx)[0]).toMatchObject({ type: "song_take", channel: "preview", songRowId: "s" });
    expect(rowFireMessages(row("sc"), "cue", ctx)).toEqual([
      { type: "scripture_take_slide", showId: "show-1", rowId: "sc", slideIdx: 0, channel: "preview" },
    ]);
  });

  it("video has no cue; scripture with no slides sends nothing", () => {
    expect(rowFireMessages(row("v"), "cue", ctx)).toEqual([]);
    expect(rowFireMessages(row("empty"), "take", ctx)).toEqual([]);
  });

  it("taking a scripture already live advances to its next slide", () => {
    const live = {
      ...ctx,
      channelStates: { program: { channel: "program", active: null, scriptureSession: { rowId: "sc", slideIdx: 0 } } } as unknown as Record<string, ChannelState>,
    };
    expect(rowFireMessages(row("sc"), "take", live)[0]).toMatchObject({ slideIdx: 1, channel: "program" });
  });
});

describe("section keys", () => {
  it("maps C/B/T and digits", () => {
    expect(sectionKeyFor("C")).toEqual({ kind: "chorus", ordinal: 1 });
    expect(sectionKeyFor("b")).toEqual({ kind: "bridge", ordinal: 1 });
    expect(sectionKeyFor("t")).toEqual({ kind: "tag", ordinal: 1 });
    expect(sectionKeyFor("3")).toEqual({ kind: "verse", ordinal: 3 });
    expect(sectionKeyFor("0")).toEqual({ kind: "verse", ordinal: 10 });
    expect(sectionKeyFor("x")).toBeNull();
  });

  it("kind-specific copy", () => {
    expect(sectionMissingText("chorus", 1)).toBe("No chorus in this arrangement");
    expect(sectionMissingText("bridge", 1)).toBe("No bridge in this arrangement");
    expect(sectionMissingText("tag", 1)).toBe("No tag in this arrangement");
    expect(sectionMissingText("verse", 3)).toBe("No verse 3 in this arrangement");
  });

  it("a missing section toasts and sends nothing; a present one jumps", () => {
    const song = { sections: [{ id: "v1", kind: "verse" }, { id: "v2", kind: "verse" }] } as never;
    expect(sectionKeyAction({ kind: "chorus", ordinal: 1 }, song, ["v1"])).toEqual({ toast: "No chorus in this arrangement" });
    expect(sectionKeyAction({ kind: "verse", ordinal: 2 }, song, ["v1"])).toEqual({
      send: { type: "song_jump_kind", channel: "program", kind: "verse", ordinal: 2 },
    });
  });

  it("an uncached song still jumps (the server decides)", () =>
    expect(sectionKeyAction({ kind: "tag", ordinal: 1 }, undefined, [])).toHaveProperty("send"));
});

describe("escArmText", () => {
  it("names what the second press does", () => {
    expect(escArmText("song")).toBe("Press Esc again to end song");
    expect(escArmText("other")).toBe("Press Esc again to clear program");
  });
});
