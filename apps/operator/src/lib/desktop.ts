"use client";

// Bridge to the Electron host's preload-exposed API. When the operator
// is running in a regular browser (no Electron), `window.overlaysys` is
// undefined and helpers below are no-ops. When in Electron, IPC calls
// flow through to the main process.

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
}

export interface ElectronCloudTokens {
  accessToken: string;
  refreshToken: string;
  registryOrgId: string | null;
  storedAt: number;
}

interface OverlaysysApi {
  openChannelWindow(channelId: string, opts?: ChannelWindowOptions): Promise<{ reused: boolean }>;
  closeChannelWindow(channelId: string): Promise<void>;
  listChannelWindows(): Promise<string[]>;
  setChannelWindowOptions(channelId: string, opts: ChannelWindowOptions): Promise<boolean>;
  getMode(): Promise<{ isDev: boolean; operatorUrl: string; rendererUrl: string }>;
  onChannelWindowOpened(fn: (channelId: string) => void): () => void;
  onChannelWindowClosed(fn: (channelId: string) => void): () => void;

  cloudSignIn(): Promise<
    | { ok: true; tokens: ElectronCloudTokens }
    | { ok: false; error: string }
  >;
  cloudGetTokens(): Promise<ElectronCloudTokens | null>;
  cloudSignOut(): Promise<void>;
  onCloudSignedIn(fn: (tokens: ElectronCloudTokens) => void): () => void;
  onCloudSignedOut(fn: () => void): () => void;
}

declare global {
  interface Window {
    overlaysys?: OverlaysysApi;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.overlaysys;
}

export function getDesktopApi(): OverlaysysApi | null {
  if (typeof window === "undefined") return null;
  return window.overlaysys ?? null;
}
