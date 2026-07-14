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

import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import {
  clearTokens as clearCloudTokens,
  loadTokens as loadCloudTokens,
  startSignIn as startCloudSignIn,
  updateTokens as updateCloudTokens,
} from "./cloudAuth";
import {
  clearTokens as clearPcoTokens,
  loadTokens as loadPcoTokens,
  refreshTokens as refreshPcoTokens,
  startSignIn as startPcoSignIn,
  type PcoTokens,
} from "./pcoAuth";
import {
  loadPrefs,
  savePrefs,
  resolveDisplay,
  updateDisplayCache,
  fingerprintDisplay,
  type MatchedBy,
} from "./windowPrefs";
import { identifyDisplays } from "./identifyDisplays";
import type {
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";

// ── .env loading ──────────────────────────────────────────────────────────
//
// Electron main is plain Node.js — `.env` isn't auto-loaded. Read
// apps/desktop/.env and .env.local (if present) and merge into
// process.env *before* anything else uses them, so cloudAuth and other
// modules see OVERLAYSYS_REGISTRY_APP_ID etc.
//
// Search order, first hit wins per key:
//   1. process.env (shell already-set wins; .env doesn't override)
//   2. apps/desktop/.env.local (dev-only, gitignored)
//   3. apps/desktop/.env (shared dev config)
//
// In packaged builds the .env files won't be present alongside main.js;
// packaged users set env vars via the OS launcher or we'll surface a
// settings UI later. Dev path is what matters here.
function loadEnvFile(file: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
// __dirname at runtime is `apps/desktop/dist` in dev, or the directory
// containing main.js inside the asar in packaged builds. Both layouts
// keep main.js next to baked-env.json (written by package-desktop.mjs)
// and one level above any sibling `.env` (dev only).
const desktopRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(desktopRoot, ".env.local"));
loadEnvFile(path.join(desktopRoot, ".env"));

// Packaged builds ship `dist/baked-env.json` next to main.js. Source .env
// files are NOT bundled into the asar — only the generated JSON is. The
// values come from `apps/desktop/.env` at package time (see
// scripts/package-desktop.mjs).
function loadBakedEnv(file: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadBakedEnv(path.join(__dirname, "baked-env.json"));
// Packaged-build fallback: user-writable env file. The path can't be
// resolved until app.whenReady fires (getPath requires the app to be
// initialized), so kick it off lazily once Electron is ready and re-apply
// before any IPC handler that needs the values runs.
let userDataEnvLoaded = false;
function ensureUserDataEnv(): void {
  if (userDataEnvLoaded) return;
  userDataEnvLoaded = true;
  try {
    const userData = app.getPath("userData");
    loadEnvFile(path.join(userData, ".env"));
  } catch {
    // app not ready yet — safe to retry on next call
    userDataEnvLoaded = false;
  }
}

// ── Boot logging ─────────────────────────────────────────────────────────────
//
// Windows GUI Electron processes have no attached console — anything
// written to stdout/stderr is discarded by the OS. Mirror every console
// call and the server child's output into <userData>/boot.log so a
// packaged install can be debugged post-mortem (look in
// %APPDATA%\OverlaySys\boot.log on Windows,
// ~/Library/Application Support/OverlaySys/boot.log on macOS).

let bootLogStream: fs.WriteStream | null = null;
const bootLogQueue: string[] = [];

function appendBootLog(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  if (bootLogStream) {
    bootLogStream.write(stamped);
    return;
  }
  bootLogQueue.push(stamped);
  if (bootLogQueue.length > 1000) bootLogQueue.shift();
}

function initBootLog(): void {
  if (bootLogStream) return;
  let dir: string;
  try {
    dir = app.getPath("userData");
  } catch {
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "boot.log");
    const stream = fs.createWriteStream(file, { flags: "a" });
    stream.write(
      `\n[${new Date().toISOString()}] ── boot log opened ─ pid=${process.pid} ──\n`,
    );
    while (bootLogQueue.length > 0) stream.write(bootLogQueue.shift()!);
    bootLogStream = stream;
  } catch {
    // best-effort; if we can't open the log we still proceed
  }
}

function fmtLogArg(a: unknown): string {
  if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

for (const level of ["log", "info", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      const tag = level === "log" || level === "info" ? "" : `[${level}] `;
      appendBootLog(tag + args.map(fmtLogArg).join(" "));
    } catch {
      // never let logging mask the original call
    }
    orig(...(args as []));
  };
}

process.on("uncaughtException", (err) => {
  appendBootLog(`[uncaughtException] ${err.message}\n${err.stack ?? ""}`);
});
process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack ?? ""}`
      : String(reason);
  appendBootLog(`[unhandledRejection] ${msg}`);
});

const isDev = process.env["OVERLAYSYS_DESKTOP_DEV"] === "1";

let serverChild: ChildProcess | null = null;
let serverPort = 4000;
let serverHost = "127.0.0.1";

/**
 * Forward the user's cloud session to the embedded server. The server
 * holds the tokens in memory, materializes a Supabase client + sync
 * engine wiring, and runs reconciliation periodically. Best-effort:
 * server may be unreachable during boot races; callers wrap the call in
 * a `.catch` so we don't crash the desktop on a sync-side hiccup.
 */
async function pushTokensToServer(tokens: {
  accessToken: string;
  refreshToken: string;
  registryOrgId: string | null;
}): Promise<void> {
  if (!tokens.registryOrgId) return; // no org → nothing to scope sync to
  await fetch(`http://${serverHost}:${serverPort}/api/cloud/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      orgId: tokens.registryOrgId,
    }),
  });
}

