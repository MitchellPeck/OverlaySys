import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RundownRow } from "@overlaysys/core";
import type {
  CompanionActionDefinitions,
  CompanionInputFieldDropdown,
  CompanionInputFieldTextInput,
  CompanionInputFieldNumber,
  CompanionInputFieldCheckbox,
} from "@companion-module/base";
import type { LocalEvent } from "./state";
import type { CompanionState } from "./types";

export type ActionId =
  | "take_template"
  | "clear"
  | "cue_template"
  | "take_pvw_to_pgm"
  | "fire_hotcard"
  | "load_show"
  | "clear_loaded_show"
  | "take_row"
  | "take_row_by_index"
  | "take_row_pvw_pgm"
  | "take_row_pvw_pgm_by_index"
  | "take_row_at_cursor"
  | "cursor_advance"
  | "cursor_set"
  | "cursor_set_by_index"
  | "song_take_row"
  | "song_take_row_pvw_pgm"
  | "song_advance"
  | "song_jump_section"
  | "song_jump_kind"
  | "song_blank"
  | "song_end"
  | "song_set_trust"
  | "stt_start"
  | "stt_stop";

export type ActionOptions = Record<
  string,
  string | number | boolean | undefined
>;

export interface DispatchResult {
  messages: ClientMessage[];
  localEvents: LocalEvent[];
}

function parseDataField(s: string | undefined | null): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1);
    if (k.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function rowMessages(
  state: CompanionState,
  row: RundownRow,
  channel: string,
): ClientMessage[] {
  if (row.kind === "song") {
    return [
      {
        type: "song_take",
        channel,
        showId: state.loadedShowId ?? "",
        songRowId: row.id,
      },
    ];
  }
  return [
    {
      type: "take",
      channel,
      templateId: row.templateId,
      data: row.data,
    },
  ];
}

function rowPvwPgmMessages(
  state: CompanionState,
  row: RundownRow,
  fromChannel: string,
  toChannel: string,
): ClientMessage[] {
  if (row.kind === "song") {
    return [
      {
        type: "song_take_pvw_to_pgm",
        showId: state.loadedShowId ?? "",
        songRowId: row.id,
        fromChannel,
        toChannel,
      },
    ];
  }
  return [
    {
      type: "cue",
      channel: fromChannel,
      templateId: row.templateId,
      data: row.data,
    },
    { type: "take_pvw_to_pgm", fromChannel, toChannel },
  ];
}

export function dispatchAction(
  state: CompanionState,
  id: ActionId,
  opts: ActionOptions,
): DispatchResult {
  const messages: ClientMessage[] = [];
  const localEvents: LocalEvent[] = [];

  const str = (k: string, dflt = ""): string => String(opts[k] ?? dflt);
  const num = (k: string, dflt = 0): number =>
    typeof opts[k] === "number"
      ? (opts[k] as number)
      : Number(opts[k] ?? dflt);
  const bool = (k: string): boolean => Boolean(opts[k]);

  switch (id) {
    case "take_template":
      messages.push({
        type: "take",
        channel: str("channel"),
        templateId: str("templateId"),
        data: parseDataField(str("data")),
      });
      break;
    case "clear":
      messages.push({ type: "clear", channel: str("channel") });
      break;
    case "cue_template":
      messages.push({
        type: "cue",
        channel: str("channel"),
        templateId: str("templateId"),
        data: parseDataField(str("data")),
      });
      break;
    case "take_pvw_to_pgm":
      messages.push({
        type: "take_pvw_to_pgm",
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    case "fire_hotcard": {
      const hid = str("hotcardId");
      const payload = state.hotcardCache.get(hid);
      if (!payload) break;
      const channel = str("channel") || payload.channelHint || "program";
      messages.push({
        type: "take",
        channel,
        templateId: payload.templateId,
        data: payload.data,
      });
      break;
    }
    case "load_show":
      localEvents.push({ type: "local_load_show", showId: str("showId") });
      messages.push({ type: "get_show", showId: str("showId") });
      break;
    case "clear_loaded_show":
      localEvents.push({ type: "local_clear_loaded_show" });
      break;
    case "take_row": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows.find((r) => r.id === str("rowId"));
      if (!row) break;
      const channel =
        str("channel") || row.channelHint || "program";
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "take_row_by_index": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row) break;
      const channel =
        str("channel") || row.channelHint || "program";
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "take_row_pvw_pgm": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows.find((r) => r.id === str("rowId"));
      if (!row) break;
      messages.push(
        ...rowPvwPgmMessages(
          state,
          row,
          str("fromChannel", "preview"),
          str("toChannel", "program"),
        ),
      );
      break;
    }
    case "take_row_pvw_pgm_by_index": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row) break;
      messages.push(
        ...rowPvwPgmMessages(
          state,
          row,
          str("fromChannel", "preview"),
          str("toChannel", "program"),
        ),
      );
      break;
    }
    case "take_row_at_cursor": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      if (!show || state.loadedShowRowCursor == null) break;
      const row = show.rows[state.loadedShowRowCursor];
      if (!row) break;
      const channel =
        str("channel") || row.channelHint || "program";
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "cursor_advance":
      localEvents.push({
        type: "local_cursor_advance",
        delta: num("delta", 1),
      });
      break;
    case "cursor_set":
      localEvents.push({ type: "local_cursor_set", rowId: str("rowId") });
      break;
    case "cursor_set_by_index": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row) break;
      localEvents.push({ type: "local_cursor_set", rowId: row.id });
      break;
    }
    case "song_take_row":
      messages.push({
        type: "song_take",
        channel: str("channel", "program"),
        showId: str("showId"),
        songRowId: str("songRowId"),
      });
      break;
    case "song_take_row_pvw_pgm":
      messages.push({
        type: "song_take_pvw_to_pgm",
        showId: str("showId"),
        songRowId: str("songRowId"),
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    case "song_advance":
      messages.push({
        type: "song_advance",
        channel: str("channel"),
        delta: num("delta", 1),
      });
      break;
    case "song_jump_section":
      messages.push({
        type: "song_jump",
        channel: str("channel"),
        sectionId: str("sectionId"),
        slideIdx: 0,
      });
      break;
    case "song_jump_kind":
      messages.push({
        type: "song_jump_kind",
        channel: str("channel"),
        kind: str("kind"),
        ordinal: num("ordinal", 1),
      });
      break;
    case "song_blank":
      messages.push({ type: "song_blank", channel: str("channel") });
      break;
    case "song_end":
      messages.push({ type: "song_end", channel: str("channel") });
      break;
    case "song_set_trust":
      messages.push({
        type: "song_set_trust",
        channel: str("channel"),
        trustMode: bool("trustMode"),
      });
      break;
    case "stt_start":
      messages.push({ type: "stt_spawner_start" });
      break;
    case "stt_stop":
      messages.push({ type: "stt_spawner_stop" });
      break;
  }

  return { messages, localEvents };
}

