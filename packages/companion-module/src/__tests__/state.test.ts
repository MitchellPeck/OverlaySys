import { describe, expect, it } from "vitest";
import { apply } from "../state";
import { initialState } from "../types";
import type { ServerMessage } from "@overlaysys/ws-protocol";

describe("apply — connection lifecycle", () => {
  it("marks connected on local connect event", () => {
    const s = apply(initialState(), { type: "local_connected" });
    expect(s.connected).toBe(true);
    expect(s.connectionState).toBe("connected");
  });

  it("marks reconnecting on local reconnecting event", () => {
    const s = apply(initialState(), { type: "local_reconnecting" });
    expect(s.connectionState).toBe("reconnecting");
    expect(s.connected).toBe(false);
  });

  it("marks disconnected on local disconnect event", () => {
    let s = apply(initialState(), { type: "local_connected" });
    s = apply(s, { type: "local_disconnected" });
    expect(s.connected).toBe(false);
    expect(s.connectionState).toBe("disconnected");
  });
});

describe("apply — channel state", () => {
  it("upserts channel state from `state` message", () => {
    const msg: ServerMessage = {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hi" },
          phase: "on",
          takenAt: 1000,
        },
      },
    };
    const s = apply(initialState(), msg);
    expect(s.channelStates.get("program")?.active?.templateId).toBe("tpl-1");
  });

  it("replaces prior channel state", () => {
    let s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: { templateId: "tpl-1", data: {}, phase: "on", takenAt: 1 },
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(s.channelStates.get("program")?.active).toBeNull();
  });
});

describe("apply — list updates", () => {
  it("stores template list", () => {
    const s = apply(initialState(), {
      type: "template_list",
      templates: [
        { id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } },
      ],
    });
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0]?.name).toBe("Lower Third");
  });

  it("stores hotcard list", () => {
    const s = apply(initialState(), {
      type: "hotcard_list",
      hotcards: [{ id: "h1", name: "Charlie L3", templateId: "tpl-1" }],
    });
    expect(s.hotcards).toHaveLength(1);
  });

  it("stores show list", () => {
    const s = apply(initialState(), {
      type: "show_list",
      shows: [{ id: "show-1", name: "Sunday Service", rowCount: 5 }],
    });
    expect(s.shows[0]?.name).toBe("Sunday Service");
  });

  it("stores song list", () => {
    const s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Amazing Grace" }],
    });
    expect(s.songs[0]?.title).toBe("Amazing Grace");
  });

  it("stores channel list", () => {
    const s = apply(initialState(), {
      type: "channel_list",
      configs: [
        { id: "program", name: "Program", renderMode: "normal", background: "#000" },
      ],
    });
    expect(s.channels[0]?.id).toBe("program");
  });
});

describe("apply — show and song caches", () => {
  it("caches a full show on `show` message", () => {
    const s = apply(initialState(), {
      type: "show",
      show: {
        id: "show-1",
        name: "Sunday",
        rows: [
          {
            kind: "graphic",
            id: "r1",
            templateId: "tpl-1",
            data: {},
          },
        ],
      },
    });
    expect(s.showCache.get("show-1")?.rows).toHaveLength(1);
  });

  it("caches a full song on `song` message", () => {
    const s = apply(initialState(), {
      type: "song",
      song: {
        id: "s1",
        title: "Test",
        sections: [
          {
            id: "sec1",
            kind: "verse",
            label: "V1",
            slides: [{ id: "sl1", text: "x" }],
          },
        ],
        defaultArrangement: ["sec1"],
      },
    });
    expect(s.songCache.get("s1")?.sections).toHaveLength(1);
  });
});

describe("apply — STT", () => {
  it("stores spawner status", () => {
    const s = apply(initialState(), {
      type: "stt_spawner_status",
      status: {
        state: "running",
        pid: 12345,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(s.sttSpawner?.state).toBe("running");
  });

  it("stores listener list", () => {
    const s = apply(initialState(), {
      type: "stt_listener_state",
      listeners: [
        { audioSourceId: "src1", label: "vocal", online: true, lastSeen: 0 },
      ],
    });
    expect(s.sttListeners[0]?.online).toBe(true);
  });
});

describe("apply — load_show local event", () => {
  it("sets loadedShowId and resets cursor", () => {
    const s = apply(initialState(), {
      type: "local_load_show",
      showId: "show-1",
    });
    expect(s.loadedShowId).toBe("show-1");
    expect(s.loadedShowRowCursor).toBe(0);
  });

  it("clearing pointer resets cursor too", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, { type: "local_clear_loaded_show" });
    expect(s.loadedShowId).toBeNull();
    expect(s.loadedShowRowCursor).toBeNull();
  });

  it("clears loadedShowId when the show disappears from show_list", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show_list",
      shows: [{ id: "other", name: "Other", rowCount: 0 }],
    });
    expect(s.loadedShowId).toBeNull();
  });

  it("does NOT clear loadedShowId when the loaded show is in show_list", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show_list",
      shows: [{ id: "show-1", name: "Show", rowCount: 0 }],
    });
    expect(s.loadedShowId).toBe("show-1");
  });
});

describe("apply — cursor", () => {
  it("advances the cursor within row bounds", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Show",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
          { kind: "graphic", id: "r3", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_advance", delta: 1 });
    expect(s.loadedShowRowCursor).toBe(1);
    s = apply(s, { type: "local_cursor_advance", delta: 10 });
    expect(s.loadedShowRowCursor).toBe(2);
    s = apply(s, { type: "local_cursor_advance", delta: -10 });
    expect(s.loadedShowRowCursor).toBe(0);
  });

  it("cursor_set finds the row by id", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Show",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    expect(s.loadedShowRowCursor).toBe(1);
  });
});

describe("apply — error message", () => {
  it("stores lastError from server error", () => {
    const s = apply(initialState(), {
      type: "error",
      code: "bad",
      message: "oh no",
    });
    expect(s.lastError).toBe("bad: oh no");
  });
});

describe("apply — unknown message", () => {
  it("returns state unchanged for unrecognized types", () => {
    const before = initialState();
    const after = apply(before, { type: "future_type" } as unknown as ServerMessage);
    expect(after).toEqual(before);
  });
});
