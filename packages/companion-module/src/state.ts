import type { ServerMessage } from "@overlaysys/ws-protocol";
import type { CompanionState } from "./types";

export type LocalEvent =
  | { type: "local_connected" }
  | { type: "local_reconnecting" }
  | { type: "local_disconnected" }
  | { type: "local_load_show"; showId: string }
  | { type: "local_clear_loaded_show" }
  | { type: "local_cursor_set"; rowId: string }
  | { type: "local_cursor_advance"; delta: number };

export type ReducerEvent = ServerMessage | LocalEvent;

export function apply(
  state: CompanionState,
  evt: ReducerEvent,
): CompanionState {
  switch (evt.type) {
    case "local_connected":
      return { ...state, connected: true, connectionState: "connected" };
    case "local_reconnecting":
      return { ...state, connected: false, connectionState: "reconnecting" };
    case "local_disconnected":
      return { ...state, connected: false, connectionState: "disconnected" };

    case "state": {
      const next = new Map(state.channelStates);
      next.set(evt.channel, evt.state);
      return { ...state, channelStates: next };
    }

    case "template_list":
      return { ...state, templates: evt.templates };
    case "hotcard_list":
      return { ...state, hotcards: evt.hotcards };
    case "show_list": {
      const stillThere = state.loadedShowId
        ? evt.shows.some((s) => s.id === state.loadedShowId)
        : true;
      if (!stillThere) {
        return {
          ...state,
          shows: evt.shows,
          loadedShowId: null,
          loadedShowRowCursor: null,
        };
      }
      return { ...state, shows: evt.shows };
    }
    case "song_list":
      return { ...state, songs: evt.songs };
    case "channel_list":
      return { ...state, channels: evt.configs };

    case "show": {
      const next = new Map(state.showCache);
      next.set(evt.show.id, evt.show);
      return { ...state, showCache: next };
    }
    case "song": {
      const next = new Map(state.songCache);
      next.set(evt.song.id, evt.song);
      return { ...state, songCache: next };
    }
    case "hotcard": {
      const nextCache = new Map(state.hotcardCache);
      nextCache.set(evt.hotcard.id, evt.hotcard);
      const meta = {
        id: evt.hotcard.id,
        name: evt.hotcard.name,
        projectId: evt.hotcard.projectId,
        templateId: evt.hotcard.templateId,
      };
      const idx = state.hotcards.findIndex((h) => h.id === evt.hotcard.id);
      const hotcards =
        idx >= 0
          ? state.hotcards.map((h, i) => (i === idx ? meta : h))
          : [...state.hotcards, meta];
      return { ...state, hotcardCache: nextCache, hotcards };
    }
    case "template": {
      const idx = state.templates.findIndex((t) => t.id === evt.template.id);
      const meta = {
        id: evt.template.id,
        name: evt.template.name,
        size: evt.template.size,
      };
      const templates =
        idx >= 0
          ? state.templates.map((t, i) => (i === idx ? meta : t))
          : [...state.templates, meta];
      return { ...state, templates };
    }
    case "channel": {
      const idx = state.channels.findIndex((c) => c.id === evt.config.id);
      const channels =
        idx >= 0
          ? state.channels.map((c, i) => (i === idx ? evt.config : c))
          : [...state.channels, evt.config];
      return { ...state, channels };
    }

    case "stt_spawner_status":
      return { ...state, sttSpawner: evt.status };
    case "stt_listener_state":
      return { ...state, sttListeners: evt.listeners };

    case "error":
      return { ...state, lastError: `${evt.code}: ${evt.message}` };

    case "local_load_show":
      return {
        ...state,
        loadedShowId: evt.showId,
        loadedShowRowCursor: 0,
      };
    case "local_clear_loaded_show":
      return { ...state, loadedShowId: null, loadedShowRowCursor: null };
    case "local_cursor_advance": {
      if (state.loadedShowId == null) return state;
      const show = state.showCache.get(state.loadedShowId);
      if (!show || show.rows.length === 0) return state;
      const cur = state.loadedShowRowCursor ?? 0;
      const next = Math.max(0, Math.min(show.rows.length - 1, cur + evt.delta));
      return { ...state, loadedShowRowCursor: next };
    }
    case "local_cursor_set": {
      if (state.loadedShowId == null) return state;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return state;
      const idx = show.rows.findIndex((r) => r.id === evt.rowId);
      if (idx < 0) return state;
      return { ...state, loadedShowRowCursor: idx };
    }

    default:
      return state;
  }
}
