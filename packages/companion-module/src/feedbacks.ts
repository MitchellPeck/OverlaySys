import type { ActiveGraphic, Show, ShowSong, Song, RundownRow, SongRow } from "@overlaysys/core";
import type {
  CompanionFeedbackDefinitions,
  CompanionInputFieldDropdown,
  CompanionInputFieldNumber,
  CompanionInputFieldTextInput,
} from "@companion-module/base";
import { ITEM_WARN_MS, serverNow, type CompanionState } from "./types";
import { CURRENT_ITEM_TIMER_ID, timerMs, timerPhase } from "@overlaysys/core";

export type FeedbackId =
  | "channel_is_live"
  | "channel_is_blank"
  | "hotcard_on_air"
  | "video_on_air"
  | "video_paused"
  | "song_active"
  | "song_queued"
  | "scripture_active"
  | "scripture_queued"
  | "scripture_slide_is"
  | "song_trust_on"
  | "song_section_is"
  | "song_sub_take_on_channel"
  | "song_sub_take_on_channel_by_index"
  | "stt_running"
  | "connection_lost"
  | "show_loaded"
  | "row_is_cursor"
  | "row_is_active"
  | "row_at_index_is_cursor"
  | "row_at_index_is_active"
  | "cursor_row_kind_is"
  | "row_at_index_kind_is"
  | "notes_active"
  | "notes_at_first"
  | "notes_at_last"
  | "stage_message_showing"
  | "item_timer_warning"
  | "item_timer_overtime"
  | "pco_live_active";

export type FeedbackOptions = Record<
  string,
  string | number | boolean | undefined
>;

export interface FeedbackDefinition {
  id: FeedbackId;
  name: string;
  description: string;
  options: {
    id: string;
    type:
      | "channel"
      | "hotcard"
      | "row"
      | "row_index"
      | "kind_ordinal"
      | "sub_take"
      | "row_kind"
      | "slide";
  }[];
}

