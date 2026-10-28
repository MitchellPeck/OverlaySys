"use client";

import { create } from "zustand";
import type {
  StageTimerInstance,
  StageLayoutMeta,
  ChannelState,
  MediaPlayback,
  ChannelConfig,
  ProjectChannelOverride,
  Show,
  Template,
  TemplateMeta,
  Song,
  SongMeta,
  Deck,
  DeckMeta,
  SongSessionSummary,
  Hotcard,
  HotcardMeta,
  Project,
  SttSpawnerConfig,
  SttSpawnerStatus,
  SttPresence,
  SttModelFile,
  SttCaptureDevice,
  SttInputDevice,
  SttInstallProgress,
} from "@overlaysys/core";
import type { PcoLiveStateMessage, ServerMessage } from "@overlaysys/ws-protocol";
import { DEFAULT_PROJECT_ID } from "@overlaysys/core";
import { getCurrentProjectId } from "./currentProject";
import { requestedDecks } from "./deckRequests";

export type StageStateMessage = Extract<ServerMessage, { type: "stage_state" }>;
type ConnState = "connecting" | "open" | "closed";
export type ShowMeta = {
  id: string;
  name: string;
  projectId: string;
  rowCount: number;
  scheduledFor?: string;
  updatedAt?: string;
  totalLengthSec?: number;
};

export type SttMatchStrategy = "coverage" | "neighborhood" | "audible";

type SttMatchSummary = {
  // Null when the server heard something but it matched no slide. The
  // hypothesis is still kept so the operator can see what STT is hearing.
  suggestedSlide: { sectionIdx: number; slideIdx: number } | null;
  confidence: number;
  hypothesis: string;
  strategy: SttMatchStrategy | null;
  matchedTokens: string[];
  coverage: number;
  latencyMs: number;
  isFinal: boolean;
} | null;

type SttListenerInfo = {
  audioSourceId: string;
  label?: string;
  online: boolean;
  lastSeen: number;
};

