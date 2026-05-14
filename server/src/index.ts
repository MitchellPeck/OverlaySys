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
import * as sttSpawner from "./sttSpawner";
import { loadSttConfig } from "./storage";
import { registerAssetRoutes } from "./assets";
import { registerImportRoutes } from "./importRoute";

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
app.log.info(
  `loaded ${(await listTemplateMetas()).length} template(s), ${(await listShowMetas()).length} show(s), ${(await listChannelConfigs()).length} channel(s), ${(await listSongMetas()).length} song(s)`,
);

// Boot STT spawner: load persisted config; auto-start if configured.
const sttConfig = await loadSttConfig();
if (sttConfig.autoStart) {
  app.log.info("[stt] autoStart enabled — starting STT spawner");
  sttSpawner.start(sttConfig);
}

app.get("/health", async () => ({ ok: true, time: Date.now() }));

await registerAssetRoutes(app);
await registerImportRoutes(app);

app.get("/api/templates", async () => {
  return { templates: await listTemplateMetas() };
});

app.get("/api/shows", async () => {
  return { shows: await listShowMetas() };
});

app.get("/api/songs", async () => {
  return { songs: await listSongMetas() };
});

await app.listen({ host: HOST, port: PORT });

// Resolve the actually-bound port (PORT=0 → OS-assigned). The Electron
// host reads this from a magic stdout line so it can construct window URLs.
const addr = app.server.address();
const actualPort = typeof addr === "object" && addr ? addr.port : PORT;

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
