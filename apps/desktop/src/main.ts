// OverlaySys Electron host.
//
// Two modes:
//
// **Dev** (env OVERLAYSYS_DESKTOP_DEV=1): assumes `pnpm dev` is already
// running. Loads the operator from http://localhost:3000 and renderer
// from http://localhost:3001. Useful for iterating on UI without
// touching the Electron host.
//
// **Production** (default in packaged builds): the host fork-spawns the
// Fastify server using Electron's own Node (via ELECTRON_RUN_AS_NODE),
// pointing it at OS-assigned port 0 so two running instances don't
// collide. The server serves the operator and renderer static builds
// from the same origin, so window URLs are
// http://localhost:<port>/operator/ and /renderer/?channel=<id>. Data
// lives at app.getPath('userData')/data so it survives reinstalls.
//
// IPC channels are unchanged from the dev-only version — see preload.ts.

import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

const isDev = process.env["OVERLAYSYS_DESKTOP_DEV"] === "1";

let serverChild: ChildProcess | null = null;
let serverPort = 4000;
let serverHost = "127.0.0.1";

let operatorWindow: BrowserWindow | null = null;
const channelWindows = new Map<string, BrowserWindow>();

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
}

function operatorUrl(): string {
  if (isDev) {
    const dev = process.env["OPERATOR_URL"] ?? "http://localhost:3000";
    return `${dev}/?server=ws://localhost:4000/ws`;
  }
  return `http://${serverHost}:${serverPort}/operator/?server=ws://${serverHost}:${serverPort}/ws`;
}

function rendererChannelUrl(channelId: string): string {
  if (isDev) {
    const dev = process.env["RENDERER_URL"] ?? "http://localhost:3001";
    const u = new URL(dev);
    u.searchParams.set("channel", channelId);
    return u.toString();
  }
  return `http://${serverHost}:${serverPort}/renderer/?channel=${encodeURIComponent(
    channelId,
  )}&server=ws://${serverHost}:${serverPort}/ws`;
}

// ── Server lifecycle ─────────────────────────────────────────────────────────

function spawnServer(): Promise<{ port: number }> {
  // In packaged Electron, the app tree sits at process.resourcesPath/app/
  // with this layout (produced by scripts/package-desktop.mjs):
  //
  //   app/
  //     server/                 ← pnpm-deploy'd self-contained server
  //       package.json
  //       src/index.ts
  //       node_modules/         ← all prod deps incl. tsx, fastify, ws
  //     apps/
  //       lyric-listener/src/stdin.mjs
  //       operator/out/         ← static export
  //       renderer/dist/        ← vite build
  //     data/
  //       <kind>/fixtures/      ← seeded into userData on first run
  const resourcesRoot = process.resourcesPath;
  const appRoot = path.join(resourcesRoot, "app");
  const serverDir = path.join(appRoot, "server");
  const fixturesDir = path.join(appRoot, "data");
  const listenerPath = path.join(
    appRoot,
    "apps",
    "lyric-listener",
    "src",
    "stdin.mjs",
  );
  const operatorStatic = path.join(appRoot, "apps", "operator", "out");
  const rendererStatic = path.join(appRoot, "apps", "renderer", "dist");
  const userDataDir = path.join(app.getPath("userData"), "data");

  // The lyric-listener daemon imports `ws` from npm; share the server's
  // node_modules via NODE_PATH so the listener can resolve it without a
  // separate install.
  const sharedNodePath = path.join(serverDir, "node_modules");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    // Default to 4000 so external integrations (Companion, Stream Deck,
    // anything that connects to the WS) can target a known port. Set
    // PORT=0 in env to fall back to an OS-assigned ephemeral port if
    // running multiple instances side-by-side.
    PORT: process.env["PORT"] ?? "4000",
    // Bind to all interfaces so the server is reachable from the LAN —
    // required for Companion / Stream Deck running on a separate control
    // machine. Override with HOST=127.0.0.1 in env for loopback-only.
    HOST: process.env["HOST"] ?? "0.0.0.0",
    NODE_PATH: sharedNodePath,
    OVERLAYSYS_DATA_DIR: userDataDir,
    OVERLAYSYS_FIXTURES_DIR: fixturesDir,
    OVERLAYSYS_LISTENER_PATH: listenerPath,
    OVERLAYSYS_STATIC_OPERATOR_DIR: operatorStatic,
    OVERLAYSYS_STATIC_RENDERER_DIR: rendererStatic,
    NODE_ENV: "production",
  };

  return new Promise<{ port: number }>((resolve, reject) => {
    // cwd = serverDir so node resolves tsx and other deps from
    // server/node_modules.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/index.ts"],
      { env, cwd: serverDir, stdio: ["ignore", "pipe", "pipe"] },
    );
    serverChild = child;

    let resolved = false;
    let buffer = "";
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error("server boot timed out"));
    }, 30_000);

    child.stdout?.on("data", (chunk) => {
      const s = chunk.toString();
      process.stdout.write(`[server] ${s}`);
      buffer += s;
      // Look for the magic OVERLAYSYS_PORT=<n> line emitted by the server
      // once it's fully bound.
      const m = /OVERLAYSYS_PORT=(\d+)/.exec(buffer);
      if (m && m[1] && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ port: Number(m[1]) });
      }
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    child.on("exit", (code, signal) => {
      console.error(`[server] exited code=${code} signal=${signal}`);
      serverChild = null;
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`server exited before ready (code ${code})`));
      }
    });
    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function killServer(): void {
  if (!serverChild) return;
  try {
    serverChild.kill("SIGTERM");
  } catch {
    // ignore
  }
  serverChild = null;
}

