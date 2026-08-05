import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { WebSocketServer } from "ws";
import { handleConnection } from "./ws";
import { listTemplateMetas, reloadTemplates } from "./templates";
import { listShowMetas, reloadShows } from "./shows";
import { listChannelConfigs, reloadChannelConfigs } from "./channelConfigs";
import { listSongMetas, reloadSongs } from "./songs";
import { listProjects, reloadProjects } from "./projects";
import * as sttSpawner from "./sttSpawner";
import {
  loadSttConfig,
  loadOvationConnection,
  saveOvationConnection,
  clearOvationConnectionFile,
} from "./storage";
import { registerAssetRoutes } from "./assets";
import { registerImportRoutes } from "./importRoute";
import { registerPcoRoutes } from "./pco/routes";
import { initPcoAuthFromEnv } from "./pco/pcoTokens";
import { initScripture, registerScriptureRoutes } from "./scripture";
import { listenWithFallback } from "./serverBoot";
import {
  clearOvationConnection,
  getCloudSyncStatus,
  runSyncNow,
  setOvationConnection,
} from "./cloudSync";

const HOST = process.env["HOST"] ?? "0.0.0.0";
// PORT=0 → OS-assigned ephemeral port (used by the Electron host so two
// running instances don't collide on 4000).
const PORT = Number(process.env["PORT"] ?? 4000);

// Optional static-file directories. When set, Fastify serves the
// operator's static export at /operator/* and the renderer's Vite
// build at /renderer/*. Used by packaged Electron so the operator UI
// and renderer load from the same origin as the WS server.
const STATIC_OPERATOR_DIR = process.env["OVERLAYSYS_STATIC_OPERATOR_DIR"];
const STATIC_RENDERER_DIR = process.env["OVERLAYSYS_STATIC_RENDERER_DIR"];

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

if (STATIC_OPERATOR_DIR) {
  await app.register(staticPlugin, {
    root: path.resolve(STATIC_OPERATOR_DIR),
    prefix: "/operator/",
    decorateReply: false,
    // The Next.js static export uses trailingSlash:true so each route lives
    // at `<route>/index.html`. Without `redirect:true`, a refresh on
    // `/operator/hotcards/edit?id=…` (no trailing slash) 404s — Fastify
    // looks for a file at that path and finds a directory. Auto-redirecting
    // to the slashed form lets the index.html serve.
    redirect: true,
  });
  app.log.info(`[static] operator at ${STATIC_OPERATOR_DIR} → /operator/`);
}
if (STATIC_RENDERER_DIR) {
  await app.register(staticPlugin, {
    root: path.resolve(STATIC_RENDERER_DIR),
    prefix: "/renderer/",
    decorateReply: false,
    redirect: true,
  });
  app.log.info(`[static] renderer at ${STATIC_RENDERER_DIR} → /renderer/`);
}

// Boot: seed fixtures and load registries before accepting connections.
await reloadTemplates();
await reloadShows();
await reloadChannelConfigs();
await reloadSongs();
await reloadProjects();
await initScripture();

// Reconnect to Ovation from the persisted config so a restarted server keeps
// syncing without the operator re-entering their key. A failure here is
// non-fatal: the server still runs on its local replica, and the operator UI
// surfaces the error from the sync status.
{
  const stored = await loadOvationConnection();
  if (stored) {
    const result = await setOvationConnection(stored);
    if (result.ok) {
      app.log.info(`ovation: reconnected to workspace ${stored.workspaceId}`);
    } else {
      app.log.warn(`ovation: stored connection rejected — ${result.error}`);
    }
  }
}

app.log.info(
  `loaded ${(await listTemplateMetas()).length} template(s), ${(await listShowMetas()).length} show(s), ${(await listChannelConfigs()).length} channel(s), ${(await listSongMetas()).length} song(s), ${(await listProjects()).length} project(s)`,
);

// Load persisted STT config now; the spawner is booted after the port is
// bound (below) so the listener daemon can be pointed at the real WS URL.
const sttConfig = await loadSttConfig();

app.get("/health", async () => ({ ok: true, time: Date.now() }));

await registerAssetRoutes(app);
await registerImportRoutes(app);
await registerPcoRoutes(app);
// Seed a Planning Center credential from env (PCO_ACCESS_TOKEN, or
// PCO_APP_ID + PCO_SECRET) so a PAT connects without any UI or OAuth flow.
initPcoAuthFromEnv();
await registerScriptureRoutes(app);

app.get("/api/templates", async () => {
  return { templates: await listTemplateMetas() };
});

app.get("/api/shows", async () => {
  return { shows: await listShowMetas() };
});

app.get("/api/songs", async () => {
  return { songs: await listSongMetas() };
});

app.get("/api/projects", async () => {
  return { projects: await listProjects() };
});

// ── Cloud sync endpoints ──────────────────────────────────────────────
//
// The Electron host pushes refreshed tokens here; the server holds the
// session in memory and runs the sync engine periodically against
// apps-portal's Supabase. Status endpoint lets the operator UI surface
// "last synced at" and any recent errors.

