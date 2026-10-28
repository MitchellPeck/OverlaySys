import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { WebSocketServer } from "ws";
import { handleConnection } from "./ws";
import { startHeartbeat, trackSocket } from "./heartbeat";
import { restoreLiveState, startLiveStatePersistence } from "./liveState";
import { listTemplateMetas, reloadTemplates } from "./templates";
import { listShowMetas, reloadShows } from "./shows";
import { listChannelConfigs, reloadChannelConfigs } from "./channelConfigs";
import { listSongMetas, reloadSongs } from "./songs";
import { listProjects, reloadProjects } from "./projects";
import * as sttSpawner from "./sttSpawner";
import * as sttInstaller from "./sttInstaller";
import { loadSttConfig } from "./storage";
import { registerAssetRoutes } from "./assets";
import { registerImportRoutes } from "./importRoute";
import { registerPublishRoutes } from "./publishRoute";
import { defaultDevEnvFiles, loadDevEnvFiles } from "./devEnv";
import { registerPcoRoutes } from "./pco/routes";
import { initPcoAuthFromEnv } from "./pco/pcoTokens";
import { initScripture, registerScriptureRoutes } from "./scripture";
import { registerStageSettingsRoutes } from "./stageSettings";
import { initApiBible } from "./apiBible/config";
import { registerApiBibleRoutes } from "./apiBible/routes";
import { startApiBibleRefresh } from "./apiBible/refresh";
import { listenWithFallback } from "./serverBoot";
import os from "node:os";
import { lanAddresses } from "./networkInfo";
import {
  TOKEN_COOKIE,
  checkRequest,
  loadSecuritySettings,
  originAllowed,
  remoteAddressOf,
  securityContext,
  tokenEnabled,
} from "./security";
import {
  clearCloudTokens,
  getCloudSyncStatus,
  runSyncNow,
  setCloudTokens,
} from "./cloudSync";

// Source-run only (the packaged host sets OVERLAYSYS_DATA_DIR and passes
// its own env): pick up apps/desktop/.env so cloud sync has credentials
// in dev. Shell values always win.
if (!process.env["OVERLAYSYS_DATA_DIR"]) {
  const applied = loadDevEnvFiles(process.env, defaultDevEnvFiles());
  if (applied.length > 0) {
    console.log(`[env] loaded ${applied.join(", ")} from apps/desktop/.env*`);
  }
}

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
await loadSecuritySettings();

// Origin allow-list + optional LAN token (see security.ts). CORS only
// decides whether a browser may READ a response; the onRequest hook below is
// what actually refuses a cross-site POST before it runs.
await app.register(cors, {
  origin: (origin, cb) => cb(null, originAllowed(origin, securityContext())),
});

/** Peer-is-this-machine flag per request, set by the gate below. */
const localRequests = new WeakSet<object>();

// Routes that hand the server machine-level credentials. Only the desktop
// host (same machine) ever calls them.
const LOOPBACK_ONLY_PREFIXES = ["/api/cloud/tokens", "/api/pco/tokens"];

app.addHook("onRequest", async (req, reply) => {
  const result = checkRequest(
    { url: req.url, headers: req.headers, remoteAddress: remoteAddressOf(req.raw) },
    securityContext(),
  );
  const path = req.url.split("?")[0] ?? "";
  if (!result.ok) {
    // /health stays reachable for monitoring without the token (it reports
    // less when unauthorized); a bad Origin is refused everywhere.
    if (!(result.status === 401 && path === "/health")) {
      return reply.code(result.status).send({ error: result.reason });
    }
    return;
  }
  if (result.local) localRequests.add(req.raw);
  if (LOOPBACK_ONLY_PREFIXES.some((p) => path.startsWith(p)) && !result.local) {
    return reply.code(403).send({ error: "only allowed from this machine" });
  }
  // A page opened once with ?token= keeps working: later navigations, asset
  // loads and its WebSocket carry the cookie (cookies ignore the port).
  if (result.tokenFromQuery) {
    const t = securityContext().token ?? "";
    reply.header("set-cookie", `${TOKEN_COOKIE}=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Lax`);
  }
});

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
app.log.info(
  `loaded ${(await listTemplateMetas()).length} template(s), ${(await listShowMetas()).length} show(s), ${(await listChannelConfigs()).length} channel(s), ${(await listSongMetas()).length} song(s), ${(await listProjects()).length} project(s)`,
);

// Put back what was on air if the server restarted mid-service (snapshot
// younger than 5 min), then keep the snapshot current.
{
  const restored = await restoreLiveState().catch((err) => {
    app.log.warn({ err }, "[liveState] restore failed");
    return null;
  });
  if (restored) {
    app.log.info(`[liveState] restored ${restored.channels} on-air channel(s), ${restored.timers} timer(s)`);
  }
  startLiveStatePersistence();
}

// Load persisted STT config now; the spawner is booted after the port is
// bound (below) so the listener daemon can be pointed at the real WS URL.
const sttConfig = await loadSttConfig();

