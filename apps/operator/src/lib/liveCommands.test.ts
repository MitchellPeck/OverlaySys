import { describe, expect, it } from "vitest";
import type { ChannelState, Hotcard, HotcardMeta, Show } from "@overlaysys/core";
import { CLEAR_ALL_CONFIRM, liveCommands, type LiveCommandState } from "./liveCommands";

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

  it("confirms that change program (or any output) are danger; preview-only ones are not", () => {
    const byId = Object.fromEntries(liveCommands(state).map((c) => [c.id, c.confirm.danger ?? false]));
    expect(byId["take-pvw"]).toBe(true);
    expect(byId["clear-program"]).toBe(true);
    expect(byId["clear-all"]).toBe(true);
    expect(byId["hotcard-take:h1"]).toBe(true);
    expect(byId["clear-preview"]).toBe(false);
    expect(byId["hotcard-cue:h1"]).toBe(false);
  });

  it("Clear all uses the one shared copy", () => {
    expect(liveCommands(state).find((c) => c.id === "clear-all")?.confirm).toMatchObject(CLEAR_ALL_CONFIRM);
    expect(CLEAR_ALL_CONFIRM.title).toBe("Clear all outputs?");
    // Enter confirms Clear all (focus starts on the Clear all button).
    expect(CLEAR_ALL_CONFIRM.enterConfirms).toBe(true);
  });

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

describe("liveCommands reads fresh state at send time", () => {
  // The palette lists commands, then holds a confirm open; meanwhile another
  // console changes the outputs. messages() must reflect the state then.
  const graphic = { templateId: "l3", data: {}, phase: "on", takenAt: 1 } as const;
  const setup = () => {
    let cur: LiveCommandState = { ...stateWithSongOnPvw };
    const cmds = liveCommands(() => cur);
    const set = (next: typeof cur) => (cur = next);
    return { cmds, set, get: () => cur };
  };
  const find = (cmds: ReturnType<typeof liveCommands>, id: string) => cmds.find((c) => c.id === id)!;

  it("take-pvw: preview changed from a song to a graphic after listing", () => {
    const { cmds, set, get } = setup();
    set({ ...get(), channelStates: { preview: { channel: "preview", active: graphic } } as Record<string, ChannelState> });
    expect(find(cmds, "take-pvw").messages()).toEqual([{ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" }]);
  });

  it("clear-program: a video started on program after listing is cleared too", () => {
    const { cmds, set, get } = setup();
    set({ ...get(), channelStates: { program: { channel: "program", active: null, media: { rowId: "v" } } } as unknown as Record<string, ChannelState> });
    expect(find(cmds, "clear-program").messages()).toContainEqual({ type: "media_clear", channel: "program" });
  });

  it("clear-all: a channel that gained content after listing is cleared", () => {
    const { cmds, set, get } = setup();
    set({ ...get(), channelStates: { "lower-thirds": { channel: "lower-thirds", active: graphic } } as Record<string, ChannelState> });
    expect(find(cmds, "clear-all").messages()).toEqual([{ type: "clear", channel: "lower-thirds" }]);
  });

  it("hotcard: sends the card body as edited meanwhile; nothing once it's gone", () => {
    const { cmds, set, get } = setup();
    set({ ...get(), hotcardCache: { ...get().hotcardCache, h1: { ...welcome, data: { title: "Edited line" } } } });
    expect(find(cmds, "hotcard-take:h1").messages()[0]).toMatchObject({ data: { title: "Edited line" } });
    set({ ...get(), hotcardCache: {} });
    expect(find(cmds, "hotcard-cue:h1").messages()).toEqual([]);
  });
});
