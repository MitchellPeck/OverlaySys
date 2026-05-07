import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer } from "ws";
import { handleConnection } from "./ws";
import { listTemplateMetas, reloadTemplates } from "./templates";
import { listShowMetas, reloadShows } from "./shows";
import { listChannelConfigs, reloadChannelConfigs } from "./channelConfigs";
import { listSongMetas, reloadSongs } from "./songs";
import * as sttSpawner from "./sttSpawner";
import { loadSttConfig } from "./storage";

const HOST = process.env["HOST"] ?? "0.0.0.0";
const PORT = Number(process.env["PORT"] ?? 4000);

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

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

const wss = new WebSocketServer({ server: app.server, path: "/ws" });
wss.on("connection", (ws, req) => {
  handleConnection(ws, req, app.log);
});

app.log.info(`OverlaySys server listening on ${HOST}:${PORT}`);
app.log.info(`  HTTP   http://${HOST}:${PORT}/health`);
app.log.info(`  WS     ws://${HOST}:${PORT}/ws`);
