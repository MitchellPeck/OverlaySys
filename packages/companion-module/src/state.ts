import type { ServerMessage } from "@overlaysys/ws-protocol";
import type { CompanionState } from "./types";

export type LocalEvent =
  | { type: "local_connected" }
  | { type: "local_reconnecting" }
  | { type: "local_disconnected" }
  | { type: "local_reset_live" }
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
      // Drop live timer/PCO data so the 1 s tick never projects stale values.
      return {
        ...state,
        connected: false,
        connectionState: "reconnecting",
        timers: [],
        pcoLive: null,
        outputs: null,
      };
    case "local_reset_live":
      return { ...state, timers: [], pcoLive: null };
    case "hello":
      return {
        ...state,
        serverTimeOffsetMs: evt.serverTime - Date.now(),
        serverVersion: evt.serverVersion ?? null,
        serverProtocolVersion: evt.protocolVersion,
      };
    case "local_disconnected":
      return {
        ...state,
        connected: false,
        connectionState: "disconnected",
        stage: null,
        timers: [],
        pcoLive: null,
        outputs: null,
      };

    case "state": {
      const next = new Map(state.channelStates);
      next.set(evt.channel, evt.state);
      const live = [...next.values()].some((st) => !!st.songSession);
      const songLiveSince = live ? (state.songLiveSince ?? Date.now()) : null;
      return { ...state, channelStates: next, songLiveSince };
    }

    case "outputs_state":
      return { ...state, outputs: evt.outputs };

    case "media_playback": {
      const next = new Map(state.mediaPlayback);
      next.set(evt.channel, { takenAt: evt.takenAt, playback: evt.playback });
      return { ...state, mediaPlayback: next };
    }

    case "stt_match":
      return {
        ...state,
        stt: {
          confidence: evt.confidence,
          lastHypothesis: evt.hypothesis,
          lastMatchAt: Date.now(),
        },
      };

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
    case "deck_list":
      return { ...state, decks: evt.decks.map((d) => ({ id: d.id, name: d.name })) };
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
      // [P2b.11] a designer's unsaved draft (preview-only) is never offered as a template
      if (evt.template.id.startsWith("__draft__")) return state;
      // [/P2b.11]
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

    case "stage_state":
      return {
        ...state,
        stage: {
          state: evt.state,
          pointCount: evt.pointCount,
          title: evt.title,
          pointHeading: evt.pointHeading,
          nextHeading: evt.nextHeading,
        },
      };

    case "timers_state":
      return { ...state, timers: evt.timers };

    case "pco_live_state":
      return { ...state, pcoLive: evt };

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

    // [P2b.34]
    case "stage_layout_list":
      return { ...state, stageLayouts: evt.layouts };
    case "stage_layout_status":
      return {
        ...state,
        stageLayoutStatus: new Map(
          evt.screens.map((s) => [s.channel, { layoutId: s.layoutId, reason: s.reason, manual: s.manual }]),
        ),
      };
    // [/P2b.34]

    default:
      return state;
  }
}

/** True when something on screen changes with time alone (running timer, live PCO service, song live for the STT silence count). */
export function hasRunningWork(state: CompanionState): boolean {
  return (
    state.timers.some((t) => t.anchor !== null && t.pausedAt === undefined) ||
    state.pcoLive?.service?.status === "live" ||
    // STT "silent for N s" counts up while a song is live.
    state.songLiveSince !== null
  );
}
