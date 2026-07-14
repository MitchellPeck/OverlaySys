// Preload script — runs with access to Node + the BrowserWindow's
// `window` object. Exposes a typed, narrow `window.overlaysys` API to
// the operator React app via contextBridge. Anything not exposed here
// is unreachable from operator code (good — minimizes attack surface
// even though we only load localhost content).

import { contextBridge, ipcRenderer } from "electron";
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

interface CloudTokens {
  accessToken: string;
  refreshToken: string;
  registryOrgId: string | null;
  storedAt: number;
}

interface OverlaysysApi {
  /**
   * Open a renderer window for the given channel. If a window for that
   * channel already exists, focuses it instead of creating a duplicate.
   * Returns `{ reused: true }` if focused, `{ reused: false }` if newly
   * created.
   */
  openChannelWindow(channelId: string, opts?: ChannelWindowOptions): Promise<{ reused: boolean }>;

  /** Close the channel window for the given id (no-op if not open). */
  closeChannelWindow(channelId: string): Promise<void>;

  /** List the channel ids of currently-open channel windows. */
  listChannelWindows(): Promise<string[]>;

  /**
   * Toggle alwaysOnTop / fullscreen at runtime. `frameless` and `transparent`
   * can only be set at window open time; setting them here is a no-op
   * (returns false).
   */
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

  /** App mode + the URLs the host points at. */
  getMode(): Promise<{ isDev: boolean; operatorUrl: string; rendererUrl: string }>;

  /**
   * Subscribe to channel-window lifecycle events. Returns an unsubscribe
   * function. Useful for keeping operator UI state in sync with which
   * channels currently have open windows.
   */
  onChannelWindowOpened(fn: (channelId: string) => void): () => void;
  onChannelWindowClosed(fn: (channelId: string) => void): () => void;

  /**
   * Start the cloud sign-in flow: opens the system browser at
   * apps.mitchellpeck.com with a localhost-loopback return URL. Resolves
   * once the user finishes; rejects on timeout or on flow abort.
   */
  cloudSignIn(): Promise<
    | { ok: true; tokens: CloudTokens }
    | { ok: false; error: string }
  >;

  /** Read the persisted cloud session (null if not signed in). */
  cloudGetTokens(): Promise<CloudTokens | null>;

  /** Clear the stored cloud session. */
  cloudSignOut(): Promise<void>;

  /** Subscribe to the "tokens just arrived" event after a successful sign-in. */
  onCloudSignedIn(fn: (tokens: CloudTokens) => void): () => void;
  /** Subscribe to sign-out events. */
  onCloudSignedOut(fn: () => void): () => void;

  /**
   * Persist a refreshed token pair pushed up from the renderer. Called by
   * useAuth's onAuthStateChange when Supabase JS emits TOKEN_REFRESHED;
   * without this, desktop quit + relaunch after the access-token TTL
   * loses the session even though the refresh token is still valid.
   */
  cloudUpdateTokens(input: {
    accessToken: string;
    refreshToken: string;
    registryOrgId?: string | null;
  }): Promise<CloudTokens>;

  /**
   * Open a URL in the system browser via shell.openExternal. Used by
   * AccountMenu's "Manage account" so the cloud account page opens
   * outside the app rather than navigating in-renderer. Restricted to
   * http(s) URLs by the main-process handler.
   */
  openExternal(url: string): Promise<void>;
}

const api: OverlaysysApi = {
  openChannelWindow: (channelId, opts) =>
    ipcRenderer.invoke("overlaysys:open-channel-window", channelId, opts),
  closeChannelWindow: (channelId) =>
    ipcRenderer.invoke("overlaysys:close-channel-window", channelId),
  listChannelWindows: () =>
    ipcRenderer.invoke("overlaysys:list-channel-windows"),
  setChannelWindowOptions: (channelId, opts) =>
    ipcRenderer.invoke("overlaysys:set-channel-window-options", channelId, opts),
  getDisplays: () => ipcRenderer.invoke("overlaysys:get-displays"),
  getChannelWindowPrefs: () => ipcRenderer.invoke("overlaysys:get-channel-window-prefs"),
  setChannelWindowPrefs: (channelId, prefs) =>
    ipcRenderer.invoke("overlaysys:set-channel-window-prefs", channelId, prefs),
  getChannelWindowResolutions: () =>
    ipcRenderer.invoke("overlaysys:get-channel-window-resolutions"),
  reopenChannelOnConfiguredDisplay: (channelId) =>
    ipcRenderer.invoke("overlaysys:reopen-channel-on-configured-display", channelId),
  identifyDisplays: () => ipcRenderer.invoke("overlaysys:identify-displays"),
  getMode: () => ipcRenderer.invoke("overlaysys:get-mode"),
  onChannelWindowOpened: (fn) => {
    const handler = (_event: Electron.IpcRendererEvent, channelId: string) => fn(channelId);
    ipcRenderer.on("overlaysys:channel-window-opened", handler);
    return () => ipcRenderer.removeListener("overlaysys:channel-window-opened", handler);
  },
  onChannelWindowClosed: (fn) => {
    const handler = (_event: Electron.IpcRendererEvent, channelId: string) => fn(channelId);
    ipcRenderer.on("overlaysys:channel-window-closed", handler);
    return () => ipcRenderer.removeListener("overlaysys:channel-window-closed", handler);
  },

  cloudSignIn: () => ipcRenderer.invoke("overlaysys:cloud-sign-in"),
  cloudGetTokens: () => ipcRenderer.invoke("overlaysys:cloud-get-tokens"),
  cloudSignOut: () => ipcRenderer.invoke("overlaysys:cloud-sign-out"),
  onCloudSignedIn: (fn) => {
    const handler = (_event: Electron.IpcRendererEvent, tokens: CloudTokens) =>
      fn(tokens);
    ipcRenderer.on("overlaysys:cloud-signed-in", handler);
    return () => ipcRenderer.removeListener("overlaysys:cloud-signed-in", handler);
  },
  onCloudSignedOut: (fn) => {
    const handler = () => fn();
    ipcRenderer.on("overlaysys:cloud-signed-out", handler);
    return () => ipcRenderer.removeListener("overlaysys:cloud-signed-out", handler);
  },
  cloudUpdateTokens: (input) =>
    ipcRenderer.invoke("overlaysys:cloud-update-tokens", input),
  openExternal: (url) =>
    ipcRenderer.invoke("overlaysys:open-external", url),
};

contextBridge.exposeInMainWorld("overlaysys", api);
