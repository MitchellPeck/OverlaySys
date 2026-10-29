import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RundownRow } from "@overlaysys/core";
import { pickNextShow, CURRENT_ITEM_TIMER_ID, hotcardRoute } from "@overlaysys/core";
import type {
  CompanionActionDefinitions,
  CompanionInputFieldDropdown,
  CompanionInputFieldTextInput,
  CompanionInputFieldNumber,
  CompanionInputFieldCheckbox,
} from "@companion-module/base";
import type { LocalEvent } from "./state";
import type { CompanionState } from "./types";
import { DEFAULT_CHANNEL_CHOICE, rowChoices } from "./labels";

export type ActionId =
  | "take_template"
  | "clear"
  | "clear_all"
  | "video_stop"
  | "video_play_pause"
  | "video_restart"
  | "cue_template"
  | "take_pvw_to_pgm"
  | "fire_hotcard"
  | "cue_hotcard"
  | "load_show"
  | "clear_loaded_show"
  | "select_next_show"
  | "take_row"
  | "take_row_by_index"
  | "take_row_pvw_pgm"
  | "take_row_pvw_pgm_by_index"
  | "take_row_at_cursor"
  | "take_row_song_aware"
  | "scripture_take_intro"
  | "scripture_take_intro_by_index"
  | "scripture_take_intro_at_cursor"
  | "scripture_take_slide"
  | "scripture_take_slide_by_index"
  | "scripture_take_slide_at_cursor"
  | "scripture_advance"
  | "scripture_goto"
  | "scripture_end"
  | "cursor_advance"
  | "cursor_set"
  | "cursor_set_by_index"
  | "song_take_row"
  | "song_take_row_by_index"
  | "song_take_row_pvw_pgm"
  | "song_take_row_pvw_pgm_by_index"
  | "song_take_sub"
  | "song_take_sub_by_index"
  | "song_advance"
  | "song_jump_section"
  | "song_jump_kind"
  | "song_blank"
  | "song_end"
  | "song_set_trust"
  | "stt_start"
  | "stt_stop"
  | "notes_next_point"
  | "notes_prev_point"
  | "notes_goto_point"
  | "notes_scroll_down"
  | "notes_scroll_up"
  | "notes_top"
  | "notes_select"
  | "stage_message_send"
  | "stage_message_clear"
  | "stage_timer_start"
  | "stage_timer_pause"
  | "stage_timer_resume"
  | "stage_timer_reset"
  | "stage_timer_adjust"
  | "panic"
  | "create_countdown"
  | "cursor_prev";

const TIMER_MESSAGE_FOR_ACTION = {
  stage_timer_start: "timer_start",
  stage_timer_pause: "timer_pause",
  stage_timer_resume: "timer_resume",
  stage_timer_reset: "timer_reset",
} as const;

export type ActionOptions = Record<
  string,
  string | number | boolean | undefined
>;

export interface DispatchResult {
  messages: ClientMessage[];
  localEvents: LocalEvent[];
  /** Operator-facing warnings the module edge logs at "warn". */
  warnings?: string[];
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
  const showId = state.loadedShowId;
  const source = showId ? { source: { showId, rowId: row.id } } : {};
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
  if (row.kind === "scripture") {
    return [{ type: "scripture_take_slide", showId: state.loadedShowId ?? "", rowId: row.id, slideIdx: 0, channel }];
  }
  if (row.kind === "video") {
    return [
      {
        type: "media_take",
        channel,
        rowId: row.id,
        assetUrl: row.assetUrl,
        ...(row.label !== undefined ? { label: row.label } : {}),
        volume: row.volume,
        endAction: row.endAction,
        transitionIn: row.transitionIn,
        transitionOut: row.transitionOut,
        ...(showId ? { showId } : {}),
      },
    ];
  }
  // [P3.8] slides rows are not driven from Companion yet
  if (row.kind === "slides") return [];
  return [
    {
      type: "take",
      channel,
      templateId: row.templateId,
      data: row.data,
      ...source,
    },
  ];
}

