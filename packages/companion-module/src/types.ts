import type {
  ChannelState,
  ChannelConfig,
  Show,
  Song,
  SongMeta,
  Hotcard,
  HotcardMeta,
  TemplateMeta,
  SttSpawnerStatus,
  StageState,
  StageTimerInstance,
} from "@overlaysys/core";
import type { PcoLiveStateMessage } from "@overlaysys/ws-protocol";

/** Warn threshold for the item-timer variable and feedbacks. */
export const ITEM_WARN_MS = 60_000;

export interface ShowMeta {
  id: string;
  name: string;
  rowCount: number;
  scheduledFor?: string;
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
  hotcardCache: Map<string, Hotcard>;
  channels: ChannelConfig[];
  showCache: Map<string, Show>;
  songCache: Map<string, Song>;
  loadedShowId: string | null;
  loadedShowRowCursor: number | null;
  sttSpawner: SttSpawnerStatus | null;
  sttListeners: SttListener[];
  lastError: string | null;
  timers: StageTimerInstance[];
  pcoLive: PcoLiveStateMessage | null;
  stage: {
    state: StageState;
    pointCount: number;
    title: string | null;
    pointHeading: string | null;
    nextHeading: string | null;
  } | null;
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
    hotcardCache: new Map(),
    channels: [],
    showCache: new Map(),
    songCache: new Map(),
    loadedShowId: null,
    loadedShowRowCursor: null,
    sttSpawner: null,
    sttListeners: [],
    lastError: null,
    timers: [],
    pcoLive: null,
    stage: null,
  };
}
