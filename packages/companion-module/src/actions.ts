import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RundownRow } from "@overlaysys/core";
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
  | "take_row_pvw_pgm"
  | "take_row_at_cursor"
  | "cursor_advance"
  | "cursor_set"
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
