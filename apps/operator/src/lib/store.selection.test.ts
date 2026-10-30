import { beforeEach, describe, expect, it } from "vitest";
import type { ChannelState, Show } from "@overlaysys/core";
import { useStore } from "./store";

const show = (id: string, rowIds: string[] = ["r1", "r2"]): Show =>
  ({
    id,
    name: id,
    rows: rowIds.map((rid) => ({ kind: "graphic", id: rid, templateId: "l3", data: {} })),
    songs: [],
  }) as unknown as Show;

beforeEach(() => {
  useStore.setState({
    show: null,
    requestedShowId: null,
    selectedRowId: null,
    selectedHotcardId: null,
    rowDataOverrides: {},
  });
});

describe("setShow selection", () => {
  it("selects the first row on first load", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedRowId).toBe("r1");
  });

  it("keeps the selected row across a re-broadcast", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setSelectedRow("r2");
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedRowId).toBe("r2");
  });

  it("keeps a selected hotcard across a re-broadcast instead of reselecting row 1", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setSelectedHotcard("h1");
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedHotcardId).toBe("h1");
    expect(useStore.getState().selectedRowId).toBeNull();
  });
});

describe("adoptRequestedShow", () => {
  it("ignores another show's broadcast while one is loaded", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().adoptRequestedShow(show("b"))).toBe(false);
    expect(useStore.getState().show?.id).toBe("a");
  });

  it("adopts the show the operator asked for, then forgets the request", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setRequestedShowId("b");
    expect(useStore.getState().adoptRequestedShow(show("b"))).toBe(true);
    expect(useStore.getState().show?.id).toBe("b");
    expect(useStore.getState().requestedShowId).toBeNull();
  });

  it("leaves a same-id broadcast to the ws handler", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().adoptRequestedShow(show("a"))).toBe(false);
  });
});

describe("receiveShow (every `show` message from the server)", () => {
  it("does not make an unrequested show the Live show when none is loaded", () => {
    // e.g. an export or editor fetch, or another console's save
    useStore.getState().receiveShow(show("x"));
    expect(useStore.getState().show).toBeNull();
  });

  it("adopts the show Live asked for when none is loaded", () => {
    useStore.getState().setRequestedShowId("a");
    useStore.getState().receiveShow(show("x"));
    expect(useStore.getState().show).toBeNull();
    useStore.getState().receiveShow(show("a"));
    expect(useStore.getState().show?.id).toBe("a");
    expect(useStore.getState().requestedShowId).toBeNull();
  });

  it("updates the loaded show and ignores other shows", () => {
    useStore.getState().setShow(show("a", ["r1"]));
    useStore.getState().receiveShow(show("a", ["r1", "r2"]));
    expect(useStore.getState().show?.rows).toHaveLength(2);
    useStore.getState().receiveShow(show("b"));
    expect(useStore.getState().show?.id).toBe("a");
  });
});

describe("selection follows a row taken elsewhere (e.g. Companion)", () => {
  const live = (channel: string, rowId: string, showId = "a"): ChannelState => ({
    channel,
    active: { templateId: "l3", data: {}, phase: "in", takenAt: 1 },
    liveRow: { showId, rowId },
  });
  const idle = (channel: string): ChannelState => ({ channel, active: null });

  beforeEach(() => useStore.setState({ channelStates: {} }));

  it("moves the selection to the row newly taken to program", () => {
    useStore.getState().setShow(show("a", ["r1", "r2", "r3"]));
    useStore.getState().setChannelState(idle("program"));
    useStore.getState().setChannelState(live("program", "r3"));
    expect(useStore.getState().selectedRowId).toBe("r3");
  });

  it("follows a take to a routed output, but not a cue to preview", () => {
    useStore.getState().setShow(show("a", ["r1", "r2", "r3"]));
    useStore.getState().setChannelState(idle("preview"));
    useStore.getState().setChannelState(live("preview", "r2"));
    expect(useStore.getState().selectedRowId).toBe("r1");
    useStore.getState().setChannelState(idle("lower"));
    useStore.getState().setChannelState(live("lower", "r3"));
    expect(useStore.getState().selectedRowId).toBe("r3");
  });

  it("leaves the selection alone when the live row didn't change (song/slide advance)", () => {
    useStore.getState().setShow(show("a", ["r1", "r2", "r3"]));
    useStore.getState().setChannelState(idle("program"));
    useStore.getState().setChannelState(live("program", "r2"));
    useStore.getState().setSelectedRow("r3");
    useStore.getState().setChannelState({ ...live("program", "r2"), active: { templateId: "l3", data: {}, phase: "in", takenAt: 2 } });
    expect(useStore.getState().selectedRowId).toBe("r3");
  });

  it("ignores the first state heard for a channel (app load, reconnect of a new tab)", () => {
    useStore.getState().setShow(show("a", ["r1", "r2", "r3"]));
    useStore.getState().setChannelState(live("program", "r3"));
    expect(useStore.getState().selectedRowId).toBe("r1");
  });

  it("ignores a row from another show", () => {
    useStore.getState().setShow(show("a", ["r1", "r2"]));
    useStore.getState().setChannelState(idle("program"));
    useStore.getState().setChannelState(live("program", "r2", "b"));
    expect(useStore.getState().selectedRowId).toBe("r1");
  });

  it("takes over from a selected hotcard", () => {
    useStore.getState().setShow(show("a", ["r1", "r2"]));
    useStore.getState().setSelectedHotcard("h1");
    useStore.getState().setChannelState(idle("program"));
    useStore.getState().setChannelState(live("program", "r2"));
    expect(useStore.getState().selectedRowId).toBe("r2");
    expect(useStore.getState().selectedHotcardId).toBeNull();
  });
});
