// Preload script — runs with access to Node + the BrowserWindow's
// `window` object. Exposes a typed, narrow `window.overlaysys` API to
// the operator React app via contextBridge. Anything not exposed here
// is unreachable from operator code (good — minimizes attack surface
// even though we only load localhost content).

import { contextBridge, ipcRenderer } from "electron";

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
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

  /** App mode + the URLs the host points at. */
  getMode(): Promise<{ isDev: boolean; operatorUrl: string; rendererUrl: string }>;

  /**
   * Subscribe to channel-window lifecycle events. Returns an unsubscribe
   * function. Useful for keeping operator UI state in sync with which
   * channels currently have open windows.
   */
  onChannelWindowOpened(fn: (channelId: string) => void): () => void;
  onChannelWindowClosed(fn: (channelId: string) => void): () => void;
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
};

contextBridge.exposeInMainWorld("overlaysys", api);
