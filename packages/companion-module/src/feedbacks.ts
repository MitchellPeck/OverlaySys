import type { ActiveGraphic, RundownRow } from "@overlaysys/core";
import type { CompanionState } from "./types";

export type FeedbackId =
  | "channel_is_live"
  | "channel_is_blank"
  | "hotcard_on_air"
  | "song_active"
  | "song_trust_on"
  | "song_section_is"
  | "stt_running"
  | "connection_lost"
  | "show_loaded"
  | "row_is_cursor"
  | "row_is_active";

export type FeedbackOptions = Record<
  string,
  string | number | boolean | undefined
>;

export interface FeedbackDefinition {
  id: FeedbackId;
  name: string;
  description: string;
  options: { id: string; type: "channel" | "hotcard" | "row" | "kind_ordinal" }[];
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
    name: "Row is at cursor",
    description: "True when the chosen row is at the cursor position.",
    options: [{ id: "rowId", type: "row" }],
  },
  {
    id: "row_is_active",
    name: "Row is active on PGM",
    description:
      "True when the chosen row's content currently matches PGM.",
    options: [{ id: "rowId", type: "row" }],
  },
];

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: RundownRow,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
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
  }
}