export const feedbackDefinitions: FeedbackDefinition[] = [
  {
    id: "notes_active",
    name: "Pastor notes active",
    description: "True when pastor notes with at least one point are selected.",
    options: [],
  },
  {
    id: "notes_at_first",
    name: "Pastor notes at first point",
    description: "True when notes are active and on the first point.",
    options: [],
  },
  {
    id: "notes_at_last",
    name: "Pastor notes at last point",
    description: "True when notes are active and on the last point.",
    options: [],
  },
  {
    id: "stage_message_showing",
    name: "Stage message showing",
    description: "True while a message is shown on the stage display.",
    options: [],
  },
  {
    id: "item_timer_warning",
    name: "Item timer warning",
    description: "True when the current item timer is under 60 seconds remaining (not yet overtime).",
    options: [],
  },
  {
    id: "item_timer_overtime",
    name: "Item timer overtime",
    description: "True when the current item timer has run past zero (overtime on).",
    options: [],
  },
  {
    id: "pco_live_active",
    name: "PCO Live active",
    description: "True while PCO Live sync is on and the service is live.",
    options: [],
  },
  {
    id: "channel_is_live",
    name: "Channel is live",
    description: "True when the chosen channel has a graphic on air.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "channel_is_blank",
    name: "Channel is blank",
    description: "True when the chosen channel is cleared.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "video_on_air",
    name: "Video is on air",
    description: "True while the chosen channel has a video up (playing, paused or held on its last frame).",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "video_paused",
    name: "Video is paused",
    description: "True when the chosen channel's video is paused or holding at its end.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "hotcard_on_air",
    name: "Hotcard is on air",
    description:
      "True when the chosen channel currently shows this hotcard's content.",
    options: [
      { id: "hotcardId", type: "hotcard" },
      { id: "channel", type: "channel" },
    ],
  },
  {
    id: "song_active",
    name: "Song session active",
    description: "True when the chosen channel has a live song session.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "song_queued",
    name: "Song queued (intro taken)",
    description:
      "True when the chosen channel has a song armed by its intro take. Song " +
      "section / slide / advance actions on that channel will start it.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "song_trust_on",
    name: "Song trust mode on",
    description:
      "True when the chosen channel's song session has trust mode enabled.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "song_section_is",
    name: "Song section matches",
    description: "True when the active section's kind + ordinal matches.",
    options: [
      { id: "channel", type: "channel" },
      { id: "kind_ordinal", type: "kind_ordinal" },
    ],
  },
  {
    id: "song_sub_take_on_channel",
    name: "Song sub-take is on channel (by row ID)",
    description:
      "True when the chosen channel is currently showing the chosen sub-take " +
      "(intro / lyrics / outro) for the chosen song row. Sub-take template ids " +
      "are resolved through the Song → ShowSong → Row cascade. Lyrics is true " +
      "while a same-song session is live on the channel; intro/outro are true " +
      "while the channel's active mount matches the resolved sub-take template.",
    options: [
      { id: "channel", type: "channel" },
      { id: "rowId", type: "row" },
      { id: "sub", type: "sub_take" },
    ],
  },
  {
    id: "song_sub_take_on_channel_by_index",
    name: "Song sub-take is on channel (by row index)",
    description:
      "Same as 'Song sub-take is on channel' but selects the song row from the " +
      "loaded show by 1-based index — survives show changes.",
    options: [
      { id: "channel", type: "channel" },
      { id: "rowIndex", type: "row_index" },
      { id: "sub", type: "sub_take" },
    ],
  },
  {
    id: "scripture_active",
    name: "Scripture slides live",
    description: "True when the chosen channel shows a scripture slide.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "scripture_queued",
    name: "Scripture queued (intro taken)",
    description: "True when the chosen channel has a scripture armed by its intro. Next / go to slide on that channel will start it.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "scripture_slide_is",
    name: "Scripture slide N is live",
    description: "True when the chosen channel's live scripture is on slide N (1-based).",
    options: [{ id: "channel", type: "channel" }, { id: "slide", type: "slide" }],
  },
  {
    id: "stt_running",
    name: "STT spawner running",
    description: "True when the STT spawner reports running state.",
    options: [],
  },
  {
    id: "connection_lost",
    name: "Connection lost",
    description: "True when the WebSocket is not connected.",
    options: [],
  },
  {
    id: "show_loaded",
    name: "Show is loaded",
    description: "True when a show has been loaded into this Companion instance.",
    options: [],
  },
  {
    id: "row_is_cursor",
    name: "Row is at cursor (by row ID)",
    description: "True when the chosen row is at the cursor position.",
    options: [{ id: "rowId", type: "row" }],
  },
  {
    id: "row_is_active",
    name: "Row is active on PGM (by row ID)",
    description:
      "True when the chosen row's content currently matches PGM.",
    options: [{ id: "rowId", type: "row" }],
  },
  {
    id: "row_at_index_is_cursor",
    name: "Row at index is at cursor",
    description:
      "True when the row at the given 1-based index is at the cursor — survives show changes.",
    options: [{ id: "rowIndex", type: "row_index" }],
  },
  {
    id: "row_at_index_is_active",
    name: "Row at index is active on PGM",
    description:
      "True when the row at the given 1-based index currently matches PGM — survives show changes.",
    options: [{ id: "rowIndex", type: "row_index" }],
  },
  {
    id: "cursor_row_kind_is",
    name: "Cursor row is type",
    description:
      "True when the row at the cursor is the chosen type (song, graphic, " +
      "video, scripture). Use it to style a button or branch a button's " +
      "actions when the current line is a song.",
    options: [{ id: "kind", type: "row_kind" }],
  },
  {
    id: "row_at_index_kind_is",
    name: "Row at index is type",
    description:
      "True when the row at the given 1-based index is the chosen type — " +
      "survives show changes.",
    options: [
      { id: "rowIndex", type: "row_index" },
      { id: "kind", type: "row_kind" },
    ],
  },
];

/**
 * Resolves which template id corresponds to a given sub-take for a song row,
 * walking the Row → ShowSong → Song cascade. Returns null when no template is
 * configured at any layer (no intro/outro defined for the song — feedback
 * should be false).
 */
