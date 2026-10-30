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
  MediaItem,
  MediaItemMeta,
  LiveFolderFile,
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

const sortMedia = (items: MediaItemMeta[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

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
  // [P3.14] true once the first deck list has arrived
  decksLoaded: boolean;
  /** Media library entries (files and live folders), sorted by name. */
  mediaItems: MediaItemMeta[];
  /** Last listing of each live folder, by folder id. */
  liveFolderFiles: Record<string, { files: LiveFolderFile[]; configured: boolean }>;
  // [/P3.14]
  songs: SongMeta[];
  // [P1.13] true once the first song list has arrived
  songsLoaded: boolean;
  // [P2b.29] true once each list has been received (an empty list is then "loaded")
  projectsLoaded: boolean;
  hotcardsLoaded: boolean;
  // [/P2b.29]
  // [/P1.13]
  // [P1.12] true once the first show list has arrived
  showsLoaded: boolean;
  // [/P1.12]
  songCache: Record<string, Song>;
  showCache: Record<string, Show>;
  songSessions: Record<string, SongSessionSummary | null>;
  sttMatches: Record<string, SttMatchSummary>;
  sttListeners: SttListenerInfo[];

  stageState: StageStateMessage | null;
  stageTimers: StageTimerInstance[];
  stageLayouts: StageLayoutMeta[];
  stageLayoutsLoaded: boolean; // [P1.14]
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
  /**
   * Ask for `id` as the Live show only if Live has none loaded (after a PCO
   * import); never replaces a loaded show. Returns whether it asked.
   */
  requestShowIfNoneLoaded: (id: string) => boolean;
  /** Adopt a broadcast show if it is the loaded show or the requested one. Returns whether it was adopted. */
  adoptRequestedShow: (s: Show) => boolean;
  /**
   * Apply a `show` message from the server: it updates the loaded show, or
   * becomes the Live show only if Live asked for it (requestedShowId). Shows
   * fetched for exports, editors or other consoles' saves are ignored.
   */
  receiveShow: (s: Show) => void;
  setSelectedRow: (id: string | null) => void;
  setSelectedHotcard: (id: string | null) => void;
  setChannelState: (s: ChannelState) => void;
  setChannelConfigs: (c: ChannelConfig[]) => void;
  setProjectChannelOverrides: (overrides: ProjectChannelOverride[]) => void;
  setProjectChannelOverride: (override: ProjectChannelOverride) => void;
  removeProjectChannelOverride: (projectId: string, channelId: string) => void;
  setSongs: (songs: SongMeta[]) => void;
  // [P3.13]
  setMediaItems: (items: MediaItemMeta[]) => void;
  /** A bare item (media_item reply) keeps its known usedBy count. */
  upsertMediaItem: (item: MediaItem | MediaItemMeta) => void;
  setLiveFolderFiles: (id: string, files: LiveFolderFile[], configured: boolean) => void;
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

/**
 * When a channel's liveRow moves to a different row of the open show (a take
 * from Companion, another operator, or this one), select that row. liveRow
 * only changes on a sourced take, so song/slide/scripture advances, hotcards
 * and clears leave the selection alone. Preview cues don't count as on air,
 * and the first state heard for a channel (app load) never moves it.
 */
function followTakenRow(
  cur: Pick<StoreState, "channelStates" | "show">,
  s: ChannelState,
): Partial<Pick<StoreState, "selectedRowId" | "selectedHotcardId">> {
  if (s.channel === "preview" || !s.liveRow || !cur.show) return {};
  const prev = cur.channelStates[s.channel];
  if (!prev) return {};
  const lr = s.liveRow;
  if (prev.liveRow?.showId === lr.showId && prev.liveRow.rowId === lr.rowId) return {};
  if (lr.showId !== cur.show.id || !cur.show.rows.some((r) => r.id === lr.rowId)) return {};
  return { selectedRowId: lr.rowId, selectedHotcardId: null };
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
  decksLoaded: false, // [P3.14]
  mediaItems: [],
  liveFolderFiles: {},
  songs: [],
  songsLoaded: false, // [P1.13]
  showsLoaded: false, // [P1.12]
  projectsLoaded: false, // [P2b.29]
  hotcardsLoaded: false, // [P2b.29]
  songCache: {},
  showCache: {},
  songSessions: {},
  sttMatches: {},
  sttListeners: [],
  stageState: null,
  stageTimers: [],
  stageLayouts: [],
  stageLayoutsLoaded: false, // [P1.14]
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
  setShowMetas: (s) => set({ showMetas: s, showsLoaded: true }), // [P1.12] [P2b.29]
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
  requestShowIfNoneLoaded: (id) => {
    if (useStore.getState().show) return false;
    set({ requestedShowId: id });
    return true;
  },
  adoptRequestedShow: (s) => {
    const cur = useStore.getState();
    if (cur.show?.id === s.id || cur.requestedShowId !== s.id) return false;
    cur.setShow(s);
    return true;
  },
  receiveShow: (s) => {
    const cur = useStore.getState();
    if (cur.show?.id === s.id) cur.setShow(s);
    else cur.adoptRequestedShow(s);
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
  // A row taken from anywhere (Companion, another operator) moves the
  // selection to it; see followTakenRow.
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
      ...followTakenRow(cur, s),
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
  setSongs: (songs) => set({ songs, songsLoaded: true }), // [P1.13]
  // [P3.13]
  setMediaItems: (items) => set({ mediaItems: sortMedia(items) }),
  upsertMediaItem: (item) =>
    set((s) => {
      const prev = s.mediaItems.find((m) => m.id === item.id);
      const usedBy = "usedBy" in item && typeof item.usedBy === "number" ? item.usedBy : (prev?.usedBy ?? 0);
      return { mediaItems: sortMedia([...s.mediaItems.filter((m) => m.id !== item.id), { ...item, usedBy }]) };
    }),
  setLiveFolderFiles: (id, files, configured) =>
    set((s) => ({ liveFolderFiles: { ...s.liveFolderFiles, [id]: { files, configured } } })),
  setDecks: (decks) =>
    set((s) => {
      // A cached deck that fell out of the list was deleted (the server sends only the list):
      // drop it and mark it missing so Live shows "Missing deck" at once. A restore sends the
      // deck itself, and upsertDeck clears the mark.
      const listed = new Set(decks.map((d) => d.id));
      const gone = Object.keys(s.deckCache).filter((id) => !listed.has(id));
      const deckNotFound = { ...s.deckNotFound };
      // Listed again (restored elsewhere): no longer missing; the next lookup fetches it.
      for (const id of listed) delete deckNotFound[id];
      if (gone.length === 0) return { decks, decksLoaded: true, deckNotFound }; // [P3.14] decksLoaded
      const deckCache = { ...s.deckCache };
      for (const id of gone) {
        delete deckCache[id];
        deckNotFound[id] = true;
        requestedDecks.delete(id);
      }
      return { decks, decksLoaded: true, deckCache, deckNotFound };
    }),
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
  setStageLayouts: (l) => set({ stageLayouts: l, stageLayoutsLoaded: true }), // [P1.14]
  setStageLayoutPreviews: (p) => set({ stageLayoutPreviews: p }),
  setPcoLive: (m) => set((s) => ({ pcoLive: m, pcoLiveStartError: m?.enabled ? null : s.pcoLiveStartError })),
  setPcoLiveStartError: (e) => set({ pcoLiveStartError: e }),
  setHotcards: (h) => set({ hotcards: h, hotcardsLoaded: true }), // [P2b.29]
  setHotcard: (h) =>
    set((s) => ({ hotcardCache: { ...s.hotcardCache, [h.id]: h } })),
  setProjects: (p) => set({ projects: p, projectsLoaded: true }), // [P2b.29]
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
