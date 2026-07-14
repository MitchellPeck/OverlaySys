import type { ActiveGraphic, Show, ShowSong, Song, RundownRow, SongRow } from "@overlaysys/core";
import type {
  CompanionFeedbackDefinitions,
  CompanionInputFieldDropdown,
  CompanionInputFieldNumber,
  CompanionInputFieldTextInput,
} from "@companion-module/base";
import type { CompanionState } from "./types";

export type FeedbackId =
  | "channel_is_live"
  | "channel_is_blank"
  | "hotcard_on_air"
  | "song_active"
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
  | "row_at_index_is_active";

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
    type: "channel" | "hotcard" | "row" | "row_index" | "kind_ordinal" | "sub_take";
  }[];
}

export const feedbackDefinitions: FeedbackDefinition[] = [
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
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (row.kind === "scripture") {
    // TODO: wire scripture row in Task E4 / D1 — placeholder for exhaustive switch
    return false;
  }
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
): boolean {
  switch (id) {
    case "channel_is_live": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active != null;
    }
    case "channel_is_blank": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active == null;
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
      return rowMatchesPgm(pgm?.active ?? null, pgm?.songSession?.songId, row);
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
      return rowMatchesPgm(pgm?.active ?? null, pgm?.songSession?.songId, row);
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
