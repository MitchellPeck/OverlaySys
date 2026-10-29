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
import type { MediaPlayback, StageLayoutMeta } from "@overlaysys/core";
import type { OutputsState, PcoLiveStateMessage } from "@overlaysys/ws-protocol";

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
  /** serverTime (from hello) minus local Date.now(); corrects clock skew for timers. */
  serverTimeOffsetMs: number;
  timers: StageTimerInstance[];
  pcoLive: PcoLiveStateMessage | null;
  stage: {
    state: StageState;
    pointCount: number;
    title: string | null;
    pointHeading: string | null;
    nextHeading: string | null;
  } | null;
  /** Connected renderer windows per channel; null until the server reports (or an older server). */
  outputs: OutputsState | null;
  /** Latest ~4 Hz playback tick per channel. */
  mediaPlayback: Map<string, { takenAt: number; playback: MediaPlayback }>;
  /** From hello; null for servers that don't send it. */
  serverVersion: string | null;
  /** Server's protocol major (hello), for the mismatch warning. */
  serverProtocolVersion: number | null;
  stt: {
    /** Confidence of the last suggestion (0–1); null before any. */
    confidence: number | null;
    lastHypothesis: string;
    /** Local time of the last stt_match. */
    lastMatchAt: number | null;
  };
  /** Local time a song session went live on any subscribed channel; null when none is live. */
  songLiveSince: number | null;
  // [P2b.34]
  /** Stage layouts, for the "Stage screen: set layout" choices. */
  stageLayouts: StageLayoutMeta[];
  /** Per stage channel: which layout is showing and why (stage_layout_status). */
  stageLayoutStatus: Map<string, { layoutId?: string; reason: string; manual: string | null }>;
  // [/P2b.34]
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
    serverTimeOffsetMs: 0,
    timers: [],
    pcoLive: null,
    stage: null,
    outputs: null,
    mediaPlayback: new Map(),
    serverVersion: null,
    serverProtocolVersion: null,
    stt: { confidence: null, lastHypothesis: "", lastMatchAt: null },
    songLiveSince: null,
    // [P2b.34]
    stageLayouts: [],
    stageLayoutStatus: new Map(),
    // [/P2b.34]
  };
}

/** Current time on the server's clock, as best we know it. */
export function serverNow(state: CompanionState): number {
  return Date.now() + state.serverTimeOffsetMs;
}