type StoreState = {
  conn: ConnState;
  /** serverTime (from hello) minus local Date.now(); add to Date.now() for server-clock time. */
  serverTimeOffsetMs: number;
  templates: TemplateMeta[];
  // [P1.10] true once setTemplates has run (an empty list is then "loaded")
  templatesLoaded: boolean;
  // [/P1.10]
  templateCache: Record<string, Template>;
  showMetas: ShowMeta[];
  show: Show | null;
  /**
   * Show the operator explicitly asked to switch to (Show picker). A `show`
   * broadcast for a different id than the loaded one is only adopted when it
   * matches this; any other broadcast is someone else's save.
   */
  requestedShowId: string | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  /** Session-only field edits for graphic rows (rowId → key → value). Cleared when a different show loads. */
  rowDataOverrides: Record<string, Record<string, string>>;
  /** Set one field's session edit; removes it when it matches the row's saved value. */
  setRowFieldOverride: (rowId: string, key: string, value: string, original: string | undefined) => void;
  clearRowOverrides: (rowId: string) => void;
  channelStates: Record<string, ChannelState>;
  /** Local ms when each channel's media playback was last heard (for interpolation / staleness). */
  mediaHeardAt: Record<string, number>;
  applyMediaPlayback: (channel: string, takenAt: number, playback: MediaPlayback) => void;
  channelConfigs: ChannelConfig[];
  /**
   * Per-project channel overrides, keyed by `${projectId}:${channelId}`.
   * Flat dictionary so the UI can look up an override for the current
   * project + channel without scanning a list. Empty when no overrides
   * are loaded for the current project.
   */
  projectChannelOverrides: Record<string, ProjectChannelOverride>;

  // [P3.13]
  decks: DeckMeta[];
  deckCache: Record<string, Deck>;
  lastSongConversion: Extract<ServerMessage, { type: "song_converted" }> | null;
  /** Deck ids the server answered get_deck for with not_found. */
  deckNotFound: Record<string, true>;
  /** Bumped on reconnect so useDeck re-asks for decks whose get_deck was lost. */
  deckEpoch: number;
  // [/P3.13]
  songs: SongMeta[];
  songCache: Record<string, Song>;
  showCache: Record<string, Show>;
  songSessions: Record<string, SongSessionSummary | null>;
  sttMatches: Record<string, SttMatchSummary>;
  sttListeners: SttListenerInfo[];

  stageState: StageStateMessage | null;
  stageTimers: StageTimerInstance[];
  stageLayouts: StageLayoutMeta[];
  /** Server-held preview-on-monitor overrides, one per stage channel. */
  stageLayoutPreviews: { channel: string; layoutId: string }[];
  pcoLive: PcoLiveStateMessage | null;
  /** Why the last pco_live_start was refused; cleared on toggle or once sync is enabled. */
  pcoLiveStartError: string | null;
  hotcards: HotcardMeta[];
  hotcardCache: Record<string, Hotcard>;

  projects: Project[];
  currentProjectId: string;
  setProjects: (p: Project[]) => void;
  setCurrentProjectId: (id: string) => void;

  setConn: (c: ConnState) => void;
  setServerTimeOffset: (ms: number) => void;
  setTemplates: (t: TemplateMeta[]) => void;
  setTemplate: (t: Template) => void;
  setShowMetas: (s: ShowMeta[]) => void;
  setShow: (s: Show | null) => void;
  setRequestedShowId: (id: string | null) => void;
  /** Adopt a broadcast show if it is the loaded show or the requested one. Returns whether it was adopted. */
  adoptRequestedShow: (s: Show) => boolean;
  setSelectedRow: (id: string | null) => void;
  setSelectedHotcard: (id: string | null) => void;
  setChannelState: (s: ChannelState) => void;
  setChannelConfigs: (c: ChannelConfig[]) => void;
  setProjectChannelOverrides: (overrides: ProjectChannelOverride[]) => void;
  setProjectChannelOverride: (override: ProjectChannelOverride) => void;
  removeProjectChannelOverride: (projectId: string, channelId: string) => void;
  setSongs: (songs: SongMeta[]) => void;
  // [P3.13]
  setDecks: (d: DeckMeta[]) => void;
  upsertDeck: (d: Deck) => void;
  setLastSongConversion: (m: Extract<ServerMessage, { type: "song_converted" }> | null) => void;
  markDeckNotFound: (id: string) => void;
  resetDeckLookups: () => void;
  // [/P3.13]
  setSong: (song: Song) => void;
  setShowFull: (show: Show) => void;
  setSongSession: (channel: string, session: SongSessionSummary | null) => void;
  setSttMatch: (channel: string, match: SttMatchSummary) => void;
  setSttListeners: (listeners: SttListenerInfo[]) => void;
  setStageState: (m: StageStateMessage | null) => void;
  setStageTimers: (t: StageTimerInstance[]) => void;
  setStageLayouts: (l: StageLayoutMeta[]) => void;
  setStageLayoutPreviews: (p: { channel: string; layoutId: string }[]) => void;
  setPcoLive: (m: PcoLiveStateMessage | null) => void;
  setPcoLiveStartError: (e: string | null) => void;
  setHotcards: (h: HotcardMeta[]) => void;
  setHotcard: (h: Hotcard) => void;

  sttSpawnerStatus: SttSpawnerStatus | null;
  sttSpawnerConfig: SttSpawnerConfig | null;
  setSttSpawnerStatus: (s: SttSpawnerStatus) => void;
  setSttSpawnerConfig: (c: SttSpawnerConfig) => void;

  sttPresence: SttPresence | null;
  sttModels: SttModelFile[];
  sttModelsDir: string | null;
  sttCaptureDevices: SttCaptureDevice[];
  // macOS input devices with channel counts (channel select); null when the
  // server didn't send any (other platforms / not yet enumerated).
  sttInputDevices: SttInputDevice[] | null;
  // Channel-select meter: latest peak per channel of the RUNNING capture,
  // labelled by `channels`; both empty when stopped or disconnected.
  sttLevels: { levels: number[]; channels: number[] };
  // Progress entries keyed by jobId. "binary" for the whisper-cpp install,
  // filename (e.g. "ggml-base.en.bin") for model downloads. Updated in
  // place by the install_progress handler; cleared when the job ends so
  // the UI's progress card disappears on completion.
  sttInstallJobs: Record<string, SttInstallProgress>;
  setSttPresence: (p: SttPresence) => void;
  setSttModels: (models: SttModelFile[], modelsDir: string) => void;
  setSttCaptureDevices: (d: SttCaptureDevice[]) => void;
  setSttInputDevices: (d: SttInputDevice[] | null) => void;
  setSttLevels: (levels: { levels: number[]; channels: number[] }) => void;
  setSttInstallProgress: (p: SttInstallProgress) => void;
  // Drop a job entry from the install-jobs map. The page schedules this on
  // a short timer after a terminal state ("done"/"error"/"cancelled") so the
  // success/failure message shows briefly and then the progress card
  // disappears instead of lingering until next page reload.
  clearSttInstallJob: (jobId: string) => void;
};

function pruneOverrides(
  overrides: Record<string, Record<string, string>>,
  show: Show,
): Record<string, Record<string, string>> {
  const ids = new Set(show.rows.map((r) => r.id));
  const stale = Object.keys(overrides).filter((id) => !ids.has(id));
  if (stale.length === 0) return overrides;
  const next = { ...overrides };
  for (const id of stale) delete next[id];
  return next;
}