function rowPvwPgmMessages(
  state: CompanionState,
  row: RundownRow,
  fromChannel: string,
  toChannel: string,
): ClientMessage[] {
  const showId = state.loadedShowId;
  const source = showId ? { source: { showId, rowId: row.id } } : {};
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
  if (row.kind === "scripture") {
    // No preview stage for scripture slides: go straight to the To channel.
    return [{ type: "scripture_take_slide", showId: state.loadedShowId ?? "", rowId: row.id, slideIdx: 0, channel: toChannel }];
  }
  if (row.kind === "video") {
    // No PVW stage for video (would double audio).
    return [];
  }
  // [P3.8] slides rows are not driven from Companion yet
  if (row.kind === "slides") return [];
  return [
    {
      type: "cue",
      channel: fromChannel,
      templateId: row.templateId,
      data: row.data,
      ...source,
    },
    { type: "take_pvw_to_pgm", fromChannel, toChannel },
  ];
}

/**
 * Resolves the soonest show scheduled today or later — or, when nothing is
 * upcoming, the most recent past one — and returns the load-show dispatch for
 * it. `todayISO` is injected by the caller so this stays pure and testable; the
 * wall-clock lives at the module edge (index.ts). Only a show list where
 * nothing carries a resolvable date yields an empty result (caller warns).
 */
export function selectNextShowResult(
  state: CompanionState,
  todayISO: string,
): DispatchResult {
  const showId = pickNextShow(state.shows, todayISO);
  if (!showId) return { messages: [], localEvents: [] };
  return {
    messages: [{ type: "get_show", showId }],
    localEvents: [{ type: "local_load_show", showId }],
  };
}

