import { describe, expect, it } from "vitest";
import { apply } from "../state";
import { initialState } from "../types";
import { dispatchAction, selectNextShowResult } from "../actions";

describe("dispatchAction — basic channel ops", () => {
  it("clear sends clear", () => {
    const r = dispatchAction(initialState(), "clear", { channel: "program" });
    expect(r.messages).toEqual([{ type: "clear", channel: "program" }]);
  });

  it("take_pvw_to_pgm with defaults", () => {
    const r = dispatchAction(initialState(), "take_pvw_to_pgm", {});
    expect(r.messages).toEqual([
      {
        type: "take_pvw_to_pgm",
        fromChannel: "preview",
        toChannel: "program",
      },
    ]);
  });

  it("take_template parses key=value data", () => {
    const r = dispatchAction(initialState(), "take_template", {
      channel: "program",
      templateId: "tpl-1",
      data: "title=Hello\nsubtitle=World",
    });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { title: "Hello", subtitle: "World" },
      },
    ]);
  });
});

describe("dispatchAction — hotcard", () => {
  it("fire_hotcard sends take with hotcard data", () => {
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: {
        id: "h1",
        name: "L3",
        templateId: "tpl-1",
        data: { name: "Charlie" },
        channelHint: "program",
      },
    });
    const r = dispatchAction(s, "fire_hotcard", { hotcardId: "h1" });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { name: "Charlie" },
      },
    ]);
  });

  it("fire_hotcard falls back to 'program' when no channelHint and no override", () => {
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: { id: "h1", name: "L3", templateId: "tpl-1", data: {} },
    });
    const r = dispatchAction(s, "fire_hotcard", { hotcardId: "h1" });
    expect(r.messages[0]?.type).toBe("take");
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("fire_hotcard honors channel override", () => {
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: {
        id: "h1",
        name: "L3",
        templateId: "tpl-1",
        data: {},
        channelHint: "preview",
      },
    });
    const r = dispatchAction(s, "fire_hotcard", {
      hotcardId: "h1",
      channel: "program",
    });
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("fire_hotcard is a no-op when hotcard payload not cached", () => {
    const r = dispatchAction(initialState(), "fire_hotcard", {
      hotcardId: "h1",
    });
    expect(r.messages).toEqual([]);
  });
});

describe("dispatchAction — song actions", () => {
  it("song_advance sends delta", () => {
    const r = dispatchAction(initialState(), "song_advance", {
      channel: "program",
      delta: -1,
    });
    expect(r.messages).toEqual([
      { type: "song_advance", channel: "program", delta: -1 },
    ]);
  });

  it("song_take_row sends song_take", () => {
    const r = dispatchAction(initialState(), "song_take_row", {
      showId: "show-1",
      songRowId: "r1",
      channel: "program",
    });
    expect(r.messages).toEqual([
      {
        type: "song_take",
        channel: "program",
        showId: "show-1",
        songRowId: "r1",
      },
    ]);
  });

  it("song_jump_kind sends kind + ordinal", () => {
    const r = dispatchAction(initialState(), "song_jump_kind", {
      channel: "program",
      kind: "chorus",
      ordinal: 2,
    });
    expect(r.messages).toEqual([
      {
        type: "song_jump_kind",
        channel: "program",
        kind: "chorus",
        ordinal: 2,
      },
    ]);
  });

  it("song_blank, song_end, song_set_trust", () => {
    expect(
      dispatchAction(initialState(), "song_blank", { channel: "program" })
        .messages,
    ).toEqual([{ type: "song_blank", channel: "program" }]);
    expect(
      dispatchAction(initialState(), "song_end", { channel: "program" }).messages,
    ).toEqual([{ type: "song_end", channel: "program" }]);
    expect(
      dispatchAction(initialState(), "song_set_trust", {
        channel: "program",
        trustMode: true,
      }).messages,
    ).toEqual([
      { type: "song_set_trust", channel: "program", trustMode: true },
    ]);
  });

  it("stt_start / stt_stop", () => {
    expect(dispatchAction(initialState(), "stt_start", {}).messages).toEqual([
      { type: "stt_spawner_start" },
    ]);
    expect(dispatchAction(initialState(), "stt_stop", {}).messages).toEqual([
      { type: "stt_spawner_stop" },
    ]);
  });
});