function pingHealth(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: "/health", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ── Window creation ──────────────────────────────────────────────────────────

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

  win.loadURL(operatorUrl());

  win.webContents.setWindowOpenHandler(({ url }) => {
    const sameOrigin =
      url.startsWith(`http://${serverHost}:${serverPort}`) ||
      url.startsWith("http://localhost:3000") ||
      url.startsWith("http://localhost:3001");
    if (sameOrigin) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    operatorWindow = null;
    // Closing the operator window closes the whole app — channel windows
    // become orphans without anywhere to drive them from.
    for (const w of channelWindows.values()) {
      if (!w.isDestroyed()) w.close();
    }
    channelWindows.clear();
  });

  return win;
}

function createChannelWindow(channelId: string, opts: ChannelWindowOptions = {}): BrowserWindow {
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

  win.loadURL(rendererChannelUrl(channelId));

  win.on("closed", () => {
    channelWindows.delete(channelId);
    operatorWindow?.webContents.send("overlaysys:channel-window-closed", channelId);
  });

  channelWindows.set(channelId, win);
  operatorWindow?.webContents.send("overlaysys:channel-window-opened", channelId);
  return win;
}

// ── Native menu ──────────────────────────────────────────────────────────────

function buildMenu(): void {
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
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
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
          ? ([{ type: "separator" }, { role: "front" }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC ──────────────────────────────────────────────────────────────────────

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

  ipcMain.handle("overlaysys:list-channel-windows", () =>
    Array.from(channelWindows.keys()),
  );

  ipcMain.handle(
    "overlaysys:set-channel-window-options",
    (_event, channelId: string, opts: ChannelWindowOptions) => {
      const w = channelWindows.get(channelId);
      if (!w || w.isDestroyed()) return false;
      if (opts.alwaysOnTop !== undefined) w.setAlwaysOnTop(opts.alwaysOnTop);
      if (opts.fullscreen !== undefined) w.setFullScreen(opts.fullscreen);
      if (opts.frameless !== undefined) {
        // Electron doesn't allow toggling frame on a live window; need recreate.
        return false;
      }
      return true;
    },
  );

  ipcMain.handle("overlaysys:get-mode", () => ({
    isDev,
    operatorUrl: operatorUrl(),
    rendererUrl: isDev
      ? process.env["RENDERER_URL"] ?? "http://localhost:3001"
      : `http://${serverHost}:${serverPort}/renderer/`,
    serverPort,
  }));
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  if (!isDev) {
    try {
      const { port } = await spawnServer();
      serverPort = port;
      // Verify the health endpoint responds (sanity check).
      const ok = await pingHealth(serverHost, serverPort, 5000);
      if (!ok) throw new Error("server health check failed");
      console.log(`[desktop] server ready on ${serverHost}:${serverPort}`);
    } catch (err) {
      console.error("[desktop] server failed to start:", err);
      app.quit();
      return;
    }
  }
  buildMenu();
  registerIpc();
  operatorWindow = createOperatorWindow();
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !isDev) {
    operatorWindow = createOperatorWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killServer();
});

process.on("exit", () => {
  killServer();
});
