"use client";

import { create } from "zustand";
import type {
  ChannelState,
  ChannelConfig,
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
}));
