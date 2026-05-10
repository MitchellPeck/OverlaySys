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
  SttSpawnerConfig,
  SttSpawnerStatus,
} from "@overlaysys/core";

type ConnState = "connecting" | "open" | "closed";
export type ShowMeta = { id: string; name: string; rowCount: number };

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
  channelStates: Record<string, ChannelState>;
  channelConfigs: ChannelConfig[];

  songs: SongMeta[];
  songCache: Record<string, Song>;
  showCache: Record<string, Show>;
  songSessions: Record<string, SongSessionSummary | null>;
  sttMatches: Record<string, SttMatchSummary>;
  sttListeners: SttListenerInfo[];

  setConn: (c: ConnState) => void;
  setTemplates: (t: TemplateMeta[]) => void;
  setTemplate: (t: Template) => void;
  setShowMetas: (s: ShowMeta[]) => void;
  setShow: (s: Show | null) => void;
  setSelectedRow: (id: string | null) => void;
  setChannelState: (s: ChannelState) => void;
  setChannelConfigs: (c: ChannelConfig[]) => void;
  setSongs: (songs: SongMeta[]) => void;
  setSong: (song: Song) => void;
  setShowFull: (show: Show) => void;
  setSongSession: (channel: string, session: SongSessionSummary | null) => void;
  setSttMatch: (channel: string, match: SttMatchSummary) => void;
  setSttListeners: (listeners: SttListenerInfo[]) => void;

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
  channelStates: {},
  channelConfigs: [],
  songs: [],
  songCache: {},
  showCache: {},
  songSessions: {},
  sttMatches: {},
  sttListeners: [],
  sttSpawnerStatus: null,
  sttSpawnerConfig: null,

  setConn: (c) => set({ conn: c }),
  setTemplates: (t) => set({ templates: t }),
  setTemplate: (t) =>
    set((cur) => ({ templateCache: { ...cur.templateCache, [t.id]: t } })),
  setShowMetas: (s) => set({ showMetas: s }),
  setShow: (s) =>
    set((cur) => ({
      show: s,
      selectedRowId:
        s && s.rows.length > 0
          ? cur.selectedRowId && s.rows.some((r) => r.id === cur.selectedRowId)
            ? cur.selectedRowId
            : s.rows[0]!.id
          : null,
    })),
  setSelectedRow: (id) => set({ selectedRowId: id }),
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
  setSttSpawnerStatus: (s) => set({ sttSpawnerStatus: s }),
  setSttSpawnerConfig: (c) => set({ sttSpawnerConfig: c }),
}));
