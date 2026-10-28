// Versioned HTTP control API (/api/v1/...) and the detailed /health.
//
// For integrations that can't hold a WebSocket (Stream Deck "website"
// buttons, vMix/ATEM scripts, curl). Every command is turned into the same
// ClientMessage the WebSocket accepts and run through the real ws handler on
// a short-lived in-process connection, so there is exactly one
// implementation of take / clear / advance. Behind the same origin check and
// LAN token as everything else (see security.ts, index.ts).

import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";
import { handleConnection } from "./ws";
import * as channels from "./channels";
import * as outputs from "./outputs";
import * as sttSpawner from "./sttSpawner";
import * as sttListener from "./sttListener";
import { getCloudSyncStatus } from "./cloudSync";
import { checkRequest, remoteAddressOf, securityContext, tokenEnabled } from "./security";
import { SERVER_VERSION, STARTED_AT } from "./version";

/** A socket-shaped object for running one request through handleConnection. */
class VirtualSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
}

const VIRTUAL_REQUEST = { socket: { remoteAddress: "127.0.0.1" }, headers: {} } as unknown as IncomingMessage;

/**
 * Run messages through the ws handler as one in-process connection and
 * return the acks/errors they produced (in order).
 */
export async function dispatch(messages: ClientMessage[], log: FastifyBaseLogger): Promise<ServerMessage[]> {
  const sock = new VirtualSocket();
  const handle = handleConnection(sock as never, VIRTUAL_REQUEST, log);
  const before = sock.sent.length;
  for (const m of messages) sock.emit("message", Buffer.from(JSON.stringify(m)));
  await handle.drain();
  sock.readyState = 3;
  sock.emit("close");
  return sock.sent.slice(before).filter((m) => m.type === "ack" || m.type === "error");
}

async function run(reply: FastifyReply, log: FastifyBaseLogger, raw: unknown[]): Promise<unknown> {
  const msgs: ClientMessage[] = [];
  for (const r of raw) {
    const parsed = ClientMessageSchema.safeParse(r);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message ?? "bad request" });
    msgs.push(parsed.data);
  }
  const results = await dispatch(msgs, log);
  const err = results.find((m) => m.type === "error");
  if (err && err.type === "error") {
    return reply.code(err.code === "not_found" ? 404 : 400).send({ ok: false, error: err.code, message: err.message });
  }
  return { ok: true };
}

type Body = Record<string, unknown> | undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function stringRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined && val !== null) out[k] = String(val);
    }
  }
  return out;
}

export async function registerHttpApi(app: FastifyInstance): Promise<void> {
  // Each call opens and closes an in-process connection; keep its
  // per-connection info logs ("ws closed") out of the server log.
  const log = app.log.child({ api: "v1" }, { level: "warn" });

  // Detailed health. Unauthorized callers (other machine, token on, none
  // given) still get liveness, without the details.
  app.get("/health", async (req) => {
    const base = { ok: true, time: Date.now() };
    const gate = checkRequest(
      { url: req.url, headers: req.headers, remoteAddress: remoteAddressOf(req.raw) },
      securityContext(),
    );
    if (!gate.ok) return base;
    const spawner = sttSpawner.getStatus();
    const sync = getCloudSyncStatus();
    return {
      ...base,
      version: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      tokenRequired: tokenEnabled(),
      outputs: outputs.outputsSnapshot(),
      channels: channels.allStates().map((s) => ({
        channel: s.channel,
        onAir: !!s.active && s.active.phase !== "out",
        templateId: s.active?.templateId ?? null,
        video: s.media ? s.media.playback.status : null,
      })),
      stt: {
        state: spawner.state,
        lastError: spawner.lastError,
        listenersOnline: sttListener.list().filter((l) => l.online).length,
        lastHeardAt: sttListener.lastHeardAt() || null,
      },
      sync: { paired: sync.paired, running: sync.running, lastRanAt: sync.lastRanAt, lastError: sync.lastError },
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/channels/:id/state", async (req) => ({
    ok: true,
    state: channels.getState(req.params.id),
    outputs: outputs.outputsSnapshot()[req.params.id]?.count ?? 0,
  }));

  app.post<{ Params: { id: string }; Body: Body }>("/api/v1/channels/:id/take", async (req, reply) => {
    const b = req.body ?? {};
    return run(reply, log, [{ type: "take", channel: req.params.id, templateId: str(b["templateId"]), data: stringRecord(b["data"]) }]);
  });

  app.post<{ Params: { id: string }; Body: Body }>("/api/v1/channels/:id/clear", async (req, reply) => {
    const b = req.body ?? {};
    const msgs: unknown[] = [{ type: "clear", channel: req.params.id }];
    // {"video": true} also hard-cuts the channel's video.
    if (b["video"] === true) msgs.push({ type: "media_clear", channel: req.params.id, cut: true });
    return run(reply, log, msgs);
  });

  app.post<{ Body: Body }>("/api/v1/channels/clear-all", async (req, reply) => {
    const b = req.body ?? {};
    return run(reply, log, [{ type: "clear_all_channels", cutVideo: b["video"] !== false }]);
  });

  app.post<{ Body: Body }>("/api/v1/song/advance", async (req, reply) => {
    const b = req.body ?? {};
    return run(reply, log, [{ type: "song_advance", channel: str(b["channel"]) ?? "program", delta: num(b["delta"]) ?? 1 }]);
  });

  app.post<{ Body: Body }>("/api/v1/stage/message", async (req, reply) => {
    const b = req.body ?? {};
    const text = str(b["text"]) ?? "";
    return run(reply, log, [text ? { type: "stage_message", text } : { type: "stage_message_clear" }]);
  });

  app.delete("/api/v1/stage/message", async (_req, reply) => run(reply, log, [{ type: "stage_message_clear" }]));
}