function resolveSubTakeTemplateId(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  sub: "intro" | "lyrics" | "outro",
): string | null {
  if (sub === "lyrics") {
    return row.lyricTemplateId ?? showSong?.lyricTemplateId ?? song.defaultLyricTemplateId ?? null;
  }
  if (sub === "intro") {
    return row.introTemplateId ?? showSong?.introTemplateId ?? song.defaultIntroTemplateId ?? null;
  }
  return row.outroTemplateId ?? showSong?.outroTemplateId ?? song.defaultOutroTemplateId ?? null;
}

function findSongRow(
  show: Show | undefined,
  rowId: string | undefined,
  rowIndex: number | undefined,
): SongRow | null {
  if (!show) return null;
  let row: RundownRow | undefined;
  if (rowId !== undefined) {
    row = show.rows.find((r) => r.id === rowId);
  } else if (rowIndex !== undefined) {
    row = show.rows[rowIndex - 1];
  }
  return row && row.kind === "song" ? row : null;
}

function resolveSubTakeOnChannelMatch(
  state: CompanionState,
  channel: string,
  rowId: string | undefined,
  rowIndex: number | undefined,
  sub: "intro" | "lyrics" | "outro",
): boolean {
  if (sub !== "intro" && sub !== "lyrics" && sub !== "outro") return false;
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const row = findSongRow(show, rowId, rowIndex);
  if (!row || !show) return false;
  const song = state.songCache.get(row.songId);
  if (!song) return false;
  const channelState = state.channelStates.get(channel);
  if (sub === "lyrics") {
    // Lyrics are "on" the channel iff a same-song session is currently live
    // there. The active mount must also be present (a blanked session still
    // has the session record but no active — operator's intent is "lyrics
    // visible", so blank disqualifies).
    return Boolean(
      channelState?.songSession &&
        channelState.songSession.songId === row.songId &&
        channelState.active,
    );
  }
  // intro / outro: match on the cascade-resolved template id.
  const showSong = show.songs.find((e) => e.songId === row.songId);
  const targetTplId = resolveSubTakeTemplateId(row, showSong, song, sub);
  if (!targetTplId) return false;
  return channelState?.active?.templateId === targetTplId;
}

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: RundownRow,
  pgmScriptureRowId: string | undefined,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (row.kind === "scripture") {
    return Boolean(pgmScriptureRowId === row.id || active?.scriptureContext?.rowId === row.id);
  }
  if (row.kind === "video") return false;
  if (!active) return false;
  if (active.templateId !== row.templateId) return false;
  const a = active.data;
  const b = row.data;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function feedbackPredicate(
  state: CompanionState,
  id: FeedbackId,
  options: FeedbackOptions,
  now: number = serverNow(state),
): boolean {
  switch (id) {
    case "item_timer_warning":
    case "item_timer_overtime": {
      const item = state.timers.find((t) => t.id === CURRENT_ITEM_TIMER_ID);
      if (!item) return false;
      const phase = timerPhase(item.mode, timerMs(item, now), item.overtime, ITEM_WARN_MS);
      return phase === (id === "item_timer_warning" ? "warn" : "over");
    }
    case "pco_live_active":
      return !!state.pcoLive?.enabled && state.pcoLive.status === "live";
    case "notes_active":
      return (state.stage?.pointCount ?? 0) > 0;
    case "notes_at_first":
      return !!state.stage && state.stage.pointCount > 0 && state.stage.state.pointIdx === 0;
    case "notes_at_last":
      return (
        !!state.stage &&
        state.stage.pointCount > 0 &&
        state.stage.state.pointIdx >= state.stage.pointCount - 1
      );
    case "stage_message_showing":
      return state.stage?.state.message != null;
    case "scripture_active":
      return Boolean(state.channelStates.get(String(options.channel ?? ""))?.scriptureSession);
    case "scripture_queued":
      return Boolean(state.channelStates.get(String(options.channel ?? ""))?.queuedScripture);
    case "scripture_slide_is": {
      const sess = state.channelStates.get(String(options.channel ?? ""))?.scriptureSession;
      return !!sess && sess.slideIdx === Number(options.slide ?? 1) - 1;
    }
    case "channel_is_live": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active != null;
    }
    case "channel_is_blank": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active == null;
    }
    case "video_on_air": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.media != null;
    }
    case "video_paused": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.media?.paused === true;
    }
    case "hotcard_on_air": {
      const hc = state.hotcardCache.get(String(options.hotcardId ?? ""));
      if (!hc) return false;
      const channel = String(options.channel ?? "program");
      const active = state.channelStates.get(channel)?.active;
      if (!active) return false;
      if (active.templateId !== hc.templateId) return false;
      const a = active.data;
      const b = hc.data;
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (a[k] !== b[k]) return false;
      }
      return true;
    }
    case "song_active": {
      const c = String(options.channel ?? "");
      return Boolean(state.channelStates.get(c)?.songSession);
    }
    case "song_queued": {
      const c = String(options.channel ?? "");
      return Boolean(state.channelStates.get(c)?.queuedSong);
    }
    case "song_trust_on": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.songSession?.trustMode === true;
    }
    case "song_section_is": {
      const c = String(options.channel ?? "");
      const sess = state.channelStates.get(c)?.songSession;
      if (!sess) return false;
      const song = state.songCache.get(sess.songId);
      if (!song) return false;
      const sectionId = sess.arrangement[sess.cursor.sectionIdx];
      const section = song.sections.find((s) => s.id === sectionId);
      if (!section) return false;
      const target = String(options.kind_ordinal ?? "");
      const [kind, ordStr] = target.split(":");
      const ord = Number(ordStr);
      if (!kind || !Number.isFinite(ord)) return false;
      let seen = 0;
      for (let i = 0; i <= sess.cursor.sectionIdx; i++) {
        const sid = sess.arrangement[i];
        const s = song.sections.find((x) => x.id === sid);
        if (s?.kind === kind) seen++;
      }
      return section.kind === kind && seen === ord;
    }
    case "song_sub_take_on_channel": {
      const channel = String(options.channel ?? "");
      const rowId = String(options.rowId ?? "");
      const sub = String(options.sub ?? "") as "intro" | "lyrics" | "outro";
      return resolveSubTakeOnChannelMatch(state, channel, rowId, undefined, sub);
    }
    case "song_sub_take_on_channel_by_index": {
      const channel = String(options.channel ?? "");
      const rowIndex = Number(options.rowIndex ?? 1);
      const sub = String(options.sub ?? "") as "intro" | "lyrics" | "outro";
      return resolveSubTakeOnChannelMatch(state, channel, undefined, rowIndex, sub);
    }
    case "stt_running":
      return state.sttSpawner?.state === "running";
    case "connection_lost":
      return !state.connected;
    case "show_loaded":
      return state.loadedShowId != null;
    case "row_is_cursor": {
      if (state.loadedShowId == null || state.loadedShowRowCursor == null)
        return false;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return false;
      const row = show.rows[state.loadedShowRowCursor];
      return row?.id === String(options.rowId ?? "");
    }
    case "row_is_active": {
      if (state.loadedShowId == null) return false;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return false;
      const row = show.rows.find((r) => r.id === String(options.rowId ?? ""));
      if (!row) return false;
      const pgm = state.channelStates.get("program");
      return rowMatchesPgm(pgm?.active ?? null, pgm?.songSession?.songId, row, pgm?.scriptureSession?.rowId);
    }
    case "row_at_index_is_cursor": {
      if (state.loadedShowId == null || state.loadedShowRowCursor == null)
        return false;
      const idx = Number(options.rowIndex ?? 1) - 1;
      return state.loadedShowRowCursor === idx;
    }
    case "row_at_index_is_active": {
      if (state.loadedShowId == null) return false;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return false;
      const idx = Number(options.rowIndex ?? 1) - 1;
      const row = show.rows[idx];
      if (!row) return false;
      const pgm = state.channelStates.get("program");
      return rowMatchesPgm(pgm?.active ?? null, pgm?.songSession?.songId, row, pgm?.scriptureSession?.rowId);
    }
    case "cursor_row_kind_is": {
      if (state.loadedShowId == null || state.loadedShowRowCursor == null)
        return false;
      const show = state.showCache.get(state.loadedShowId);
      const row = show?.rows[state.loadedShowRowCursor];
      return row?.kind === String(options.kind ?? "");
    }
    case "row_at_index_kind_is": {
      if (state.loadedShowId == null) return false;
      const show = state.showCache.get(state.loadedShowId);
      const row = show?.rows[Number(options.rowIndex ?? 1) - 1];
      return row?.kind === String(options.kind ?? "");
    }
  }
}