describe("dispatchAction — load_show and row actions", () => {
  function loadedShowState() {
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
            channelHint: "program",
          },
          {
            kind: "song",
            id: "r2",
            songId: "s1",
            lyricTemplateId: "lt",
          },
        ],
      },
    });
    return s;
  }

  it("load_show emits a local event and a get_show fetch", () => {
    const r = dispatchAction(initialState(), "load_show", { showId: "show-1" });
    expect(r.localEvents).toEqual([
      { type: "local_load_show", showId: "show-1" },
    ]);
    expect(r.messages).toEqual([{ type: "get_show", showId: "show-1" }]);
  });

  it("clear_loaded_show emits a local event", () => {
    const r = dispatchAction(initialState(), "clear_loaded_show", {});
    expect(r.localEvents).toEqual([{ type: "local_clear_loaded_show" }]);
    expect(r.messages).toEqual([]);
  });

  it("take_row on a graphic row sends `take`", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r1" });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
    ]);
  });

  it("take_row on a song row sends `song_take`", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r2" });
    expect(r.messages).toEqual([
      {
        type: "song_take",
        channel: "program",
        showId: "show-1",
        songRowId: "r2",
      },
    ]);
  });

  it("take_row uses row's channelHint when no channel override", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r1" });
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("take_row_pvw_pgm for graphic row: cue then take_pvw_to_pgm", () => {
    const r = dispatchAction(loadedShowState(), "take_row_pvw_pgm", {
      rowId: "r1",
    });
    expect(r.messages).toEqual([
      {
        type: "cue",
        channel: "preview",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
      {
        type: "take_pvw_to_pgm",
        fromChannel: "preview",
        toChannel: "program",
      },
    ]);
  });

  it("take_row_pvw_pgm for song row: song_take_pvw_to_pgm", () => {
    const r = dispatchAction(loadedShowState(), "take_row_pvw_pgm", {
      rowId: "r2",
    });
    expect(r.messages).toEqual([
      {
        type: "song_take_pvw_to_pgm",
        showId: "show-1",
        songRowId: "r2",
        fromChannel: "preview",
        toChannel: "program",
      },
    ]);
  });

  it("cursor_advance emits a local event", () => {
    const r = dispatchAction(loadedShowState(), "cursor_advance", { delta: 1 });
    expect(r.localEvents).toEqual([
      { type: "local_cursor_advance", delta: 1 },
    ]);
  });

  it("cursor_set emits a local event", () => {
    const r = dispatchAction(loadedShowState(), "cursor_set", { rowId: "r2" });
    expect(r.localEvents).toEqual([{ type: "local_cursor_set", rowId: "r2" }]);
  });

  it("take_row_at_cursor dispatches like take_row on the cursor row", () => {
    let s = loadedShowState();
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    const r = dispatchAction(s, "take_row_at_cursor", { channel: "program" });
    expect(r.messages).toEqual([
      {
        type: "song_take",
        channel: "program",
        showId: "show-1",
        songRowId: "r2",
      },
    ]);
  });

  it("take_row is a no-op when show is not loaded", () => {
    const r = dispatchAction(initialState(), "take_row", { rowId: "r1" });
    expect(r.messages).toEqual([]);
    expect(r.localEvents).toEqual([]);
  });

  it("take_row_by_index resolves row by 1-based position", () => {
    const r = dispatchAction(loadedShowState(), "take_row_by_index", {
      rowIndex: 2,
    });
    expect(r.messages).toEqual([
      {
        type: "song_take",
        channel: "program",
        showId: "show-1",
        songRowId: "r2",
      },
    ]);
  });

  it("take_row_by_index works with index 1 (first row)", () => {
    const r = dispatchAction(loadedShowState(), "take_row_by_index", {
      rowIndex: 1,
    });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
    ]);
  });

  it("take_row_by_index is a no-op when index out of range", () => {
    const r = dispatchAction(loadedShowState(), "take_row_by_index", {
      rowIndex: 99,
    });
    expect(r.messages).toEqual([]);
  });

  it("take_row_pvw_pgm_by_index resolves by index", () => {
    const r = dispatchAction(loadedShowState(), "take_row_pvw_pgm_by_index", {
      rowIndex: 1,
    });
    expect(r.messages).toEqual([
      {
        type: "cue",
        channel: "preview",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
      {
        type: "take_pvw_to_pgm",
        fromChannel: "preview",
        toChannel: "program",
      },
    ]);
  });

  it("cursor_set_by_index emits local_cursor_set with the row's id", () => {
    const r = dispatchAction(loadedShowState(), "cursor_set_by_index", {
      rowIndex: 2,
    });
    expect(r.localEvents).toEqual([{ type: "local_cursor_set", rowId: "r2" }]);
  });
});

describe("selectNextShowResult", () => {
  function stateWithShows() {
    const s = initialState();
    s.shows = [
      { id: "past", name: "1/1/20 Old", rowCount: 0 },
      { id: "soon", name: "Soonest", rowCount: 2, scheduledFor: "2026-07-20" },
      { id: "later", name: "7/27/26 Later", rowCount: 1 },
    ];
    return s;
  }

  it("loads the soonest upcoming show", () => {
    const { messages, localEvents } = selectNextShowResult(
      stateWithShows(),
      "2026-07-14",
    );
    expect(localEvents).toEqual([{ type: "local_load_show", showId: "soon" }]);
    expect(messages).toEqual([{ type: "get_show", showId: "soon" }]);
  });

  it("falls back to the most recent past show when nothing is upcoming", () => {
    const { messages, localEvents } = selectNextShowResult(
      stateWithShows(),
      "2027-01-01",
    );
    expect(localEvents).toEqual([{ type: "local_load_show", showId: "later" }]);
    expect(messages).toEqual([{ type: "get_show", showId: "later" }]);
  });

  it("is a no-op when no show has a resolvable date", () => {
    const s = initialState();
    s.shows = [{ id: "x", name: "Sunday Gathering", rowCount: 3 }];
    const { messages, localEvents } = selectNextShowResult(s, "2026-07-14");
    expect(messages).toEqual([]);
    expect(localEvents).toEqual([]);
  });
});