/** Clear the server's cloud session — companion to `pushTokensToServer`. */
async function clearServerCloudTokens(): Promise<void> {
  await fetch(`http://${serverHost}:${serverPort}/api/cloud/tokens`, {
    method: "DELETE",
  });
}

// ── Planning Center token hand-off ─────────────────────────────────────────
//
// The desktop owns the PCO OAuth flow + refresh (like the cloud session) and
// pushes the current *access* token to the embedded server, which holds it in
// memory for its REST proxy + import routes. Refresh tokens never leave the
// keychain.

let pcoRefreshTimer: NodeJS.Timeout | null = null;

async function pushPcoTokenToServer(tokens: PcoTokens): Promise<void> {
  await fetch(`http://${serverHost}:${serverPort}/api/pco/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken: tokens.accessToken }),
  });
}

async function clearServerPcoTokens(): Promise<void> {
  await fetch(`http://${serverHost}:${serverPort}/api/pco/tokens`, {
    method: "DELETE",
  });
}

/**
 * Schedule an access-token refresh shortly before expiry, re-push, and
 * reschedule. Best-effort — a failed refresh just means the next server call
 * 401s and the user re-connects.
 */
function schedulePcoRefresh(tokens: PcoTokens): void {
  if (pcoRefreshTimer) clearTimeout(pcoRefreshTimer);
  const lead = 60_000; // refresh 1 min before expiry
  const delay = Math.max(10_000, tokens.expiresAt - Date.now() - lead);
  pcoRefreshTimer = setTimeout(() => {
    void refreshPcoTokens()
      .then((next) => {
        if (next) {
          void pushPcoTokenToServer(next).catch(() => undefined);
          schedulePcoRefresh(next);
        }
      })
      .catch((err) => console.warn("[desktop] PCO token refresh failed", err));
  }, delay);
}

let operatorWindow: BrowserWindow | null = null;
const channelWindows = new Map<string, BrowserWindow>();

interface ChannelResolution {
  matchedBy: MatchedBy;
  configuredLabel: string | null;
  actualLabel: string;
  actualDisplayId: number;
}

const channelResolutions = new Map<string, ChannelResolution>();

function prefsFilePath(): string {
  return path.join(app.getPath("userData"), "data", "channel-window-prefs.json");
}

function currentDisplaysSnapshot() {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label,
    bounds: {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
    },
    internal: d.internal,
  }));
}

interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
  /** Electron `Display.id` of the target screen. If undefined or unknown,
   *  the window opens on the primary display. */
  displayId?: number;
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
    // Bind to all interfaces so renderer windows and Companion/Stream Deck
    // running on another machine on the LAN can reach the server. Local
    // Electron windows still hit 127.0.0.1 fine since loopback is part of
    // "all interfaces". Override with HOST=127.0.0.1 for loopback-only.
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
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) appendBootLog(`[server] ${line}`);
      }
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
      const s = chunk.toString();
      process.stderr.write(`[server] ${s}`);
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) appendBootLog(`[server:err] ${line}`);
      }
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
    // macOS: prefer "simple" (pre-Lion) fullscreen — covers the whole
    // screen incl. menu bar, no separate Space, no animated transition.
    // For broadcast tooling this is what users actually want when they
    // hit "fullscreen"; the native macOS fullscreen with its Space
    // transition is hostile to live-show workflows. No-op on other
    // platforms (which already do the right thing by default).
    simpleFullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const opUrl = operatorUrl();
  console.log(`[desktop] operator window: loading ${opUrl}`);
  win.loadURL(opUrl);

  win.webContents.on(
    "did-fail-load",
    (_e, code, description, validatedURL) => {
      console.error(
        `[desktop] operator did-fail-load: code=${code} desc=${description} url=${validatedURL}`,
      );
    },
  );
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(
      `[desktop] operator render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

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
  const isMac = process.platform === "darwin";

  // Look up the target display so we can position the window on it
  // BEFORE any fullscreen transition. Electron honors the screen the
  // window is currently on at the moment fullscreen is engaged.
  const targetDisplay =
    (opts.displayId !== undefined
      ? screen.getAllDisplays().find((d) => d.id === opts.displayId)
      : undefined) ?? screen.getPrimaryDisplay();

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    x: targetDisplay.bounds.x + 40,
    y: targetDisplay.bounds.y + 40,
    title: `Channel — ${channelId}`,
    backgroundColor: opts.transparent ? "#00000000" : "#000000",
    transparent: !!opts.transparent,
    frame: !opts.frameless,
    alwaysOnTop: !!opts.alwaysOnTop,
    // See createOperatorWindow for why simpleFullscreen is set.
    // Channel windows are broadcast outputs — they're the canonical
    // place you DON'T want a macOS animated Space transition. On
    // macOS we deliberately DON'T pass `fullscreen` in the ctor
    // (even as `false`) — explicit values there seem to lock the
    // green traffic-light button to native fullscreen mode and the
    // simpleFullscreen flag stops affecting it.
    simpleFullscreen: true,
    ...(isMac ? {} : { fullscreen: !!opts.fullscreen }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Safety net for macOS: if anything (green button, programmatic, etc.)
  // tries to enter the native macOS fullscreen, immediately bail out
  // and switch to simple fullscreen. Without this, certain channel
  // window configurations (transparent, alwaysOnTop, etc.) ignore the
  // simpleFullscreen flag and revert to native behavior.
  if (isMac) {
    win.on("enter-full-screen", () => {
      if (!win.isSimpleFullScreen()) {
        win.setFullScreen(false);
        // Defer so the native exit completes before the simple enter.
        setTimeout(() => {
          if (!win.isDestroyed()) win.setSimpleFullScreen(true);
        }, 50);
      }
    });
  }

  // macOS: enter simple fullscreen after the window has been built,
  // since BrowserWindow constructor doesn't auto-enter simple-fullscreen
  // even when `simpleFullscreen: true` is set. setSimpleFullScreen
  // performs the actual mode change. On other platforms the
  // `fullscreen` ctor option above handles it.
  if (isMac && opts.fullscreen) {
    win.setSimpleFullScreen(true);
  }

  win.loadURL(rendererChannelUrl(channelId));

  win.on("closed", () => {
    // Guard: forceRecreate flow closes the old window AFTER inserting
    // a fresh entry. Without this identity check, the old window's
    // async "closed" event would evict the new window's entry.
    if (channelWindows.get(channelId) === win) {
      channelWindows.delete(channelId);
    }
    operatorWindow?.webContents.send("overlaysys:channel-window-closed", channelId);
  });

  channelWindows.set(channelId, win);
  operatorWindow?.webContents.send("overlaysys:channel-window-opened", channelId);
  return win;
}

/**
 * Resolve the target display for a channel and open its renderer
 * window. Records the resolution result so the operator UI can
 * surface fallbacks. Honors `forceRecreate` to support the "Reopen
 * on configured display" action.
 */
function openConfiguredChannelWindow(
  channelId: string,
  prefs: ChannelWindowPrefs,
  overrides: Partial<ChannelWindowOptions> = {},
  forceRecreate = false,
): { reused: boolean } {
  const file = loadPrefs(prefsFilePath());
  const displays = currentDisplaysSnapshot();
  const primary = screen.getPrimaryDisplay();
  const resolved = resolveDisplay(prefs, {
    displays,
    cached: file.displays,
    primary: {
      id: primary.id,
      label: primary.label,
      bounds: { ...primary.bounds },
      internal: primary.internal,
    },
  });

  const cachedFor = file.displays.find((c) => c.id === prefs.displayId);
  channelResolutions.set(channelId, {
    matchedBy: resolved.matchedBy,
    configuredLabel: cachedFor?.label ?? null,
    actualLabel: resolved.display.label,
    actualDisplayId: resolved.display.id,
  });

  // Refresh the display cache with whatever we just resolved.
  if (resolved.matchedBy !== "fallback") {
    file.displays = updateDisplayCache(file.displays, displays, file.channels);
    savePrefs(prefsFilePath(), file);
  }

  const existing = channelWindows.get(channelId);
  if (existing && !existing.isDestroyed()) {
    if (forceRecreate) {
      existing.close();
    } else {
      existing.focus();
      return { reused: true };
    }
  }

  const opts: ChannelWindowOptions = {
    fullscreen: prefs.fullscreen,
    frameless: prefs.frameless,
    alwaysOnTop: prefs.alwaysOnTop,
    transparent: prefs.transparent,
    displayId: resolved.display.id,
    ...overrides,
  };
  createChannelWindow(channelId, opts);
  return { reused: false };
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
        // Custom toggle so the operator window uses simple fullscreen
        // on macOS instead of the native Space-using fullscreen that
        // `role: "togglefullscreen"` would trigger. Cmd-Ctrl-F matches
        // the standard macOS shortcut for fullscreen.
        {
          label: isMac ? "Toggle Full Screen" : "Toggle Full Screen",
          accelerator: isMac ? "Ctrl+Cmd+F" : "F11",
          click: (_item, focusedWin) => {
            if (!focusedWin) return;
            if (process.platform === "darwin") {
              focusedWin.setSimpleFullScreen(!focusedWin.isSimpleFullScreen());
            } else {
              focusedWin.setFullScreen(!focusedWin.isFullScreen());
            }
          },
        },
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
      // If we have stored prefs for this channel, layer the caller's
      // explicit `opts` on top — but use prefs as the base (display,
      // fullscreen, etc.).
      const file = loadPrefs(prefsFilePath());
      const prefs = file.channels[channelId];
      if (prefs) {
        return openConfiguredChannelWindow(channelId, prefs, opts ?? {}, false);
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
      if (opts.fullscreen !== undefined) {
        if (process.platform === "darwin") {
          w.setSimpleFullScreen(opts.fullscreen);
        } else {
          w.setFullScreen(opts.fullscreen);
        }
      }
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

  ipcMain.handle("overlaysys:get-displays", () => currentDisplaysSnapshot());

  ipcMain.handle("overlaysys:get-channel-window-prefs", (): WindowPrefsFile => {
    return loadPrefs(prefsFilePath());
  });

  ipcMain.handle(
    "overlaysys:set-channel-window-prefs",
    (_event, channelId: string, prefs: ChannelWindowPrefs): WindowPrefsFile => {
      if (typeof channelId !== "string" || !channelId) {
        throw new Error("channelId required");
      }
      const file = loadPrefs(prefsFilePath());
      file.channels[channelId] = prefs;
      file.displays = updateDisplayCache(
        file.displays,
        currentDisplaysSnapshot(),
        file.channels,
      );
      savePrefs(prefsFilePath(), file);
      return file;
    },
  );

  ipcMain.handle("overlaysys:get-channel-window-resolutions", () => {
    return Object.fromEntries(channelResolutions);
  });

  ipcMain.handle(
    "overlaysys:reopen-channel-on-configured-display",
    (_event, channelId: string) => {
      if (typeof channelId !== "string" || !channelId) {
        throw new Error("channelId required");
      }
      const file = loadPrefs(prefsFilePath());
      const prefs = file.channels[channelId];
      if (!prefs) return { reused: false, reason: "no-prefs" as const };
      openConfiguredChannelWindow(channelId, prefs, {}, /* forceRecreate */ true);
      return { reused: false };
    },
  );

  ipcMain.handle("overlaysys:identify-displays", () => {
    identifyDisplays();
  });

  // ── Cloud auth ────────────────────────────────────────────────────────
  // Sign-in opens the system browser at apps.mitchellpeck.com's
  // /api/apps/<id>/open endpoint with a localhost loopback `return`
  // URL. See src/cloudAuth.ts for the full flow.
  ipcMain.handle("overlaysys:cloud-sign-in", async () => {
    ensureUserDataEnv();
    try {
      const tokens = await startCloudSignIn();
      // Newly-signed-in tokens land in the server so its sync engine has
      // a session immediately, not on the next renderer refresh.
      void pushTokensToServer(tokens).catch((err) =>
        console.warn("[desktop] forwarding sign-in tokens to server failed", err),
      );
      return { ok: true, tokens };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("overlaysys:cloud-get-tokens", async () => {
    ensureUserDataEnv();
    return loadCloudTokens();
  });

  ipcMain.handle("overlaysys:cloud-sign-out", async () => {
    await clearCloudTokens();
    // Clear the server's session in the same pass — leaving stale tokens
    // would mean the next periodic sync hits Supabase as the just-out
    // user, which RLS would deny anyway, but logging the noise serves
    // no one.
    void clearServerCloudTokens().catch((err) =>
      console.warn("[desktop] clearing server tokens failed", err),
    );
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("overlaysys:cloud-signed-out");
    }
  });

  // Renderer pushes refreshed tokens up after Supabase JS auto-refreshes
  // its in-memory session. Without this, a quit + relaunch after the
  // access-token TTL loses the session even though the refresh token is
  // still valid — defeats the point of "stay signed in" for desktop.
  ipcMain.handle(
    "overlaysys:cloud-update-tokens",
    async (
      _event,
      input: {
        accessToken: string;
        refreshToken: string;
        registryOrgId?: string | null;
      },
    ) => {
      ensureUserDataEnv();
      const persisted = await updateCloudTokens(input);
      // Forward the fresh tokens to the embedded server so its
      // CloudStorageAdapter keeps a valid session for periodic sync.
      // Best-effort: server may not be reachable yet during boot races,
      // and the next periodic refresh will retry.
      void pushTokensToServer(persisted).catch((err) =>
        console.warn("[desktop] forwarding refreshed tokens to server failed", err),
      );
      return persisted;
    },
  );

  // ── Planning Center sign-in ────────────────────────────────────────────
  // OAuth authorization-code flow via a loopback callback; see src/pcoAuth.ts.
  ipcMain.handle("overlaysys:pco-sign-in", async () => {
    ensureUserDataEnv();
    try {
      const tokens = await startPcoSignIn();
      void pushPcoTokenToServer(tokens).catch((err) =>
        console.warn("[desktop] forwarding PCO token to server failed", err),
      );
      schedulePcoRefresh(tokens);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("overlaysys:pco-get-status", async () => {
    ensureUserDataEnv();
    const tokens = await loadPcoTokens();
    return { connected: tokens !== null };
  });

  ipcMain.handle("overlaysys:pco-sign-out", async () => {
    if (pcoRefreshTimer) {
      clearTimeout(pcoRefreshTimer);
      pcoRefreshTimer = null;
    }
    await clearPcoTokens();
    void clearServerPcoTokens().catch((err) =>
      console.warn("[desktop] clearing server PCO token failed", err),
    );
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("overlaysys:pco-signed-out");
    }
  });

  // Open an arbitrary URL in the system browser. Used by AccountMenu so
  // "Manage account" from the desktop app surfaces the cloud account
  // page externally rather than navigating in the renderer.
  ipcMain.handle("overlaysys:open-external", async (_event, url: string) => {
    if (typeof url !== "string" || !url) return;
    // Restrict to http(s) so a malicious renderer-side bug can't shell out
    // to file:// or custom URI handlers.
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  initBootLog();
  console.log(
    `[desktop] boot starting — platform=${process.platform} arch=${process.arch} electron=${process.versions.electron} node=${process.versions.node} execPath=${process.execPath} resourcesPath=${process.resourcesPath} isDev=${isDev}`,
  );
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

  // Sync wake-up: if cloud tokens were persisted from a prior session,
  // forward them to the server so its sync loop kicks in immediately
  // rather than waiting for the user to interact with the renderer.
  try {
    const existing = await loadCloudTokens();
    if (existing) {
      void pushTokensToServer(existing).catch((err) =>
        console.warn("[desktop] startup sync wake-up failed", err),
      );
    }
  } catch (err) {
    console.warn("[desktop] startup token load failed", err);
  }

  // Same wake-up for Planning Center: forward a persisted access token to the
  // server (refreshing first if it's already expired) so the operator's PCO
  // browse/import works without a fresh sign-in each launch.
  try {
    let pco = await loadPcoTokens();
    if (pco && pco.expiresAt <= Date.now()) {
      pco = (await refreshPcoTokens()) ?? pco;
    }
    if (pco) {
      void pushPcoTokenToServer(pco).catch((err) =>
        console.warn("[desktop] startup PCO token push failed", err),
      );
      schedulePcoRefresh(pco);
    }
  } catch (err) {
    console.warn("[desktop] startup PCO token load failed", err);
  }

  // Auto-open configured channel windows. Done after the operator
  // window so closing the operator (which closes all channel windows)
  // is the canonical lifecycle owner.
  try {
    const file = loadPrefs(prefsFilePath());
    for (const [channelId, prefs] of Object.entries(file.channels)) {
      if (prefs.autoOpen) {
        openConfiguredChannelWindow(channelId, prefs, {}, false);
      }
    }
  } catch (err) {
    console.error("[desktop] auto-open failed:", err);
  }
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