// ──── SDK-shaped definitions ─────────────────────────────────────────────

function channelDropdownF(state: CompanionState): CompanionInputFieldDropdown {
  // Match the actions module: hide mirror channels. Their runtime state is
  // identical to the source they mirror, so selecting one would only add
  // noise to feedback dropdowns.
  const takeable = state.channels.filter((c) => !c.mirrorOf);
  const choices = takeable.length
    ? takeable.map((c) => ({ id: c.id, label: c.name }))
    : [
        { id: "program", label: "program" },
        { id: "preview", label: "preview" },
      ];
  return {
    id: "channel",
    type: "dropdown",
    label: "Channel",
    default: choices[0]?.id ?? "program",
    choices,
  };
}

function hotcardDropdownF(state: CompanionState): CompanionInputFieldDropdown {
  const choices = state.hotcards.map((h) => ({ id: h.id, label: h.name }));
  return {
    id: "hotcardId",
    type: "dropdown",
    label: "Hotcard",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no hotcards)" }],
  };
}

function rowDropdownF(state: CompanionState): CompanionInputFieldDropdown {
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
    id: "rowId",
    type: "dropdown",
    label: "Row",
    default: choices[0]?.id ?? "",
    choices: choices.length ? choices : [{ id: "", label: "(no show loaded)" }],
  };
}