export function dispatchAction(
  state: CompanionState,
  id: ActionId,
  opts: ActionOptions,
): DispatchResult {
  const messages: ClientMessage[] = [];
  const localEvents: LocalEvent[] = [];
  const warnings: string[] = [];

  const str = (k: string, dflt = ""): string => String(opts[k] ?? dflt);
  const num = (k: string, dflt = 0): number =>
    typeof opts[k] === "number"
      ? (opts[k] as number)
      : Number(opts[k] ?? dflt);
  const bool = (k: string): boolean => Boolean(opts[k]);
  const loadedShow = () => (state.loadedShowId ? state.showCache.get(state.loadedShowId) : undefined);
  const scriptureRowAt = (target: "index" | "cursor") => {
    const show = loadedShow();
    if (!show) return undefined;
    const idx = target === "index" ? num("rowIndex", 1) - 1 : state.loadedShowRowCursor;
    const row = idx == null ? undefined : show.rows[idx];
    return row && row.kind === "scripture" ? { show, row } : undefined;
  };
  const optChannel = () => (str("channel") ? { channel: str("channel") } : {});
  const slideIdx = () => Math.max(0, Math.floor(num("slide", 1)) - 1);

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
    case "clear_all":
      // Graphics and video together, video hard-cut — the panic button.
      messages.push({ type: "clear", channel: str("channel") });
      messages.push({ type: "media_clear", channel: str("channel"), cut: true });
      break;
    case "video_stop":
      // Plays the video row's Out transition (fade/zoom/slide).
      messages.push({ type: "media_clear", channel: str("channel") });
      break;
    case "video_play_pause":
    case "video_restart": {
      // Transport targets the current take; no video on the channel → no-op.
      const channel = str("channel");
      const media = state.channelStates.get(channel)?.media;
      if (!media) break;
      const action = id === "video_restart" ? "restart" : media.paused ? "play" : "pause";
      messages.push({ type: "media_control", channel, takenAt: media.takenAt, action });
      break;
    }
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
    case "fire_hotcard":
    case "cue_hotcard": {
      const hid = str("hotcardId");
      const payload = state.hotcardCache.get(hid);
      if (!payload) {
        warnings.push(`Hotcard ${hid} isn't loaded yet; try again in a moment`);
        break;
      }
      if (id === "cue_hotcard") {
        // Cue always goes to preview, whatever the card's default output is.
        messages.push({
          type: "cue",
          channel: "preview",
          templateId: payload.templateId,
          data: payload.data,
        });
        break;
      }
      // An explicit channel on the button wins; otherwise the card's
      // default output, where a legacy "preview" hint must not redirect a
      // Take (Default D7a, same rule as the operator).
      const channel = str("channel") || hotcardRoute(payload.channelHint, "take");
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
    case "take_row_song_aware": {
      // One button for a rundown line that may be a song or a regular item:
      // songs fire the chosen sub-take (intro / lyrics / outro), everything
      // else takes exactly as take_row would.
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      if (!show) break;
      const target = str("target", "cursor");
      const row =
        target === "id"
          ? show.rows.find((r) => r.id === str("rowId"))
          : target === "index"
            ? show.rows[num("rowIndex", 1) - 1]
            : state.loadedShowRowCursor != null
              ? show.rows[state.loadedShowRowCursor]
              : undefined;
      if (!row) break;
      const pvwPgm = bool("pvwPgm");
      if (row.kind === "scripture") {
        const sub = str("sub", "lyrics");
        const channel = pvwPgm ? str("toChannel", "program") : str("channel");
        const ch = channel ? { channel } : {};
        if (sub === "intro") messages.push({ type: "scripture_take_intro", showId: show.id, rowId: row.id, ...ch });
        else if (sub === "lyrics") messages.push({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, ...ch });
        break;
      }
      if (row.kind === "song") {
        const sub = str("sub", "lyrics");
        if (sub !== "intro" && sub !== "lyrics" && sub !== "outro") break;
        if (pvwPgm && sub === "lyrics") {
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
        // Intro/outro have no preview stage; in PVW → PGM mode they go
        // straight to the To channel.
        const channel = pvwPgm ? str("toChannel", "program") : str("channel");
        messages.push({
          type: "take_song_sub",
          showId: show.id,
          songRowId: row.id,
          sub,
          ...(channel ? { channel } : {}),
        });
        break;
      }
      if (pvwPgm) {
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
      const channel = str("channel") || row.channelHint || "program";
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "scripture_take_intro":
      messages.push({ type: "scripture_take_intro", showId: str("showId"), rowId: str("rowId"), ...optChannel() });
      break;
    case "scripture_take_intro_by_index":
    case "scripture_take_intro_at_cursor": {
      const hit = scriptureRowAt(id === "scripture_take_intro_by_index" ? "index" : "cursor");
      if (hit) messages.push({ type: "scripture_take_intro", showId: hit.show.id, rowId: hit.row.id, ...optChannel() });
      break;
    }
    case "scripture_take_slide":
      messages.push({ type: "scripture_take_slide", showId: str("showId"), rowId: str("rowId"), slideIdx: slideIdx(), ...optChannel() });
      break;
    case "scripture_take_slide_by_index":
    case "scripture_take_slide_at_cursor": {
      const hit = scriptureRowAt(id === "scripture_take_slide_by_index" ? "index" : "cursor");
      if (hit) messages.push({ type: "scripture_take_slide", showId: hit.show.id, rowId: hit.row.id, slideIdx: slideIdx(), ...optChannel() });
      break;
    }
    case "scripture_advance":
      messages.push({ type: "scripture_advance", channel: str("channel"), delta: num("delta", 1) < 0 ? -1 : 1 });
      break;
    case "scripture_goto":
      messages.push({ type: "scripture_goto", channel: str("channel"), slideIdx: slideIdx() });
      break;
    case "scripture_end":
      messages.push({ type: "scripture_end", channel: str("channel") });
      break;
    case "cursor_advance":
      localEvents.push({
        type: "local_cursor_advance",
        delta: num("delta", 1),
      });
      break;
    case "cursor_prev":
      localEvents.push({ type: "local_cursor_advance", delta: -1 });
      break;
    case "cursor_set":
      localEvents.push({ type: "local_cursor_set", rowId: str("rowId") });
      break;
    case "panic":
      // Every channel, graphics out and video hard-cut, in one server step.
      messages.push({ type: "clear_all_channels", cutVideo: opts["keepVideo"] !== true });
      break;
    case "create_countdown": {
      const totalMs = Math.round((num("minutes", 5) * 60 + num("seconds", 0)) * 1000);
      if (!Number.isFinite(totalMs) || totalMs <= 0) break;
      messages.push({
        type: "timer_create",
        label: (str("label") || "Countdown").slice(0, 60),
        mode: "countdown",
        durationMs: totalMs,
        overtime: opts["overtime"] !== false,
        start: opts["start"] !== false,
      });
      break;
    }
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
    case "song_take_row_by_index": {
      // Look up the row in the loaded show by 1-based index, then dispatch
      // the existing song_take. Index variant must use the loaded show
      // because the row dropdown only enumerates loaded-show rows — same
      // pattern as take_row_by_index above.
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row || row.kind !== "song") break;
      messages.push({
        type: "song_take",
        channel: str("channel", "program"),
        showId: show!.id,
        songRowId: row.id,
      });
      break;
    }
    case "song_take_row_pvw_pgm":
      messages.push({
        type: "song_take_pvw_to_pgm",
        showId: str("showId"),
        songRowId: str("songRowId"),
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    case "song_take_row_pvw_pgm_by_index": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row || row.kind !== "song") break;
      messages.push({
        type: "song_take_pvw_to_pgm",
        showId: show!.id,
        songRowId: row.id,
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    }
    case "song_take_sub": {
      // Fire one sub-take (intro / lyrics / outro) for a song row. Server
      // resolves the cascade (template id, field map, field literals) and
      // dispatches the right wire message under the hood.
      const sub = str("sub") as "intro" | "lyrics" | "outro";
      if (sub !== "intro" && sub !== "lyrics" && sub !== "outro") break;
      messages.push({
        type: "take_song_sub",
        showId: str("showId"),
        songRowId: str("songRowId"),
        sub,
        ...(str("channel") ? { channel: str("channel") } : {}),
      });
      break;
    }
    case "song_take_sub_by_index": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows[num("rowIndex", 1) - 1];
      if (!row || row.kind !== "song") break;
      const sub = str("sub") as "intro" | "lyrics" | "outro";
      if (sub !== "intro" && sub !== "lyrics" && sub !== "outro") break;
      messages.push({
        type: "take_song_sub",
        showId: show!.id,
        songRowId: row.id,
        sub,
        ...(str("channel") ? { channel: str("channel") } : {}),
      });
      break;
    }
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
    case "notes_next_point":
      messages.push({ type: "notes_point", delta: 1 });
      break;
    case "notes_prev_point":
      messages.push({ type: "notes_point", delta: -1 });
      break;
    case "notes_goto_point":
      messages.push({
        type: "notes_point",
        index: Math.max(0, Math.floor(num("index", 1)) - 1),
      });
      break;
    case "notes_scroll_down":
      messages.push({ type: "notes_scroll", delta: num("amount", 0.33) });
      break;
    case "notes_scroll_up":
      messages.push({ type: "notes_scroll", delta: -num("amount", 0.33) });
      break;
    case "notes_top":
      messages.push({ type: "notes_reset" });
      break;
    case "notes_select": {
      if (!state.loadedShowId) break;
      const notesId = str("notesId");
      messages.push({
        type: "notes_select",
        showId: state.loadedShowId,
        notesId: notesId === "__none__" || notesId === "" ? null : notesId,
      });
      break;
    }
    case "stage_message_send": {
      // The server rejects messages over 200 chars — cut rather than drop silently.
      const text = str("text").trim().slice(0, 200);
      if (text) messages.push({ type: "stage_message", text });
      break;
    }
    case "stage_message_clear":
      messages.push({ type: "stage_message_clear" });
      break;
    case "stage_timer_start":
    case "stage_timer_pause":
    case "stage_timer_resume":
    case "stage_timer_reset": {
      const timerId = str("timer", CURRENT_ITEM_TIMER_ID) || CURRENT_ITEM_TIMER_ID;
      messages.push({ type: TIMER_MESSAGE_FOR_ACTION[id], id: timerId });
      break;
    }
    case "stage_timer_adjust": {
      const timerId = str("timer", CURRENT_ITEM_TIMER_ID) || CURRENT_ITEM_TIMER_ID;
      const amount = num("amount", 60);
      if (Number.isFinite(amount)) messages.push({ type: "timer_adjust", id: timerId, deltaMs: Math.round(amount * 1000) });
      break;
    }
  }

  return warnings.length ? { messages, localEvents, warnings } : { messages, localEvents };
}

// ──── SDK-shaped definitions for Companion ────────────────────────────────

function channelDropdown(
  state: CompanionState,
  id = "channel",
  label = "Channel",
  defaultId?: string,
): CompanionInputFieldDropdown {
  // Mirror channels reflect another channel's runtime state. Taking on a
  // mirror would be a no-op since the renderer subscribes to the source, so
  // hide them from action targets entirely.
  const takeable = state.channels.filter((c) => !c.mirrorOf);
  const choices = takeable.length
    ? takeable.map((c) => ({ id: c.id, label: c.name }))
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

/** Channel dropdown whose first choice is "use the row / song default". */
function optionalChannelDropdown(
  state: CompanionState,
  id = "channel",
  label = "Channel (optional)",
): CompanionInputFieldDropdown {
  const base = channelDropdown(state, id, label);
  return { ...base, default: "", choices: [DEFAULT_CHANNEL_CHOICE, ...base.choices] };
}

/** Take channel for a hotcard; empty means the card's own default output. */
function hotcardChannelDropdown(
  state: CompanionState,
): CompanionInputFieldDropdown {
  const base = channelDropdown(state);
  return {
    ...base,
    default: "",
    choices: [{ id: "", label: "Default (card's output)" }, ...base.choices],
  };
}

function withDefaultChoice(
  d: CompanionInputFieldDropdown,
): CompanionInputFieldDropdown {
  return { ...d, choices: [DEFAULT_CHANNEL_CHOICE, ...d.choices] };
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
  const choices = rowChoices(state);
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
  multiline: true,
  tooltip: "One key=value per line. Keys are the template's field keys.",
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

const slideInput: CompanionInputFieldNumber = {
  id: "slide",
  type: "number",
  label: "Slide (1-based)",
  default: 1,
  min: 1,
  max: 200,
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
  label: "Auto-advance (STT)",
  default: false,
};

const subTakeInput: CompanionInputFieldDropdown = {
  id: "sub",
  type: "dropdown",
  label: "Sub-take",
  default: "lyrics",
  choices: [
    { id: "intro", label: "Intro" },
    { id: "lyrics", label: "Lyrics" },
    { id: "outro", label: "Outro" },
  ],
};

const notesAmountInput: CompanionInputFieldNumber = {
  id: "amount",
  type: "number",
  label: "Amount (viewport fraction)",
  default: 0.33,
  min: 0.05,
  max: 2,
};

const notesPointInput: CompanionInputFieldNumber = {
  id: "index",
  type: "number",
  label: "Point (1-based)",
  default: 1,
  min: 1,
  max: 999,
};

const stageTextInput: CompanionInputFieldTextInput = {
  id: "text",
  type: "textinput",
  label: "Message",
  default: "",
};

function notesDropdown(state: CompanionState): CompanionInputFieldDropdown {
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const choices = [
    ...(show?.sermonNotes ?? []).map((n) => ({ id: n.id, label: n.title })),
    { id: "__none__", label: "— none —" },
  ];
  return {
    id: "notesId",
    type: "dropdown",
    label: "Notes",
    default: choices[0]!.id,
    choices,
  };
}

function timerDropdown(state: CompanionState): CompanionInputFieldDropdown {
  const manual = state.timers
    .filter((t) => t.id !== CURRENT_ITEM_TIMER_ID)
    .map((t) => ({ id: t.id, label: t.label }));
  return {
    id: "timer",
    type: "dropdown",
    label: "Timer",
    default: CURRENT_ITEM_TIMER_ID,
    choices: [{ id: CURRENT_ITEM_TIMER_ID, label: "Current item" }, ...manual],
  };
}

const timerAmountInput: CompanionInputFieldNumber = {
  id: "amount",
  type: "number",
  label: "Seconds (negative to subtract)",
  default: 60,
  min: -86400,
  max: 86400,
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
      name: "Template: take on channel",
      options: [
        channelDropdown(state),
        templateDropdown(state),
        dataInput,
      ],
      callback: wrap("take_template"),
    },
    clear: {
      name: "Channel: clear graphics",
      options: [channelDropdown(state)],
      callback: wrap("clear"),
    },
    clear_all: {
      name: "Channel: clear graphics and video",
      options: [channelDropdown(state)],
      callback: wrap("clear_all"),
    },
    video_stop: {
      name: "Video: stop (animate out)",
      options: [channelDropdown(state)],
      callback: wrap("video_stop"),
    },
    video_play_pause: {
      name: "Video: play/pause",
      options: [channelDropdown(state)],
      callback: wrap("video_play_pause"),
    },
    video_restart: {
      name: "Video: restart",
      options: [channelDropdown(state)],
      callback: wrap("video_restart"),
    },
    cue_template: {
      name: "Template: cue on channel",
      options: [
        channelDropdown(state),
        templateDropdown(state),
        dataInput,
      ],
      callback: wrap("cue_template"),
    },
    take_pvw_to_pgm: {
      name: "Channel: take preview to program",
      options: [
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_pvw_to_pgm"),
    },
    fire_hotcard: {
      name: "Hotcard: take",
      options: [hotcardDropdown(state), hotcardChannelDropdown(state)],
      callback: wrap("fire_hotcard"),
    },
    cue_hotcard: {
      name: "Hotcard: cue",
      options: [hotcardDropdown(state)],
      callback: wrap("cue_hotcard"),
    },
    load_show: {
      name: "Show: load into Companion",
      options: [showDropdown(state)],
      callback: wrap("load_show"),
    },
    clear_loaded_show: {
      name: "Show: clear loaded show",
      options: [],
      callback: wrap("clear_loaded_show"),
    },
    select_next_show: {
      name: "Show: select next show (soonest upcoming, else most recent)",
      options: [],
      callback: wrap("select_next_show"),
    },
    take_row: {
      name: "Rundown: take row (pick from list)",
      options: [rowDropdown(state), withDefaultChoice(channelDropdown(state))],
      callback: wrap("take_row"),
    },
    take_row_by_index: {
      name: "Rundown: take row (by number)",
      options: [rowIndexInput, withDefaultChoice(channelDropdown(state))],
      callback: wrap("take_row_by_index"),
    },
    take_row_pvw_pgm: {
      name: "Rundown: take row via preview (pick from list)",
      options: [
        rowDropdown(state),
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_row_pvw_pgm"),
    },
    take_row_pvw_pgm_by_index: {
      name: "Rundown: take row via preview (by number)",
      options: [
        rowIndexInput,
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("take_row_pvw_pgm_by_index"),
    },
    take_row_at_cursor: {
      name: "Rundown: take row at cursor",
      options: [channelDropdown(state)],
      callback: wrap("take_row_at_cursor"),
    },
    scripture_take_intro: {
      name: "Scripture: take intro (pick from list)",
      options: [showDropdown(state), rowDropdown(state), optionalChannelDropdown(state)],
      callback: wrap("scripture_take_intro"),
    },
    scripture_take_intro_by_index: {
      name: "Scripture: take intro (by number)",
      options: [rowIndexInput, optionalChannelDropdown(state)],
      callback: wrap("scripture_take_intro_by_index"),
    },
    scripture_take_intro_at_cursor: {
      name: "Scripture: take intro (at cursor)",
      options: [optionalChannelDropdown(state)],
      callback: wrap("scripture_take_intro_at_cursor"),
    },
    scripture_take_slide: {
      name: "Scripture: take slide N (pick from list)",
      options: [showDropdown(state), rowDropdown(state), slideInput, optionalChannelDropdown(state)],
      callback: wrap("scripture_take_slide"),
    },
    scripture_take_slide_by_index: {
      name: "Scripture: take slide N (by number)",
      options: [rowIndexInput, slideInput, optionalChannelDropdown(state)],
      callback: wrap("scripture_take_slide_by_index"),
    },
    scripture_take_slide_at_cursor: {
      name: "Scripture: take slide N (at cursor)",
      options: [slideInput, optionalChannelDropdown(state)],
      callback: wrap("scripture_take_slide_at_cursor"),
    },
    scripture_advance: {
      name: "Scripture: next/previous slide (starts a queued scripture)",
      options: [channelDropdown(state), deltaInput],
      callback: wrap("scripture_advance"),
    },
    scripture_goto: {
      name: "Scripture: go to slide N (starts a queued scripture)",
      options: [channelDropdown(state), slideInput],
      callback: wrap("scripture_goto"),
    },
    scripture_end: {
      name: "Scripture: end (cancels a queued scripture)",
      options: [channelDropdown(state)],
      callback: wrap("scripture_end"),
    },
    take_row_song_aware: {
      name: "Rundown: take row (song-aware: songs take a part, other rows take normally)",
      options: [
        {
          id: "target",
          type: "dropdown",
          label: "Row",
          default: "cursor",
          choices: [
            { id: "cursor", label: "Row at cursor" },
            { id: "index", label: "Row by index" },
            { id: "id", label: "Row by ID" },
          ],
        },
        { ...rowIndexInput, isVisibleExpression: "$(options:target) == 'index'" },
        { ...rowDropdown(state), isVisibleExpression: "$(options:target) == 'id'" },
        { ...subTakeInput, label: "Song part (used only when the row is a song)" },
        {
          id: "pvwPgm",
          type: "checkbox",
          label: "Take via PVW → PGM",
          default: false,
        },
        {
          ...optionalChannelDropdown(state, "channel", "Channel (optional; blank = row/song default)"),
          isVisibleExpression: "!$(options:pvwPgm)",
        },
        {
          ...channelDropdown(state, "fromChannel", "From", "preview"),
          isVisibleExpression: "$(options:pvwPgm)",
        },
        {
          ...channelDropdown(state, "toChannel", "To", "program"),
          isVisibleExpression: "$(options:pvwPgm)",
        },
      ],
      callback: wrap("take_row_song_aware"),
    },
    cursor_advance: {
      name: "Cursor: move by N rows",
      options: [deltaInput],
      callback: wrap("cursor_advance"),
    },
    cursor_prev: {
      name: "Cursor: back one row",
      options: [],
      callback: wrap("cursor_prev"),
    },
    panic: {
      name: "Panic: clear all channels (graphics and video)",
      options: [
        {
          id: "keepVideo",
          type: "checkbox",
          label: "Leave video playing",
          default: false,
        },
      ],
      callback: wrap("panic"),
    },
    create_countdown: {
      name: "Stage timer: create countdown",
      options: [
        { id: "label", type: "textinput", label: "Label", default: "Countdown" },
        { id: "minutes", type: "number", label: "Minutes", default: 5, min: 0, max: 1440, step: 1 },
        { id: "seconds", type: "number", label: "Seconds", default: 0, min: 0, max: 59, step: 1 },
        { id: "overtime", type: "checkbox", label: "Count into overtime past zero", default: true },
        { id: "start", type: "checkbox", label: "Start immediately", default: true },
      ],
      callback: wrap("create_countdown"),
    },
    cursor_set: {
      name: "Cursor: set to row (pick from list)",
      options: [rowDropdown(state)],
      callback: wrap("cursor_set"),
    },
    cursor_set_by_index: {
      name: "Cursor: set to row (by number)",
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
    song_take_row_by_index: {
      name: "Song: take row (loaded show, by number)",
      options: [rowIndexInput, channelDropdown(state)],
      callback: wrap("song_take_row_by_index"),
    },
    song_take_row_pvw_pgm: {
      name: "Song: take row via preview (any show)",
      options: [
        showDropdown(state),
        { ...rowDropdown(state), id: "songRowId" },
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("song_take_row_pvw_pgm"),
    },
    song_take_row_pvw_pgm_by_index: {
      name: "Song: take row via preview (loaded show, by number)",
      options: [
        rowIndexInput,
        channelDropdown(state, "fromChannel", "From", "preview"),
        channelDropdown(state, "toChannel", "To", "program"),
      ],
      callback: wrap("song_take_row_pvw_pgm_by_index"),
    },
    song_take_sub: {
      name: "Song: take part (pick from list)",
      options: [
        showDropdown(state),
        { ...rowDropdown(state), id: "songRowId" },
        subTakeInput,
        // Optional channel override; empty = use the cascade-resolved channel.
        optionalChannelDropdown(state),
      ],
      callback: wrap("song_take_sub"),
    },
    song_take_sub_by_index: {
      name: "Song: take part (by number)",
      options: [
        rowIndexInput,
        subTakeInput,
        optionalChannelDropdown(state),
      ],
      callback: wrap("song_take_sub_by_index"),
    },
    song_advance: {
      name: "Song: next/previous slide",
      options: [channelDropdown(state), deltaInput],
      callback: wrap("song_advance"),
    },
    song_jump_section: {
      name: "Song: jump to section",
      options: [channelDropdown(state), sectionIdInput],
      callback: wrap("song_jump_section"),
    },
    song_jump_kind: {
      name: "Song: jump to section by type",
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
      name: "Auto-advance (STT): on/off",
      options: [channelDropdown(state), trustInput],
      callback: wrap("song_set_trust"),
    },
    stt_start: {
      name: "Speech-to-text: start listening",
      options: [],
      callback: wrap("stt_start"),
    },
    stt_stop: {
      name: "Speech-to-text: stop listening",
      options: [],
      callback: wrap("stt_stop"),
    },
    notes_next_point: {
      name: "Sermon notes: next point",
      options: [],
      callback: wrap("notes_next_point"),
    },
    notes_prev_point: {
      name: "Sermon notes: previous point",
      options: [],
      callback: wrap("notes_prev_point"),
    },
    notes_goto_point: {
      name: "Sermon notes: go to point",
      options: [notesPointInput],
      callback: wrap("notes_goto_point"),
    },
    notes_scroll_down: {
      name: "Sermon notes: scroll down",
      options: [notesAmountInput],
      callback: wrap("notes_scroll_down"),
    },
    notes_scroll_up: {
      name: "Sermon notes: scroll up",
      options: [notesAmountInput],
      callback: wrap("notes_scroll_up"),
    },
    notes_top: {
      name: "Sermon notes: scroll to top",
      options: [],
      callback: wrap("notes_top"),
    },
    notes_select: {
      name: "Sermon notes: select set (loaded show)",
      options: [notesDropdown(state)],
      callback: wrap("notes_select"),
    },
    stage_message_send: {
      name: "Stage: send message",
      options: [stageTextInput],
      callback: wrap("stage_message_send"),
    },
    stage_message_clear: {
      name: "Stage: clear message",
      options: [],
      callback: wrap("stage_message_clear"),
    },
    stage_timer_start: {
      name: "Stage timer: start",
      options: [timerDropdown(state)],
      callback: wrap("stage_timer_start"),
    },
    stage_timer_pause: {
      name: "Stage timer: pause",
      options: [timerDropdown(state)],
      callback: wrap("stage_timer_pause"),
    },
    stage_timer_resume: {
      name: "Stage timer: resume",
      options: [timerDropdown(state)],
      callback: wrap("stage_timer_resume"),
    },
    stage_timer_reset: {
      name: "Stage timer: reset",
      options: [timerDropdown(state)],
      callback: wrap("stage_timer_reset"),
    },
    stage_timer_adjust: {
      name: "Stage timer: adjust",
      options: [timerDropdown(state), timerAmountInput],
      callback: wrap("stage_timer_adjust"),
    },
  };
}
