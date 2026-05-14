import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import { feedbackPredicate } from "../feedbacks";

describe("feedbacks", () => {
  it("channel_is_live = true when channel has active", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: { templateId: "t", data: {}, phase: "on", takenAt: 0 },
      },
    });
    expect(feedbackPredicate(s, "channel_is_live", { channel: "program" })).toBe(
      true,
    );
  });

  it("channel_is_live = false when channel cleared", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(feedbackPredicate(s, "channel_is_live", { channel: "program" })).toBe(
      false,
    );
  });

  it("channel_is_blank = inverse of channel_is_live", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(feedbackPredicate(s, "channel_is_blank", { channel: "program" })).toBe(
      true,
    );
  });

  it("hotcard_on_air = true when channel matches hotcard data", () => {
    let s = apply(initialState(), {
      type: "hotcard",
      hotcard: {
        id: "h1",
        name: "L3",
        templateId: "tpl-1",
        data: { name: "Charlie" },
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { name: "Charlie" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    expect(
      feedbackPredicate(s, "hotcard_on_air", {
        hotcardId: "h1",
        channel: "program",
      }),
    ).toBe(true);
  });

  it("hotcard_on_air = false when data doesn't match", () => {
    let s = apply(initialState(), {
      type: "hotcard",
      hotcard: {
        id: "h1",
        name: "L3",
        templateId: "tpl-1",
        data: { name: "Charlie" },
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { name: "Other" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    expect(
      feedbackPredicate(s, "hotcard_on_air", {
        hotcardId: "h1",
        channel: "program",
      }),
    ).toBe(false);
  });

  it("song_active = true when songSession is present", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: false,
          startedAt: 0,
        },
      },
    });
    expect(feedbackPredicate(s, "song_active", { channel: "program" })).toBe(
      true,
    );
  });

  it("song_trust_on reads songSession.trustMode", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: true,
          startedAt: 0,
        },
      },
    });
    expect(feedbackPredicate(s, "song_trust_on", { channel: "program" })).toBe(
      true,
    );
  });

  it("stt_running tracks spawner state", () => {
    let s = apply(initialState(), {
      type: "stt_spawner_status",
      status: {
        state: "running",
        pid: 1,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(feedbackPredicate(s, "stt_running", {})).toBe(true);
    s = apply(s, {
      type: "stt_spawner_status",
      status: {
        state: "stopped",
        pid: null,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(feedbackPredicate(s, "stt_running", {})).toBe(false);
  });

  it("connection_lost = true when disconnected", () => {
    let s = initialState();
    expect(feedbackPredicate(s, "connection_lost", {})).toBe(true);
    s = apply(s, { type: "local_connected" });
    expect(feedbackPredicate(s, "connection_lost", {})).toBe(false);
  });

  it("show_loaded reflects loadedShowId", () => {
    let s = initialState();
    expect(feedbackPredicate(s, "show_loaded", {})).toBe(false);
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    expect(feedbackPredicate(s, "show_loaded", {})).toBe(true);
  });

  it("row_is_cursor = true when chosen row id matches the cursor", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    expect(feedbackPredicate(s, "row_is_cursor", { rowId: "r2" })).toBe(true);
    expect(feedbackPredicate(s, "row_is_cursor", { rowId: "r1" })).toBe(false);
  });

  it("row_is_active = true when row matches PGM", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          {
            kind: "graphic",
            id: "r1",
            templateId: "tpl-1",
            data: { title: "Hi" },
          },
        ],
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hi" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    expect(feedbackPredicate(s, "row_is_active", { rowId: "r1" })).toBe(true);
  });
});