// ──── SDK-shaped definitions for Companion ────────────────────────────────

function channelDropdown(
  state: CompanionState,
  id = "channel",
  label = "Channel",
  defaultId?: string,
): CompanionInputFieldDropdown {
  const choices = state.channels.length
    ? state.channels.map((c) => ({ id: c.id, label: c.name }))
    : [
        { id: "program", label: "program" },
        { id: "preview", label: "preview" },
      ];
  return {
    id,
    type: "dropdown",
    label,
    default: defaultId ?? choices[0]?.id ?? "program",
    choices,
  };
}

function showDropdown(
  state: CompanionState,
  id = "showId",
): CompanionInputFieldDropdown {
  const choices = state.shows.map((s) => ({ id: s.id, label: s.name }));
  return {
    id,
    type: "dropdown",
    label: "Show",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no shows)" }],
  };
}

function hotcardDropdown(
  state: CompanionState,
  id = "hotcardId",
): CompanionInputFieldDropdown {
  const choices = state.hotcards.map((h) => ({ id: h.id, label: h.name }));
  return {
    id,
    type: "dropdown",
    label: "Hotcard",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no hotcards)" }],
  };
}

function templateDropdown(
  state: CompanionState,
  id = "templateId",
): CompanionInputFieldDropdown {
  const choices = state.templates.map((t) => ({ id: t.id, label: t.name }));
  return {
    id,
    type: "dropdown",
    label: "Template",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no templates)" }],
  };
}

function rowDropdown(
  state: CompanionState,
  id = "rowId",
): CompanionInputFieldDropdown {
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const choices = show
    ? show.rows.map((r, i) => ({
        id: r.id,
        label: `${i + 1}. ${r.kind === "song" ? "♪ " : ""}${r.id}`,
      }))
    : [];
  return {
    id,
    type: "dropdown",
    label: "Row",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no show loaded)" }],
  };
}

const dataInput: CompanionInputFieldTextInput = {
  id: "data",
  type: "textinput",
  label: "Data (key=value lines)",
  default: "",
};

const deltaInput: CompanionInputFieldNumber = {
  id: "delta",
  type: "number",
  label: "Delta",
  default: 1,
  min: -100,
  max: 100,
  step: 1,
};

const rowIndexInput: CompanionInputFieldNumber = {
  id: "rowIndex",
  type: "number",
  label: "Row index (1-based; survives show changes)",
  default: 1,
  min: 1,
  max: 200,
  step: 1,
};

const ordinalInput: CompanionInputFieldNumber = {
  id: "ordinal",
  type: "number",
  label: "Ordinal",
  default: 1,
  min: 1,
  max: 50,
  step: 1,
};

const kindInput: CompanionInputFieldDropdown = {
  id: "kind",
  type: "dropdown",
  label: "Section kind",
  default: "verse",
  choices: [
    { id: "verse", label: "Verse" },
    { id: "chorus", label: "Chorus" },
    { id: "bridge", label: "Bridge" },
    { id: "tag", label: "Tag" },
    { id: "intro", label: "Intro" },
    { id: "outro", label: "Outro" },
    { id: "other", label: "Other" },
  ],
};