interface ConnectOvationBody {
  baseUrl?: string;
  operatorKey?: string;
  workspaceId?: string;
}
app.post<{ Body: ConnectOvationBody }>("/api/ovation/connect", async (req, reply) => {
  const { baseUrl, operatorKey, workspaceId } = req.body ?? {};
  if (!baseUrl || !operatorKey || !workspaceId) {
    return reply
      .status(400)
      .send({ error: "baseUrl, operatorKey, and workspaceId are required" });
  }

  const result = await setOvationConnection({ baseUrl, operatorKey, workspaceId });
  if (!result.ok) {
    return reply.status(401).send({ ok: false, error: result.error });
  }

  // Only persist a connection the handshake accepted.
  await saveOvationConnection({ baseUrl, operatorKey, workspaceId });
  return { ok: true, workspaceName: result.workspaceName };
});

app.delete("/api/ovation/connect", async () => {
  await clearOvationConnection();
  await clearOvationConnectionFile();
  return { ok: true };
});

/**
 * Non-secret view of the stored connection, for the operator UI. The key is
 * never echoed — only whether one is present.
 */
app.get("/api/ovation/connect", async () => {
  const stored = await loadOvationConnection();
  return {
    connected: !!stored,
    baseUrl: stored?.baseUrl ?? null,
    workspaceId: stored?.workspaceId ?? null,
  };
});

app.get("/api/cloud/sync", async () => getCloudSyncStatus());

app.post("/api/cloud/sync", async () => {
  const result = await runSyncNow();
  return result ?? { skipped: true };
});

// Bind, falling back to an OS-assigned port if the preferred one (4000) is
// already taken — a stale/leftover server on 4000 must degrade to "runs on
// another port", never "whole app fails to launch". The Electron host reads
// the resolved port from the magic stdout line below and builds every window
// URL from it, so a fallback is transparent to the app's own windows.
const actualPort = await listenWithFallback(app, HOST, PORT);

// Point the STT listener daemon at THIS server's real port over loopback.
// Must happen before any spawner start — otherwise the daemon dials its
// hardcoded ws://localhost:4000 default and delivers zero hypotheses on any
// non-4000 port. Loopback is correct: the daemon always runs on this host.
sttSpawner.setListenerWsUrl(`ws://127.0.0.1:${actualPort}/ws`);

// Sweep any orphaned STT pipelines left by a previous server that exited
// ungracefully (SIGKILL/crash) — an orphan still holding the mic makes the
// next start fail to open audio and revert. The graceful-exit handlers below
// cover clean restarts; this covers the rest.
sttSpawner.reapOrphans();

// Tear down the STT child on server exit so it never orphans and holds the
// capture device. Critical in dev, where `tsx watch` restarts the server on
// every code change — a detached, orphaned whisper-stream would keep the mic
// and make the next start fail to open audio (loads ~4s, then dies). Handle
// the common restart/quit signals plus the synchronous 'exit' backstop.
let shuttingDown = false;
const shutdownStt = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    sttSpawner.shutdown();
  } catch {
    /* best effort */
  }
};
process.once("SIGTERM", () => {
  shutdownStt();
  process.exit(0);
});
process.once("SIGINT", () => {
  shutdownStt();
  process.exit(0);
});
process.on("exit", shutdownStt);

// Parent-death watchdog. When the Electron host spawns us it passes a stdin
// pipe and sets OVERLAYSYS_HOST_PIPE=1. If the host dies for ANY reason —
// including a crash or SIGKILL, where the host's own before-quit/exit cleanup
// never runs — the OS closes that pipe. Exiting on pipe-close guarantees we
// never orphan and keep squatting on the port, which would block every
// subsequent launch (both `pnpm dev` and the packaged app) with EADDRINUSE.
if (process.env["OVERLAYSYS_HOST_PIPE"] === "1") {
  const onParentGone = (): void => {
    shutdownStt();
    process.exit(0);
  };
  process.stdin.on("end", onParentGone);
  process.stdin.on("close", onParentGone);
  // stdin defaults to paused; resume so 'end'/'close' actually fire.
  process.stdin.resume();
}

// Boot STT spawner: auto-start if configured (now that the listener URL is set).
if (sttConfig.autoStart) {
  app.log.info("[stt] autoStart enabled — starting STT spawner");
  sttSpawner.start(sttConfig);
}

// 1 GB cap. Videos and (eventually large) fonts are embedded as data URLs
// today, which can push template-save messages well past ws's 100 MB
// default. This raises the ceiling so saves don't drop the socket; the
// proper fix is a real upload endpoint that stores binaries on disk.
const wss = new WebSocketServer({
  server: app.server,
  path: "/ws",
  maxPayload: 1024 * 1024 * 1024,
});
wss.on("connection", (ws, req) => {
  handleConnection(ws, req, app.log);
});

app.log.info(`OverlaySys server listening on ${HOST}:${actualPort}`);
app.log.info(`  HTTP   http://${HOST}:${actualPort}/health`);
app.log.info(`  WS     ws://${HOST}:${actualPort}/ws`);
// Magic line consumed by the Electron host (see apps/desktop/src/main.ts).
// Format: OVERLAYSYS_PORT=<n>\n
console.log(`OVERLAYSYS_PORT=${actualPort}`);
