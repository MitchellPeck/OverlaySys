import type { CompanionPresetDefinitions } from "@companion-module/base";
import { RUNDOWN_LIMIT } from "./variables";
import type { CompanionState } from "./types";

const green = 0x00aa00;
const red = 0xaa0000;
const amber = 0xcc8800;
const dark = 0x222222;
const white = 0xffffff;

export function presetDefinitions(
  state?: Pick<CompanionState, "hotcards">,
): CompanionPresetDefinitions {
  const presets: CompanionPresetDefinitions = {};

  // One button per hotcard in the current project's list.
  for (const h of state?.hotcards ?? []) {
    presets[`hotcard_${h.id}`] = {
      type: "button",
      category: "Hotcards",
      name: `Hotcard: ${h.name}`,
      style: { text: h.name, size: "auto", color: white, bgcolor: dark },
      steps: [
        { down: [{ actionId: "fire_hotcard", options: { hotcardId: h.id, channel: "" } }], up: [] },
      ],
      feedbacks: [
        {
          feedbackId: "hotcard_on_air",
          options: { hotcardId: h.id, channel: "program" },
          style: { bgcolor: 0xe5484d },
        },
      ],
    };
  }

  presets["take_pvw_pgm"] = {
    type: "button",
    category: "Master",
    name: "Take PVW → PGM",
    style: { text: "TAKE\\nPVW→PGM", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "take_pvw_to_pgm", options: {} }], up: [] }],
    feedbacks: [
      {
        feedbackId: "channel_is_live",
        options: { channel: "preview" },
        style: { bgcolor: green },
      },
    ],
  };

  presets["clear_all_pgm"] = {
    type: "button",
    category: "Master",
    name: "Clear all PGM (graphics + cut video)",
    style: { text: "CLEAR\\nALL PGM", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "clear_all", options: { channel: "program" } }], up: [] },
    ],
    feedbacks: [],
  };

  presets["panic"] = {
    type: "button",
    category: "Master",
    name: "PANIC: clear every channel (graphics + cut video)",
    style: { text: "PANIC\\nCLEAR ALL", size: "14", color: white, bgcolor: red },
    steps: [{ down: [{ actionId: "panic", options: { keepVideo: false } }], up: [] }],
    feedbacks: [],
  };

  presets["output_status_pgm"] = {
    type: "button",
    category: "Master",
    name: "PGM output status (red when no output is connected)",
    style: { text: "PGM OUT\\n$(overlaysys:program_outputs)", size: "14", color: white, bgcolor: dark },
    steps: [],
    feedbacks: [{ feedbackId: "output_offline", options: { channel: "program" }, style: { bgcolor: red } }],
  };

  presets["video_countdown_pgm"] = {
    type: "button",
    category: "Video",
    name: "PGM video countdown (remaining, red under 10 s)",
    style: { text: "$(overlaysys:program_video_remaining)", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "video_play_pause", options: { channel: "program" } }], up: [] }],
    feedbacks: [
      { feedbackId: "video_on_air", options: { channel: "program" }, style: { bgcolor: green } },
      { feedbackId: "video_remaining_below", options: { channel: "program", seconds: 10 }, style: { bgcolor: red } },
      { feedbackId: "video_errored", options: { channel: "program" }, style: { bgcolor: amber, text: "VIDEO\\nERROR" } },
    ],
  };

  presets["create_countdown_5"] = {
    type: "button",
    category: "Stage",
    name: "Start a 5-minute countdown",
    style: { text: "COUNT\\nDOWN 5:00", size: "14", color: white, bgcolor: dark },
    steps: [
      {
        down: [
          {
            actionId: "create_countdown",
            options: { label: "Countdown", minutes: 5, seconds: 0, overtime: true, start: true },
          },
        ],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["stt_silent"] = {
    type: "button",
    category: "Master",
    name: "STT status (red when silent 15 s during a song)",
    style: { text: "STT\\n$(overlaysys:stt_confidence)%", size: "14", color: white, bgcolor: dark },
    steps: [],
    feedbacks: [
      { feedbackId: "stt_running", options: {}, style: { bgcolor: green } },
      { feedbackId: "stt_silent", options: { seconds: 15 }, style: { bgcolor: red } },
    ],
  };

  presets["video_stop_pgm"] = {
    type: "button",
    category: "Video",
    name: "Stop PGM video (animate out)",
    style: { text: "STOP\\nVIDEO", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "video_stop", options: { channel: "program" } }], up: [] },
    ],
    feedbacks: [
      {
        feedbackId: "video_on_air",
        options: { channel: "program" },
        style: { bgcolor: red },
      },
    ],
  };

  presets["video_play_pause_pgm"] = {
    type: "button",
    category: "Video",
    name: "Play / pause PGM video",
    style: { text: "PLAY\\nPAUSE", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "video_play_pause", options: { channel: "program" } }], up: [] },
    ],
    feedbacks: [
      {
        feedbackId: "video_on_air",
        options: { channel: "program" },
        style: { bgcolor: green },
      },
      {
        feedbackId: "video_paused",
        options: { channel: "program" },
        style: { bgcolor: amber },
      },
    ],
  };

  presets["video_restart_pgm"] = {
    type: "button",
    category: "Video",
    name: "Restart PGM video",
    style: { text: "RESTART\\nVIDEO", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "video_restart", options: { channel: "program" } }], up: [] },
    ],
    feedbacks: [],
  };

  presets["clear_pgm"] = {
    type: "button",
    category: "Master",
    name: "Clear PGM",
    style: { text: "CLEAR\\nPGM", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "clear", options: { channel: "program" } }], up: [] },
    ],
    feedbacks: [
      {
        feedbackId: "channel_is_live",
        options: { channel: "program" },
        style: { bgcolor: red },
      },
    ],
  };

  presets["stt_toggle_start"] = {
    type: "button",
    category: "Master",
    name: "STT Start",
    style: { text: "STT\\nSTART", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "stt_start", options: {} }], up: [] }],
    feedbacks: [
      { feedbackId: "stt_running", options: {}, style: { bgcolor: green } },
    ],
  };

  presets["stt_toggle_stop"] = {
    type: "button",
    category: "Master",
    name: "STT Stop",
    style: { text: "STT\\nSTOP", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "stt_stop", options: {} }], up: [] }],
    feedbacks: [],
  };

  presets["song_advance_prev"] = {
    type: "button",
    category: "Song",
    name: "Song −1",
    style: { text: "◀ −1", size: "18", color: white, bgcolor: dark },
    steps: [
      {
        down: [
          {
            actionId: "song_advance",
            options: { channel: "program", delta: -1 },
          },
        ],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["song_advance_next"] = {
    type: "button",
    category: "Song",
    name: "Song +1",
    style: { text: "+1 ▶", size: "18", color: white, bgcolor: dark },
    steps: [
      {
        down: [
          {
            actionId: "song_advance",
            options: { channel: "program", delta: 1 },
          },
        ],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["song_blank"] = {
    type: "button",
    category: "Song",
    name: "Song Blank",
    style: { text: "BLANK", size: "14", color: white, bgcolor: dark },
    steps: [
      {
        down: [{ actionId: "song_blank", options: { channel: "program" } }],
        up: [],
      },
    ],
    feedbacks: [
      {
        feedbackId: "song_active",
        options: { channel: "program" },
        style: { bgcolor: green },
      },
    ],
  };

  presets["song_end"] = {
    type: "button",
    category: "Song",
    name: "Song End",
    style: { text: "END\\nSONG", size: "14", color: white, bgcolor: dark },
    steps: [
      {
        down: [{ actionId: "song_end", options: { channel: "program" } }],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["scripture_intro_cursor"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture Intro (cursor row)",
    style: { text: "SCRIPTURE\\nINTRO", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_take_intro_at_cursor", options: { channel: "" } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_queued", options: { channel: "program" }, style: { bgcolor: 0x996600 } }],
  };
  presets["scripture_prev"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture -1",
    style: { text: "◀ -1", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_advance", options: { channel: "program", delta: -1 } }], up: [] }],
    feedbacks: [],
  };
  presets["scripture_next"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture +1",
    style: { text: "+1 ▶", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_advance", options: { channel: "program", delta: 1 } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_queued", options: { channel: "program" }, style: { bgcolor: 0x996600 } }],
  };
  presets["scripture_end"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture End",
    style: { text: "END", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_end", options: { channel: "program" } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_active", options: { channel: "program" }, style: { bgcolor: 0x00aa00 } }],
  };

  presets["cursor_prev"] = {
    type: "button",
    category: "Rundown",
    name: "Cursor −1",
    style: { text: "↑", size: "24", color: white, bgcolor: dark },
    steps: [
      {
        down: [{ actionId: "cursor_advance", options: { delta: -1 } }],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["cursor_next"] = {
    type: "button",
    category: "Rundown",
    name: "Cursor +1",
    style: { text: "↓", size: "24", color: white, bgcolor: dark },
    steps: [
      {
        down: [{ actionId: "cursor_advance", options: { delta: 1 } }],
        up: [],
      },
    ],
    feedbacks: [],
  };

  presets["take_at_cursor"] = {
    type: "button",
    category: "Rundown",
    name: "Take at cursor",
    style: { text: "TAKE\\nCURSOR", size: "14", color: white, bgcolor: dark },
    steps: [
      {
        down: [
          {
            actionId: "take_row_at_cursor",
            options: { channel: "program" },
          },
        ],
        up: [],
      },
    ],
    feedbacks: [],
  };

  // One take button for a line that may be a song or a regular item: songs
  // fire the chosen sub-take, other rows take normally. The button tints when
  // the cursor row is a song so the operator can see which path will fire.
  presets["take_at_cursor_song_aware"] = {
    type: "button",
    category: "Rundown",
    name: "Take at cursor (song-aware)",
    style: {
      text: "TAKE\\n$(overlaysys:cursor_row_kind)",
      size: "14",
      color: white,
      bgcolor: dark,
    },
    steps: [
      {
        down: [
          {
            actionId: "take_row_song_aware",
            options: { target: "cursor", sub: "lyrics", pvwPgm: false, channel: "" },
          },
        ],
        up: [],
      },
    ],
    feedbacks: [
      {
        feedbackId: "cursor_row_kind_is",
        options: { kind: "song" },
        style: { bgcolor: 0x5522aa },
      },
    ],
  };

  // Rundown row buttons (rows 1..8). Each takes the Nth row of the loaded
  // show by index, on the row's own channel (blank channel = row/song default).
  for (let n = 1; n <= 8; n++) {
    presets[`rundown_row_${n}`] = {
      type: "button",
      category: "Rundown",
      name: `Row ${n}`,
      style: {
        text: `${n}\\n$(overlaysys:rundown_${n}_name)`,
        size: "14",
        color: white,
        bgcolor: dark,
      },
      steps: [
        {
          down: [
            {
              actionId: "take_row_by_index",
              options: { rowIndex: n, channel: "" },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: "row_at_index_is_active",
          options: { rowIndex: n },
          style: { bgcolor: 0xcc0000 },
        },
        {
          feedbackId: "row_at_index_is_cursor",
          options: { rowIndex: n },
          style: { bgcolor: 0x00aa00 },
        },
      ],
    };
  }

  presets["select_next_show"] = {
    type: "button",
    category: "Master",
    name: "Select Next Show",
    style: { text: "NEXT\\nSHOW", size: "14", color: white, bgcolor: dark },
    steps: [
      { down: [{ actionId: "select_next_show", options: {} }], up: [] },
    ],
    feedbacks: [],
  };

  type NotesFeedback = { feedbackId: string; options: Record<string, never>; style: { bgcolor: number; color: number } };
  const greyed = { bgcolor: 0x333333, color: 0x777777 };
  const notesBtn = (
    key: string,
    name: string,
    text: string,
    actionId: string,
    feedbacks: NotesFeedback[] = [],
  ) => {
    presets[key] = {
      type: "button",
      category: "Pastor Notes",
      name,
      style: { text, size: "14", color: white, bgcolor: dark },
      steps: [{ down: [{ actionId, options: {} }], up: [] }],
      feedbacks,
    };
  };
  notesBtn("notes_prev", "Notes: previous point", "◀ PREV", "notes_prev_point", [
    { feedbackId: "notes_at_first", options: {}, style: greyed },
  ]);
  notesBtn(
    "notes_next",
    "Notes: next point",
    "NEXT ▶\\n$(overlaysys:notes_point)/$(overlaysys:notes_point_count)\\n$(overlaysys:notes_next_heading)",
    "notes_next_point",
    [{ feedbackId: "notes_at_last", options: {}, style: greyed }],
  );
  notesBtn("notes_scroll_up", "Notes: scroll up", "▲", "notes_scroll_up");
  notesBtn("notes_scroll_down", "Notes: scroll down", "▼", "notes_scroll_down");
  notesBtn("notes_top", "Notes: top", "TOP", "notes_top");
  presets["notes_status"] = {
    type: "button",
    category: "Pastor Notes",
    name: "Notes: current point heading",
    style: {
      text: "$(overlaysys:notes_point_heading)",
      size: "14",
      color: white,
      bgcolor: dark,
    },
    steps: [{ down: [], up: [] }],
    feedbacks: [],
  };

  presets["stage_msg_wrap"] = {
    type: "button",
    category: "Stage",
    name: "Stage message: Wrap up",
    style: { text: "WRAP UP", size: "14", color: white, bgcolor: dark },
    steps: [
      {
        down: [{ actionId: "stage_message_send", options: { text: "Wrap up" } }],
        up: [],
      },
    ],
    feedbacks: [],
  };
  presets["stage_msg_clear"] = {
    type: "button",
    category: "Stage",
    name: "Stage message: clear",
    style: { text: "CLEAR MSG", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "stage_message_clear", options: {} }], up: [] }],
    feedbacks: [
      {
        feedbackId: "stage_message_showing",
        options: {},
        style: { bgcolor: 0xcc0000 },
      },
    ],
  };

  return presets;
}

export { RUNDOWN_LIMIT };
