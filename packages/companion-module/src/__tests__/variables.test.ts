import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import {
  projectVariables,
  variableDefinitions,
  RUNDOWN_LIMIT,
} from "../variables";

const CHANNELS = ["program", "preview"];

describe("variableDefinitions", () => {
  it("includes channel-scoped variables for each configured channel", () => {
    const defs = variableDefinitions(CHANNELS);
    const ids = new Set(defs.map((d) => d.variableId));
    expect(ids.has("program_template_id")).toBe(true);
    expect(ids.has("preview_template_id")).toBe(true);
    expect(ids.has("program_is_live")).toBe(true);
    expect(ids.has("program_song_title")).toBe(true);
  });

  it("includes rundown_1..N variables", () => {
    const defs = variableDefinitions(CHANNELS);
    const ids = new Set(defs.map((d) => d.variableId));
    expect(ids.has("rundown_1_name")).toBe(true);
    expect(ids.has(`rundown_${RUNDOWN_LIMIT}_name`)).toBe(true);
  });

  it("includes connection and STT globals", () => {
    const ids = new Set(variableDefinitions(CHANNELS).map((d) => d.variableId));
    expect(ids.has("connection_state")).toBe(true);
    expect(ids.has("stt_running")).toBe(true);
    expect(ids.has("loaded_show_name")).toBe(true);
  });
});

describe("projectVariables — channel scope", () => {
  it("empty when channel has no state", () => {
    const v = projectVariables(initialState(), CHANNELS);
    expect(v.program_template_id).toBe("");
    expect(v.program_is_live).toBe("no");
  });

  it("populates template_id/name and is_live when active", () => {
    let s = apply(initialState(), {
      type: "template_list",
      templates: [
        { id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } },
      ],
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hello" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.program_template_id).toBe("tpl-1");
    expect(v.program_template_name).toBe("Lower Third");
    expect(v.program_is_live).toBe("yes");
    expect(v.program_phase).toBe("on");
  });

  it("projects active.data keys into program_data_<n>_*", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hello", subtitle: "World" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    // sorted alphabetically: subtitle then title
    expect(v.program_data_1_key).toBe("subtitle");
    expect(v.program_data_1_value).toBe("World");
    expect(v.program_data_2_key).toBe("title");
    expect(v.program_data_2_value).toBe("Hello");
  });

  it("populates song_title and song_section when a session is active", () => {
    let s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Test Song" }],
    });
    s = apply(s, {
      type: "song",
      song: {
        id: "s1",
        title: "Test Song",
        sections: [
          {
            id: "sec1",
            kind: "verse",
            label: "Verse 1",
            slides: [{ id: "sl1", text: "Line one\nLine two" }],
          },
        ],
        defaultArrangement: ["sec1"],
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s1",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: true,
          startedAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.program_song_title).toBe("Test Song");
    expect(v.program_song_section).toBe("Verse 1");
    expect(v.program_song_slide_idx).toBe("1");
    expect(v.program_song_slide_text).toBe("Line one");
    expect(v.program_song_trust_mode).toBe("yes");
    expect(v.program_song_blanked).toBe("no");
  });
});

describe("projectVariables — globals", () => {
  it("connection_state mirrors state", () => {
    let s = initialState();
    expect(projectVariables(s, CHANNELS).connection_state).toBe("disconnected");
    s = apply(s, { type: "local_connected" });
    expect(projectVariables(s, CHANNELS).connection_state).toBe("connected");
  });

  it("stt_running reflects spawner state", () => {
    const s = apply(initialState(), {
      type: "stt_spawner_status",
      status: {
        state: "running",
        pid: 1,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(projectVariables(s, CHANNELS).stt_running).toBe("yes");
  });
});

describe("projectVariables — rundown rows", () => {
  it("rundown_1_name shows the loaded show's first row", () => {
    let s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Amazing Grace" }],
    });
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Sunday",
        rows: [
          { kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lt" },
          {
            kind: "graphic",
            id: "r2",
            templateId: "tpl-x",
            data: {},
            notes: "Title card",
          },
        ],
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_name).toBe("Amazing Grace");
    expect(v.rundown_1_kind).toBe("song");
    expect(v.rundown_2_name).toBe("Title card");
    expect(v.rundown_2_kind).toBe("graphic");
  });

  it("rundown_<n>_is_active = yes when row matches PGM", () => {
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
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_is_active).toBe("yes");
  });

  it("rundown_<n>_name is empty past the row count", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: { id: "show-1", name: "S", rows: [] },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_name).toBe("");
    expect(v.rundown_5_name).toBe("");
  });

  it("loaded_show_name comes from show meta", () => {
    let s = apply(initialState(), {
      type: "show_list",
      shows: [{ id: "show-1", name: "Sunday", rowCount: 2 }],
    });
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    const v = projectVariables(s, CHANNELS);
    expect(v.loaded_show_name).toBe("Sunday");
  });
});
