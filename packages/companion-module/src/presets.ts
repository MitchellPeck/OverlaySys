import type { CompanionPresetDefinitions } from "@companion-module/base";
import { RUNDOWN_LIMIT } from "./variables";

const green = 0x00aa00;
const red = 0xaa0000;
const dark = 0x222222;
const white = 0xffffff;

export function presetDefinitions(): CompanionPresetDefinitions {
  const presets: CompanionPresetDefinitions = {};

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

  // Rundown row buttons (rows 1..8). The user picks the specific row after
  // dragging the preset onto a button — `rowId` is left empty here because
  // Companion presets cannot reference dynamic row IDs at preset-creation
  // time.
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
              actionId: "take_row",
              options: { rowId: "", channel: "program" },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [],
    };
  }

  return presets;
}

export { RUNDOWN_LIMIT };