const kindOrdinalInput: CompanionInputFieldTextInput = {
  id: "kind_ordinal",
  type: "textinput",
  label: "Kind:Ordinal (e.g. verse:2)",
  default: "verse:1",
};

const slideInputF: CompanionInputFieldNumber = {
  id: "slide",
  type: "number",
  label: "Slide (1-based)",
  default: 1,
  min: 1,
  max: 200,
  step: 1,
};

const rowIndexInputF: CompanionInputFieldNumber = {
  id: "rowIndex",
  type: "number",
  label: "Row index (1-based; survives show changes)",
  default: 1,
  min: 1,
  max: 200,
  step: 1,
};

const subTakeInputF: CompanionInputFieldDropdown = {
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

const rowKindInputF: CompanionInputFieldDropdown = {
  id: "kind",
  type: "dropdown",
  label: "Row type",
  default: "song",
  choices: [
    { id: "song", label: "Song" },
    { id: "graphic", label: "Graphic" },
    { id: "video", label: "Video" },
    { id: "scripture", label: "Scripture" },
  ],
};

export type FeedbackChecker = (
  id: FeedbackId,
  options: FeedbackOptions,
) => boolean;

export function feedbackDefinitionsForSDK(
  state: CompanionState,
  isTrue: FeedbackChecker,
): CompanionFeedbackDefinitions {
  const defs: CompanionFeedbackDefinitions = {};

  for (const d of feedbackDefinitions) {
    const opts = d.options.map((o) => {
      switch (o.type) {
        case "channel":
          return channelDropdownF(state);
        case "hotcard":
          return hotcardDropdownF(state);
        case "row":
          return rowDropdownF(state);
        case "row_index":
          return rowIndexInputF;
        case "kind_ordinal":
          return kindOrdinalInput;
        case "sub_take":
          return subTakeInputF;
        case "row_kind":
          return rowKindInputF;
        case "slide":
          return slideInputF;
      }
    });
    defs[d.id] = {
      name: d.name,
      description: d.description,
      type: "boolean",
      defaultStyle: { color: 0xffffff, bgcolor: 0x00aa00 },
      options: opts,
      callback: (fb) => isTrue(d.id, fb.options as FeedbackOptions),
    };
  }
  return defs;
}
