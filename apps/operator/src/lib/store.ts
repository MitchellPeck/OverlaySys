"use client";

import { create } from "zustand";
import type {
  ChannelState,
  ChannelConfig,
  ProjectChannelOverride,
  Show,
  Template,
  TemplateMeta,
  Song,
  SongMeta,
  SongSessionSummary,
  Hotcard,
  HotcardMeta,
  Project,
  SttSpawnerConfig,
  SttSpawnerStatus,
  SttPresence,
  SttModelFile,
  SttCaptureDevice,
  SttInstallProgress,
} from "@overlaysys/core";
import { DEFAULT_PROJECT_ID } from "@overlaysys/core";
import { getCurrentProjectId } from "./currentProject";

type ConnState = "connecting" | "open" | "closed";
export type ShowMeta = {
  id: string;
  name: string;
  projectId: string;
  rowCount: number;
};

export type SttMatchStrategy = "coverage" | "neighborhood" | "audible";

type SttMatchSummary = {
  sectionIdx: number;
  slideIdx: number;
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
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  showMetas: ShowMeta[];
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  channelStates: Record<string, ChannelState>;
  channelConfigs: ChannelConfig[];
  /**
   * Per-project channel overrides, keyed by `${projectId}:${channelId}`.
   * Flat dictionary so the UI can look up an override for the current
   * project + channel without scanning a list. Empty when no overrides
   * are loaded for the current project.
   */
  projectChannelOverrides: Record<string, ProjectChannelOverride>;

  songs: SongMeta[];
  songCache: Record<string, Song>;
  showCache: Record<string, Show>;
  songSessions: Record<string, SongSessionSummary | null>;
  sttMatches: Record<string, SttMatchSummary>;
  sttListeners: SttListenerInfo[];

  hotcards: HotcardMeta[];
  hotcardCache: Record<string, Hotcard>;

  projects: Project[];
  currentProjectId: string;
  setProjects: (p: Project[]) => void;
  setCurrentProjectId: (id: string) => void;

  setConn: (c: ConnState) => void;
  setTemplates: (t: TemplateMeta[]) => void;
  setTemplate: (t: Template) => void;
  setShowMetas: (s: ShowMeta[]) => void;
  setShow: (s: Show | null) => void;
  setSelectedRow: (id: string | null) => void;
  setSelectedHotcard: (id: string | null) => void;
  setChannelState: (s: ChannelState) => void;
  setChannelConfigs: (c: ChannelConfig[]) => void;
  setProjectChannelOverrides: (overrides: ProjectChannelOverride[]) => void;
  setProjectChannelOverride: (override: ProjectChannelOverride) => void;
  removeProjectChannelOverride: (projectId: string, channelId: string) => void;
  setSongs: (songs: SongMeta[]) => void;
  setSong: (song: Song) => void;
  setShowFull: (show: Show) => void;
  setSongSession: (channel: string, session: SongSessionSummary | null) => void;
  setSttMatch: (channel: string, match: SttMatchSummary) => void;
  setSttListeners: (listeners: SttListenerInfo[]) => void;
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
  // Progress entries keyed by jobId. "binary" for the whisper-cpp install,
  // filename (e.g. "ggml-base.en.bin") for model downloads. Updated in
  // place by the install_progress handler; cleared when the job ends so
  // the UI's progress card disappears on completion.
  sttInstallJobs: Record<string, SttInstallProgress>;
  setSttPresence: (p: SttPresence) => void;
  setSttModels: (models: SttModelFile[], modelsDir: string) => void;
  setSttCaptureDevices: (d: SttCaptureDevice[]) => void;
  setSttInstallProgress: (p: SttInstallProgress) => void;
  // Drop a job entry from the install-jobs map. The page schedules this on
  // a short timer after a terminal state ("done"/"error"/"cancelled") so the
  // success/failure message shows briefly and then the progress card
  // disappears instead of lingering until next page reload.
  clearSttInstallJob: (jobId: string) => void;
};

export const useStore = create<StoreState>((set) => ({
  conn: "connecting",
  templates: [],
  templateCache: {},
  showMetas: [],
  show: null,
  selectedRowId: null,
  selectedHotcardId: null,
  channelStates: {},
  channelConfigs: [],
  projectChannelOverrides: {},
  songs: [],
  songCache: {},
  showCache: {},
  songSessions: {},
  sttMatches: {},
  sttListeners: [],
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
  sttInstallJobs: {},

  setConn: (c) => set({ conn: c }),
  setTemplates: (t) => set({ templates: t }),
  setTemplate: (t) =>
    set((cur) => ({ templateCache: { ...cur.templateCache, [t.id]: t } })),
  setShowMetas: (s) => set({ showMetas: s }),
  setShow: (s) =>
    set((cur) => {
      const nextRowId =
        s && s.rows.length > 0
          ? cur.selectedRowId && s.rows.some((r) => r.id === cur.selectedRowId)
            ? cur.selectedRowId
            : s.rows[0]!.id
          : null;
      return {
        show: s,
        selectedRowId: nextRowId,
        // Auto-promoting a row to selected should clear any prior hotcard
        // selection so the mutually-exclusive contract holds.
        selectedHotcardId: nextRowId != null ? null : cur.selectedHotcardId,
      };
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
    })),
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
  setSong: (song) => set((s) => ({ songCache: { ...s.songCache, [song.id]: song } })),
  setShowFull: (show) =>
    set((s) => ({ showCache: { ...s.showCache, [show.id]: show } })),
  setSongSession: (channel, session) =>
    set((s) => ({ songSessions: { ...s.songSessions, [channel]: session } })),
  setSttMatch: (channel, match) =>
    set((s) => ({ sttMatches: { ...s.sttMatches, [channel]: match } })),
  setSttListeners: (listeners) => set({ sttListeners: listeners }),
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
