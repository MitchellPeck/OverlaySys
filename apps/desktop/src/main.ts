// OverlaySys Electron host.
//
// Runs the operator UI as the main BrowserWindow and lets the operator
// pop open additional BrowserWindows for individual channels (each
// loading the renderer URL with ?channel=<id>). Channel windows can be
// frameless / always-on-top / transparent for in-house projection.
//
// Dev mode (default): expects `pnpm dev` to already be running so the
// operator and renderer URLs are reachable on localhost. Set via env
// vars OPERATOR_URL and RENDERER_URL (with sensible defaults).
//
// Production mode (TODO): Electron main spawns the Fastify server as a
// child process, sets OVERLAYSYS_DATA_DIR to userData, and serves the
// statically-exported operator + renderer from packaged resources.
//
// IPC channels exposed to the operator (via preload.ts):
//   overlaysys.openChannelWindow(channelId)  → open or focus a window
//   overlaysys.closeChannelWindow(channelId) → close a specific window
//   overlaysys.listChannelWindows()          → array of open channel ids
//   overlaysys.setChannelWindowOptions(id, opts)
//                                            → toggle frameless / always-
//                                              on-top / fullscreen at runtime

import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";

const isDev = process.env["OVERLAYSYS_DESKTOP_DEV"] === "1";
const OPERATOR_URL = process.env["OPERATOR_URL"] ?? "http://localhost:3000";
const RENDERER_URL = process.env["RENDERER_URL"] ?? "http://localhost:3001";

let operatorWindow: BrowserWindow | null = null;
const channelWindows = new Map<string, BrowserWindow>();

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
}

function createOperatorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    title: "OverlaySys",
    backgroundColor: "#0c0d10",
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(OPERATOR_URL);

  // Open external links in the system browser, not inside Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(OPERATOR_URL) || url.startsWith(RENDERER_URL)) {
      // Internal app links — let them open in new BrowserWindows
      // (e.g., a manually-typed renderer URL).
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    operatorWindow = null;
    // Closing the operator window closes the whole app on macOS too —
    // the user can re-open via the dock if they want it back, but in
    // practice if the operator is gone there's no point keeping channel
    // windows live.
    for (const w of channelWindows.values()) {
      if (!w.isDestroyed()) w.close();
    }
    channelWindows.clear();
  });

  return win;
}

function createChannelWindow(channelId: string, opts: ChannelWindowOptions = {}): BrowserWindow {
  const url = new URL(RENDERER_URL);
  url.searchParams.set("channel", channelId);

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: `Channel — ${channelId}`,
    backgroundColor: opts.transparent ? "#00000000" : "#000000",
    transparent: !!opts.transparent,
    frame: !opts.frameless,
    alwaysOnTop: !!opts.alwaysOnTop,
    fullscreen: !!opts.fullscreen,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(url.toString());

  win.on("closed", () => {
    channelWindows.delete(channelId);
    operatorWindow?.webContents.send("overlaysys:channel-window-closed", channelId);
  });

  channelWindows.set(channelId, win);
  operatorWindow?.webContents.send("overlaysys:channel-window-opened", channelId);
  return win;
}

function buildMenu(): void {
  // Minimal menu — File / View / Window / Help. The operator UI carries
  // the bulk of in-app actions; this is just for native conventions.
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle(
    "overlaysys:open-channel-window",
    (_event, channelId: string, opts?: ChannelWindowOptions) => {
      if (typeof channelId !== "string" || !channelId) {
        throw new Error("channelId required");
      }
      const existing = channelWindows.get(channelId);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { reused: true };
      }
      createChannelWindow(channelId, opts);
      return { reused: false };
    },
  );

  ipcMain.handle("overlaysys:close-channel-window", (_event, channelId: string) => {
    const w = channelWindows.get(channelId);
    if (w && !w.isDestroyed()) w.close();
  });

  ipcMain.handle("overlaysys:list-channel-windows", () => {
    return Array.from(channelWindows.keys());
  });

  ipcMain.handle(
    "overlaysys:set-channel-window-options",
    (_event, channelId: string, opts: ChannelWindowOptions) => {
      const w = channelWindows.get(channelId);
      if (!w || w.isDestroyed()) return false;
      // alwaysOnTop, fullscreen, frame can be toggled at runtime; transparent
      // requires a window recreate so we skip it here.
      if (opts.alwaysOnTop !== undefined) w.setAlwaysOnTop(opts.alwaysOnTop);
      if (opts.fullscreen !== undefined) w.setFullScreen(opts.fullscreen);
      if (opts.frameless !== undefined) {
        // Electron doesn't allow toggling frame on a live window; we'd
        // need to close and recreate. For now, return false to signal
        // that frameless can only be set at open time.
        return false;
      }
      return true;
    },
  );

  ipcMain.handle("overlaysys:get-mode", () => ({
    isDev,
    operatorUrl: OPERATOR_URL,
    rendererUrl: RENDERER_URL,
  }));
}

app.whenReady().then(() => {
  buildMenu();
  registerIpc();
  operatorWindow = createOperatorWindow();

  app.on("activate", () => {
    // macOS: re-create the operator window if dock icon is clicked and
    // no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      operatorWindow = createOperatorWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Quit on all non-mac platforms; macOS keeps the app alive in the dock
  // until Cmd+Q.
  if (process.platform !== "darwin") app.quit();
});