export const useStore = create<StoreState>((set) => ({
  conn: "connecting",
  serverTimeOffsetMs: 0,
  templates: [],
  templatesLoaded: false, // [P1.10]
  templateCache: {},
  showMetas: [],
  show: null,
  requestedShowId: null,
  selectedRowId: null,
  selectedHotcardId: null,
  rowDataOverrides: {},
  channelStates: {},
  mediaHeardAt: {},
  channelConfigs: [],
  projectChannelOverrides: {},
  // [P3.13]
  decks: [],
  deckCache: {},
  lastSongConversion: null,
  deckNotFound: {},
  deckEpoch: 0,
  // [/P3.13]
  songs: [],
  songCache: {},
  showCache: {},
  songSessions: {},
  sttMatches: {},
  sttListeners: [],
  stageState: null,
  stageTimers: [],
  stageLayouts: [],
  stageLayoutPreviews: [],
  pcoLive: null,
  pcoLiveStartError: null,
  hotcards: [],
  hotcardCache: {},
  projects: [],
  // Read from sessionStorage at store-init so a page reload keeps the
  // operator's previously-selected project. Falls back to the seeded default.
  currentProjectId:
    typeof window === "undefined" ? DEFAULT_PROJECT_ID : getCurrentProjectId(),
  sttSpawnerStatus: null,
  sttSpawnerConfig: null,
  sttPresence: null,
  sttModels: [],
  sttModelsDir: null,
  sttCaptureDevices: [],
  sttInputDevices: null,
  sttLevels: { levels: [], channels: [] },
  sttInstallJobs: {},

  // A meter reading from before a disconnect is stale; drop it.
  setServerTimeOffset: (ms) => set({ serverTimeOffsetMs: ms }),
  setConn: (c) =>
    set(c === "open" ? { conn: c } : { conn: c, sttLevels: { levels: [], channels: [] } }),
  setTemplates: (t) => set({ templates: t, templatesLoaded: true }), // [P1.10]
  setTemplate: (t) =>
    set((cur) => ({ templateCache: { ...cur.templateCache, [t.id]: t } })),
  setShowMetas: (s) => set({ showMetas: s }),
  setShow: (s) =>
    set((cur) => {
      // A selected hotcard survives a show (re-)broadcast: auto-selecting row 1
      // here would make the next Space take row 1 instead of the hotcard.
      const keepHotcard = cur.selectedHotcardId != null;
      const nextRowId =
        keepHotcard
          ? null
          : s && s.rows.length > 0
          ? cur.selectedRowId && s.rows.some((r) => r.id === cur.selectedRowId)
            ? cur.selectedRowId
            : s.rows[0]!.id
          : null;
      return {
        show: s,
        requestedShowId: s && cur.requestedShowId === s.id ? null : cur.requestedShowId,
        selectedRowId: nextRowId,
        selectedHotcardId: keepHotcard ? cur.selectedHotcardId : null,
        // Edits belong to one show; a re-broadcast of the same show keeps them.
        // Edits for rows no longer in the show are dropped.
        rowDataOverrides: s && cur.show && s.id === cur.show.id ? pruneOverrides(cur.rowDataOverrides, s) : {},
      };
    }),
  setRequestedShowId: (id) => set({ requestedShowId: id }),
  adoptRequestedShow: (s) => {
    const cur = useStore.getState();
    if (cur.show?.id === s.id || cur.requestedShowId !== s.id) return false;
    cur.setShow(s);
    return true;
  },
  setRowFieldOverride: (rowId, key, value, original) =>
    set((cur) => {
      const row = { ...cur.rowDataOverrides[rowId] };
      // An empty value over a missing original is no edit either.
      if (value === (original ?? "")) delete row[key];
      else row[key] = value;
      const next = { ...cur.rowDataOverrides };
      if (Object.keys(row).length === 0) delete next[rowId];
      else next[rowId] = row;
      return { rowDataOverrides: next };
    }),
  clearRowOverrides: (rowId) =>
    set((cur) => {
      if (!(rowId in cur.rowDataOverrides)) return {};
      const next = { ...cur.rowDataOverrides };
      delete next[rowId];
      return { rowDataOverrides: next };
    }),
  setSelectedRow: (id) =>
    set((s) => ({
      selectedRowId: id,
      selectedHotcardId: id != null ? null : s.selectedHotcardId,
    })),
  setSelectedHotcard: (id) =>
    set((s) => ({
      selectedHotcardId: id,
      selectedRowId: id != null ? null : s.selectedRowId,
    })),
  setChannelState: (s) =>
    set((cur) => ({
      channelStates: { ...cur.channelStates, [s.channel]: s },
      // Only a new take or a new renderer report (playback.updatedAt changed)
      // counts as "heard". Control re-broadcasts reuse the old updatedAt and
      // must not mask a dead renderer.
      mediaHeardAt: (() => {
        const prev = cur.channelStates[s.channel]?.media;
        const fresh =
          !!s.media &&
          (!prev ||
            prev.takenAt !== s.media.takenAt ||
            prev.playback.updatedAt !== s.media.playback.updatedAt);
        return fresh ? { ...cur.mediaHeardAt, [s.channel]: Date.now() } : cur.mediaHeardAt;
      })(),
    })),
  applyMediaPlayback: (channel, takenAt, playback) =>
    set((cur) => {
      const st = cur.channelStates[channel];
      if (!st?.media || st.media.takenAt !== takenAt) return {};
      return {
        channelStates: { ...cur.channelStates, [channel]: { ...st, media: { ...st.media, playback } } },
        mediaHeardAt: { ...cur.mediaHeardAt, [channel]: Date.now() },
      };
    }),
  setChannelConfigs: (c) => set({ channelConfigs: c }),
  setProjectChannelOverrides: (overrides) =>
    set(() => {
      const dict: Record<string, ProjectChannelOverride> = {};
      for (const o of overrides) {
        dict[`${o.projectId}:${o.channelId}`] = o;
      }
      return { projectChannelOverrides: dict };
    }),
  setProjectChannelOverride: (override) =>
    set((s) => ({
      projectChannelOverrides: {
        ...s.projectChannelOverrides,
        [`${override.projectId}:${override.channelId}`]: override,
      },
    })),
  removeProjectChannelOverride: (projectId, channelId) =>
    set((s) => {
      const key = `${projectId}:${channelId}`;
      if (!(key in s.projectChannelOverrides)) return s;
      const next = { ...s.projectChannelOverrides };
      delete next[key];
      return { projectChannelOverrides: next };
    }),
  setSongs: (songs) => set({ songs }),
  // [P3.13]
  setDecks: (decks) => set({ decks }),
  upsertDeck: (d) =>
    set((s) => {
      const { [d.id]: _gone, ...deckNotFound } = s.deckNotFound;
      return { deckCache: { ...s.deckCache, [d.id]: d }, deckNotFound };
    }),
  markDeckNotFound: (id) => {
    requestedDecks.delete(id);
    set((s) => ({ deckNotFound: { ...s.deckNotFound, [id]: true } }));
  },
  resetDeckLookups: () => {
    requestedDecks.clear();
    set((s) => ({ deckNotFound: {}, deckEpoch: s.deckEpoch + 1 }));
  },
  setLastSongConversion: (m) => set({ lastSongConversion: m }),
  // [/P3.13]
  setSong: (song) => set((s) => ({ songCache: { ...s.songCache, [song.id]: song } })),
  setShowFull: (show) =>
    set((s) => ({ showCache: { ...s.showCache, [show.id]: show } })),
  setSongSession: (channel, session) =>
    set((s) => ({ songSessions: { ...s.songSessions, [channel]: session } })),
  setSttMatch: (channel, match) =>
    set((s) => ({ sttMatches: { ...s.sttMatches, [channel]: match } })),
  setSttListeners: (listeners) => set({ sttListeners: listeners }),
  setStageState: (m) => set({ stageState: m }),
  setStageTimers: (t) => set({ stageTimers: t }),
  setStageLayouts: (l) => set({ stageLayouts: l }),
  setStageLayoutPreviews: (p) => set({ stageLayoutPreviews: p }),
  setPcoLive: (m) => set((s) => ({ pcoLive: m, pcoLiveStartError: m?.enabled ? null : s.pcoLiveStartError })),
  setPcoLiveStartError: (e) => set({ pcoLiveStartError: e }),
  setHotcards: (h) => set({ hotcards: h }),
  setHotcard: (h) =>
    set((s) => ({ hotcardCache: { ...s.hotcardCache, [h.id]: h } })),
  setProjects: (p) => set({ projects: p }),
  setCurrentProjectId: (id) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("overlaysys:current-project", id);
    }
    set({ currentProjectId: id });
  },
  setSttSpawnerStatus: (s) => set({ sttSpawnerStatus: s }),
  setSttSpawnerConfig: (c) => set({ sttSpawnerConfig: c }),
  setSttPresence: (p) => set({ sttPresence: p }),
  setSttModels: (models, modelsDir) => set({ sttModels: models, sttModelsDir: modelsDir }),
  setSttCaptureDevices: (d) => set({ sttCaptureDevices: d }),
  setSttInputDevices: (d) => set({ sttInputDevices: d }),
  setSttLevels: (levels) => set({ sttLevels: levels }),
  setSttInstallProgress: (p) =>
    set((cur) => ({
      sttInstallJobs: { ...cur.sttInstallJobs, [p.jobId]: p },
    })),
  clearSttInstallJob: (jobId) =>
    set((cur) => {
      if (!(jobId in cur.sttInstallJobs)) return cur;
      const next = { ...cur.sttInstallJobs };
      delete next[jobId];
      return { sttInstallJobs: next };
    }),
}));