const sectionIdInput: CompanionInputFieldTextInput = {
  id: "sectionId",
  type: "textinput",
  label: "Section ID",
  default: "",
};

const trustInput: CompanionInputFieldCheckbox = {
  id: "trustMode",
  type: "checkbox",
  label: "Trust mode",
  default: false,
};

export type ActionRunner = (id: ActionId, options: ActionOptions) => void;

export function actionDefinitions(
  state: CompanionState,
  run: ActionRunner,
): CompanionActionDefinitions {
  const wrap =
    (id: ActionId) =>
    async (event: { options: Record<string, unknown> }): Promise<void> => {
      run(id, event.options as ActionOptions);
    };

  return {
    take_template: {
      name: "Take template",
      options: [
        channelDropdown(state),
        templateDropdown(state),
        dataInput,
      ],
      callback: wrap("take_template"),
    },
    clear: {
      name: "Clear channel",
      options: [channelDropdown(state)],
      callback: wrap("clear"),
    },
    cue_template: {
      name: "Cue template",
      options: [
        channelDropdown(state),
        templateDropdown(state),
        dataInput,
      ],
      callback: wrap("cue_template"),
    },
    take_pvw_to_pgm: {
      name: "Take PVW → PGM",
      options: [
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_pvw_to_pgm"),
    },
    fire_hotcard: {
      name: "Fire hotcard",
      options: [hotcardDropdown(state), channelDropdown(state)],
      callback: wrap("fire_hotcard"),
    },
    load_show: {
      name: "Load show (this Companion instance)",
      options: [showDropdown(state)],
      callback: wrap("load_show"),
    },
    clear_loaded_show: {
      name: "Clear loaded show",
      options: [],
      callback: wrap("clear_loaded_show"),
    },
    take_row: {
      name: "Take row from loaded show (by row ID)",
      options: [rowDropdown(state), channelDropdown(state)],
      callback: wrap("take_row"),
    },
    take_row_by_index: {
      name: "Take row from loaded show (by index)",
      options: [rowIndexInput, channelDropdown(state)],
      callback: wrap("take_row_by_index"),
    },
    take_row_pvw_pgm: {
      name: "Take row PVW → PGM (by row ID)",
      options: [
        rowDropdown(state),
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_row_pvw_pgm"),
    },
    take_row_pvw_pgm_by_index: {
      name: "Take row PVW → PGM (by index)",
      options: [
        rowIndexInput,
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_row_pvw_pgm_by_index"),
    },
    take_row_at_cursor: {
      name: "Take row at cursor",
      options: [channelDropdown(state)],
      callback: wrap("take_row_at_cursor"),
    },
    cursor_advance: {
      name: "Cursor: advance",
      options: [deltaInput],
      callback: wrap("cursor_advance"),
    },
    cursor_set: {
      name: "Cursor: set to row (by row ID)",
      options: [rowDropdown(state)],
      callback: wrap("cursor_set"),
    },
    cursor_set_by_index: {
      name: "Cursor: set to row (by index)",
      options: [rowIndexInput],
      callback: wrap("cursor_set_by_index"),
    },
    song_take_row: {
      name: "Song: take row (any show)",
      options: [
        showDropdown(state),
        { ...rowDropdown(state), id: "songRowId" },
        channelDropdown(state),
      ],
      callback: wrap("song_take_row"),
    },
    song_take_row_pvw_pgm: {
      name: "Song: take row PVW → PGM (any show)",
      options: [
        showDropdown(state),
        { ...rowDropdown(state), id: "songRowId" },
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("song_take_row_pvw_pgm"),
    },
    song_advance: {
      name: "Song: advance ±",
      options: [channelDropdown(state), deltaInput],
      callback: wrap("song_advance"),
    },
    song_jump_section: {
      name: "Song: jump to section",
      options: [channelDropdown(state), sectionIdInput],
      callback: wrap("song_jump_section"),
    },
    song_jump_kind: {
      name: "Song: jump by section kind + ordinal",
      options: [channelDropdown(state), kindInput, ordinalInput],
      callback: wrap("song_jump_kind"),
    },
    song_blank: {
      name: "Song: blank",
      options: [channelDropdown(state)],
      callback: wrap("song_blank"),
    },
    song_end: {
      name: "Song: end",
      options: [channelDropdown(state)],
      callback: wrap("song_end"),
    },
    song_set_trust: {
      name: "Song: set trust mode",
      options: [channelDropdown(state), trustInput],
      callback: wrap("song_set_trust"),
    },
    stt_start: {
      name: "STT: start spawner",
      options: [],
      callback: wrap("stt_start"),
    },
    stt_stop: {
      name: "STT: stop spawner",
      options: [],
      callback: wrap("stt_stop"),
    },
  };
}
