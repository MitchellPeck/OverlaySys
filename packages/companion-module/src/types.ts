import type {
  ChannelState,
  ChannelConfig,
  Show,
  Song,
  SongMeta,
  HotcardMeta,
  TemplateMeta,
  SttSpawnerStatus,
} from "@overlaysys/core";

export interface ShowMeta {
  id: string;
  name: string;
  rowCount: number;
}

export interface SttListener {
  audioSourceId: string;
  label?: string;
  online: boolean;
  lastSeen: number;
}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface CompanionState {
  connected: boolean;
  connectionState: ConnectionState;
  channelStates: Map<string, ChannelState>;
  templates: TemplateMeta[];
  shows: ShowMeta[];
  songs: SongMeta[];
  hotcards: HotcardMeta[];
  channels: ChannelConfig[];
  showCache: Map<string, Show>;
  songCache: Map<string, Song>;
  loadedShowId: string | null;
  loadedShowRowCursor: number | null;
  sttSpawner: SttSpawnerStatus | null;
  sttListeners: SttListener[];
  lastError: string | null;
}

export function initialState(): CompanionState {
  return {
    connected: false,
    connectionState: "disconnected",
    channelStates: new Map(),
    templates: [],
    shows: [],
    songs: [],
    hotcards: [],
    channels: [],
    showCache: new Map(),
    songCache: new Map(),
    loadedShowId: null,
    loadedShowRowCursor: null,
    sttSpawner: null,
    sttListeners: [],
    lastError: null,
  };
}