app.get("/health", async () => ({ ok: true, time: Date.now() }));

// LAN info for "open on another device" links. boundPort is set once the
// listener is up (listenWithFallback may pick a port other than 4000).
let boundPort = PORT;
app.get("/api/network", async () => ({
  port: boundPort,
  addresses: lanAddresses(os.networkInterfaces()),
}));

await registerAssetRoutes(app);
await registerImportRoutes(app);
await registerPublishRoutes(app);
await registerPcoRoutes(app);
// Seed a Planning Center credential from env (PCO_ACCESS_TOKEN, or
// PCO_APP_ID + PCO_SECRET) so a PAT connects without any UI or OAuth flow.
initPcoAuthFromEnv();
await registerScriptureRoutes(app);
await registerStageSettingsRoutes(app);
await registerApiBibleRoutes(app);

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

interface SetTokensBody {
  accessToken?: string;
  refreshToken?: string;
  orgId?: string;
}
app.post<{ Body: SetTokensBody }>("/api/cloud/tokens", async (req, reply) => {
  const { accessToken, refreshToken, orgId } = req.body ?? {};
  if (!accessToken || !refreshToken || !orgId) {
    return reply
      .status(400)
      .send({ error: "accessToken, refreshToken, and orgId are required" });
  }
  const ok = await setCloudTokens({ accessToken, refreshToken, orgId });
  return { ok };
});

app.delete("/api/cloud/tokens", async () => {
  await clearCloudTokens();
  return { ok: true };
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
boundPort = actualPort;
// Not awaited: API.Bible lookups must never delay boot. The refresh job
// starts once the key has been resolved.
void initApiBible()
  .catch((e) => console.warn("[api-bible] init failed", e instanceof Error ? e.message : e))
  .finally(() => startApiBibleRefresh());

// Point the STT listener daemon at THIS server's real port over loopback.
// Must happen before any spawner start — otherwise the daemon dials its
// hardcoded ws://localhost:4000 default and delivers zero hypotheses on any
// non-4000 port. Loopback is correct: the daemon always runs on this host.
sttSpawner.setListenerWsUrl(`ws://127.0.0.1:${actualPort}/ws`);

// Sweep any orphaned STT pipelines left by a previous server that exited
// ungracefully (SIGKILL/crash) — an orphan still holding the mic makes the
// next start fail to open audio and revert. The graceful-exit handlers below
// cover clean restarts; this covers the rest.
const orphansReaped = sttSpawner.reapOrphans();

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
  // In the background, so boot isn't held up: wait for the orphan sweep (it
  // would match our own new pipeline), and in channel mode learn the
  // device's channel count so out-of-range channels are refused clearly.
  void (async () => {
    await orphansReaped;
    if (sttConfig.captureMode === "channels") {
      await sttInstaller.listInputDevices().catch(() => undefined);
    }
    sttSpawner.start(sttConfig);
  })();
}

// Media and fonts upload over HTTP (/api/assets) and templates reference
// them by URL, so WS messages are JSON documents. The cap still leaves room
// for legacy templates that embed an image/font as a data URL; raise it with
// OVERLAYSYS_WS_MAX_PAYLOAD_MB if a very old template refuses to save. (It
// was 1 GB, which let any LAN client make the server buffer a gigabyte.)
const WS_MAX_PAYLOAD_MB = Number(process.env["OVERLAYSYS_WS_MAX_PAYLOAD_MB"] ?? 128);
const wss = new WebSocketServer({
  server: app.server,
  path: "/ws",
  maxPayload: Math.max(1, WS_MAX_PAYLOAD_MB) * 1024 * 1024,
  verifyClient: (info, cb) => {
    const result = checkRequest(
      { url: info.req.url, headers: info.req.headers, remoteAddress: remoteAddressOf(info.req) },
      securityContext(),
    );
    if (result.ok) cb(true);
    else {
      app.log.warn(`[ws] refused upgrade from ${remoteAddressOf(info.req) ?? "?"}: ${result.reason}`);
      cb(false, result.status, result.reason);
    }
  },
});
wss.on("connection", (ws, req) => {
  trackSocket(ws);
  handleConnection(ws, req, app.log);
});
// Ping every socket every 10 s; two missed pongs and it's terminated, so a
// renderer PC that lost power stops counting as a connected output.
startHeartbeat(() => wss.clients);

app.log.info(`OverlaySys server listening on ${HOST}:${actualPort}`);
if (tokenEnabled()) app.log.info("  LAN token required for connections from other machines");
app.log.info(`  HTTP   http://${HOST}:${actualPort}/health`);
app.log.info(`  WS     ws://${HOST}:${actualPort}/ws`);
// Magic line consumed by the Electron host (see apps/desktop/src/main.ts).
// Format: OVERLAYSYS_PORT=<n>\n
console.log(`OVERLAYSYS_PORT=${actualPort}`);
