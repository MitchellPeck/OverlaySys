"use client";

// Bridge to the Electron host's preload-exposed API. When the operator
// is running in a regular browser (no Electron), `window.overlaysys` is
// undefined and helpers below are no-ops. When in Electron, IPC calls
// flow through to the main process.

import type {
  ChannelWindowPrefs,
  WindowPrefsFile,
  CachedDisplay,
} from "@overlaysys/core";

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
  displayId?: number;
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
  /** List of currently-attached displays for the picker UI. */
  getDisplays(): Promise<CachedDisplay[]>;

  /** Current persisted prefs file. */
  getChannelWindowPrefs(): Promise<WindowPrefsFile>;

  /** Merge-and-persist the prefs for one channel. Returns the new file. */
  setChannelWindowPrefs(
    channelId: string,
    prefs: ChannelWindowPrefs,
  ): Promise<WindowPrefsFile>;

  /** In-memory resolution info per open channel (id → result). */
  getChannelWindowResolutions(): Promise<
    Record<string, {
      matchedBy: "id" | "label" | "bounds" | "fallback";
      configuredLabel: string | null;
      actualLabel: string;
      actualDisplayId: number;
    }>
  >;

  /** Close (if open) and recreate the channel window on its configured display. */
  reopenChannelOnConfiguredDisplay(channelId: string): Promise<{ reused: boolean; reason?: "no-prefs" }>;

  /** Briefly flash a large number on every attached display. */
  identifyDisplays(): Promise<void>;

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

  /**
   * Open a URL in the system browser via Electron's `shell.openExternal`.
   * Used by the AccountMenu's "Manage account" item to surface the cloud
   * account page outside the app rather than navigating in-renderer.
   *
   * Optional because older Electron main builds don't expose this IPC yet
   * — callers should fall back to `window.open(url, "_blank")` when
   * absent.
   */
  openExternal?(url: string): Promise<void>;

  /**
   * Persist a refreshed token pair to safeStorage. Called by useAuth's
   * onAuthStateChange when Supabase JS auto-refreshes the access token in-
   * memory; without this, desktop quit + relaunch after the access-token
   * TTL loses the session despite a valid refresh token. Optional because
   * older builds don't expose the IPC handler — the absence is logged but
   * doesn't break the running session.
   */
  cloudUpdateTokens?(input: {
    accessToken: string;
    refreshToken: string;
    registryOrgId?: string | null;
  }): Promise<ElectronCloudTokens>;

  /**
   * Planning Center sign-in (OAuth). Optional — only present in desktop
   * builds that ship the PCO integration. The operator falls back to a
   * "desktop required" message when absent.
   */
  pcoSignIn?(): Promise<{ ok: true } | { ok: false; error: string }>;
  pcoGetStatus?(): Promise<{ connected: boolean }>;
  pcoSignOut?(): Promise<void>;
  onPcoSignedIn?(fn: () => void): () => void;
  onPcoSignedOut?(fn: () => void): () => void;
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
