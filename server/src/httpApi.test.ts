import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _settleWritesForTest } from "./storage";
import Fastify, { type FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHttpApi } from "./httpApi";
import * as channels from "./channels";
import * as stageState from "./stageState";
import * as timers from "./timers";

let dataDir: string;
let prev: string | undefined;
let app: FastifyInstance;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-api-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = dataDir;
  app = Fastify({ logger: false });
  await registerHttpApi(app);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await _settleWritesForTest();
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
});

describe("/api/v1", () => {
  it("take → state → clear on a channel", async () => {
    const ch = `api-${Date.now()}`;
    const take = await app.inject({
      method: "POST",
      url: `/api/v1/channels/${ch}/take`,
      payload: { templateId: "lower-third", data: { name: "Pastor Jo", n: 3 } },
    });
    expect(take.json()).toEqual({ ok: true });
    const st = await app.inject({ method: "GET", url: `/api/v1/channels/${ch}/state` });
    expect(st.json().state.active).toMatchObject({ templateId: "lower-third", data: { name: "Pastor Jo", n: "3" } });
    const clear = await app.inject({ method: "POST", url: `/api/v1/channels/${ch}/clear` });
    expect(clear.json()).toEqual({ ok: true });
    expect(channels.getState(ch).active?.phase).toBe("out");
  });

  it("rejects a malformed take with 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/channels/program/take", payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it("clear-all clears every channel with something on air", async () => {
    const a = `api-a-${Date.now()}`;
    const b = `api-b-${Date.now()}`;
    channels.take(a, "t", {});
    channels.mediaTake(b, { rowId: "r", assetUrl: "/assets/v.mp4", volume: 1, endAction: "hold" });
    const r = await app.inject({ method: "POST", url: "/api/v1/channels/clear-all" });
    expect(r.json()).toEqual({ ok: true });
    expect(channels.getState(a).active?.phase).toBe("out");
    expect(channels.getState(b).media).toBeNull();
    expect(channels.getState(b).mediaClearCut).toBe(true);
  });

  it("stage message set and clear", async () => {
    await app.inject({ method: "POST", url: "/api/v1/stage/message", payload: { text: "5 min" } });
    expect(stageState.getStageState().message?.text).toBe("5 min");
    await app.inject({ method: "DELETE", url: "/api/v1/stage/message" });
    expect(stageState.getStageState().message).toBeNull();
  });

  it("song advance with no session is a harmless ok", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/song/advance", payload: { channel: "nowhere", delta: 1 } });
    expect(r.json()).toEqual({ ok: true });
  });
});

describe("/health", () => {
  it("reports version, uptime, outputs, STT and sync", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    const body = r.json();
    expect(body).toMatchObject({ ok: true, protocolVersion: expect.any(Number), version: expect.any(String) });
    expect(body.outputs).toBeTypeOf("object");
    expect(body.stt).toHaveProperty("state");
    expect(body.sync).toHaveProperty("paired");
  });
});

describe("timer_create via the ws handler", () => {
  it("can start the timer it creates", async () => {
    const { dispatch } = await import("./httpApi");
    const res = await dispatch(
      [{ type: "timer_create", label: "Countdown", mode: "countdown", durationMs: 300_000, overtime: true, start: true }],
      app.log,
    );
    const ack = res.find((m) => m.type === "ack" && m.op === "timer_create");
    const id = ack?.type === "ack" ? ack.id : undefined;
    const t = timers.getTimers().find((x) => x.id === id);
    expect(t?.anchor).not.toBeNull();
  });
});
