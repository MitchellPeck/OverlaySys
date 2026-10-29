import { describe, expect, it } from "vitest";
import type { ChannelState, Hotcard, HotcardMeta, Show } from "@overlaysys/core";
import { liveCommands } from "./liveCommands";

const welcome: Hotcard = { id: "h1", name: "Welcome", projectId: "p1", templateId: "l3", data: { title: "Line one" }, channelHint: "program" };
const other: Hotcard = { id: "h2", name: "Elsewhere", projectId: "p2", templateId: "l3", data: {} };
const metas: HotcardMeta[] = [welcome, other].map(({ id, name, projectId, templateId, channelHint }) => ({ id, name, projectId, templateId, channelHint }));

const show = {
  id: "show-1",
  name: "Sunday",
  rows: [{ kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lyr" }],
  songs: [],
} as unknown as Show;

const state = {
  channelStates: {} as Record<string, ChannelState>,
  hotcards: metas,
  hotcardCache: { h1: welcome, h2: other },
  currentProjectId: "p1",
  show,
};

const session = {
  songId: "s1",
  lyricTemplateId: "lyr",
  arrangement: [],
  cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false,
  trustMode: false,
  startedAt: 1,
};
const stateWithSongOnPvw = {
  ...state,
  channelStates: {
    preview: { channel: "preview", active: null, songSession: session, liveRow: { showId: "show-1", rowId: "r1" } },
  } as Record<string, ChannelState>,
};

describe("liveCommands", () => {
  it("every on-air command needs confirmation", () =>
    expect(liveCommands(state).every((c) => c.confirm.confirmLabel.length > 0)).toBe(true));

  it("lists hotcards of the current project only", () =>
    expect(liveCommands(state).filter((c) => c.id.startsWith("hotcard-take:")).map((c) => c.label)).toEqual(["Take hotcard Welcome"]));

  it("a hotcard cue goes to preview even with a default output", () =>
    expect(liveCommands(state).find((c) => c.id.startsWith("hotcard-cue:"))!.messages()[0]).toMatchObject({ type: "cue", channel: "preview" }));

  it("Take preview uses pvwTakeMessages", () =>
    expect(liveCommands(stateWithSongOnPvw).find((c) => c.id === "take-pvw")!.messages()[0]!.type).toBe("song_take_pvw_to_pgm"));

  it("has the fixed on-air verbs, all in the On air group", () => {
    const cmds = liveCommands(state);
    expect(cmds.slice(0, 4).map((c) => [c.id, c.label])).toEqual([
      ["take-pvw", "Take preview to program"],
      ["clear-program", "Clear program"],
      ["clear-preview", "Clear preview"],
      ["clear-all", "Clear all outputs"],
    ]);
    expect(cmds.every((c) => c.group === "On air")).toBe(true);
  });

  it("a hotcard take follows hotcardRoute", () => {
    const routed = { ...welcome, channelHint: "lower-thirds" };
    const s = { ...state, hotcardCache: { h1: routed } };
    expect(liveCommands(s).find((c) => c.id === "hotcard-take:h1")!.messages()).toEqual([
      { type: "take", channel: "lower-thirds", templateId: "l3", data: { title: "Line one" } },
    ]);
  });

  it("a hotcard whose body isn't loaded yet is left out (it couldn't fire)", () =>
    expect(liveCommands({ ...state, hotcardCache: {} }).some((c) => c.id.startsWith("hotcard-"))).toBe(false));

  it("clear program also clears program video", () => {
    const s = {
      ...state,
      channelStates: {
        program: { channel: "program", active: null, media: { rowId: "v" } },
      } as unknown as Record<string, ChannelState>,
    };
    expect(liveCommands(s).find((c) => c.id === "clear-program")!.messages()).toEqual([
      { type: "clear", channel: "program" },
      { type: "media_clear", channel: "program" },
    ]);
  });

  it("clear all clears every channel with content", () => {
    const s = {
      ...state,
      channelStates: {
        program: { channel: "program", active: { templateId: "l3", data: {}, phase: "on", takenAt: 1 } },
        preview: { channel: "preview", active: null },
        "lower-thirds": { channel: "lower-thirds", active: { templateId: "l3", data: {}, phase: "on", takenAt: 1 } },
      } as Record<string, ChannelState>,
    };
    expect(liveCommands(s).find((c) => c.id === "clear-all")!.messages()).toEqual([
      { type: "clear", channel: "program" },
      { type: "clear", channel: "lower-thirds" },
    ]);
  });
});
