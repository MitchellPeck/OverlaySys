import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// [P3.11]
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as storage from "../storage";
import * as songs from "../songs";
import * as shows from "../shows";
import * as decks from "../decks";
import { listItemMappings, reloadItemMappings, upsertItemMapping } from "./itemMappings";
const scheduleSync = vi.fn();
vi.mock("../cloudSync", () => ({ scheduleSync: () => scheduleSync() }));
// [/P3.11]
import { registerPcoRoutes } from "./routes";
import { clearPcoAuthorization, getPcoAuthorization, isPcoConnected, setPcoAuthorization } from "./pcoTokens";

function fetchReturning(status: number) {
  return vi.fn(async (_url: string) => new Response(JSON.stringify({ data: [] }), { status }));
}

async function build(fetchImpl: unknown) {
  const app = Fastify();
  await registerPcoRoutes(app, { fetchImpl: fetchImpl as typeof fetch });
  return app;
}

afterEach(() => clearPcoAuthorization());

describe("POST /api/pco/tokens validation", () => {
  it("rejects a PAT PCO answers 401 to and does not store it", async () => {
    const f = fetchReturning(401);
    const app = await build(f);
    const res = await app.inject({ method: "POST", url: "/api/pco/tokens", payload: { appId: "x", secret: "y" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/rejected that Application ID/);
    expect(isPcoConnected()).toBe(false);
    const status = await app.inject({ method: "GET", url: "/api/pco/status" });
    expect(status.json()).toEqual({ connected: false });
    expect(String(f.mock.calls[0]?.[0])).toContain("service_types?per_page=1");
  });

  it("stores a PAT PCO accepts", async () => {
    const app = await build(fetchReturning(200));
    const res = await app.inject({ method: "POST", url: "/api/pco/tokens", payload: { appId: "x", secret: "y" } });
    expect(res.statusCode).toBe(200);
    expect(isPcoConnected()).toBe(true);
  });

  it("does not store when PCO is unreachable", async () => {
    const app = await build(
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const res = await app.inject({ method: "POST", url: "/api/pco/tokens", payload: { accessToken: "t" } });
    expect(res.statusCode).toBe(502);
    expect(isPcoConnected()).toBe(false);
  });

  it("clears the credential when a later request gets a 401", async () => {
    let status = 200;
    const app = await build(async () => new Response("{}", { status }));
    await app.inject({ method: "POST", url: "/api/pco/tokens", payload: { appId: "x", secret: "y" } });
    expect(isPcoConnected()).toBe(true);
    status = 401;
    const res = await app.inject({ method: "GET", url: "/api/pco/service-types" });
    expect(res.statusCode).toBe(401);
    expect(isPcoConnected()).toBe(false);
  });

  it("maps a 403 to 400 and a 5xx to 502 without storing", async () => {
    const a = await build(fetchReturning(403));
    const r1 = await a.inject({ method: "POST", url: "/api/pco/tokens", payload: { appId: "x", secret: "y" } });
    expect(r1.statusCode).toBe(400);
    const b = await build(fetchReturning(503));
    const r2 = await b.inject({ method: "POST", url: "/api/pco/tokens", payload: { appId: "x", secret: "y" } });
    expect(r2.statusCode).toBe(502);
    expect(isPcoConnected()).toBe(false);
  });

  it("a late 401 for credential A does not wipe newly stored credential B", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = await build(async () => {
      await gate;
      return new Response("{}", { status: 401 });
    });
    setPcoAuthorization("Basic A");
    const inflight = app.inject({ method: "GET", url: "/api/pco/service-types" });
    await new Promise((r) => setTimeout(r, 10));
    setPcoAuthorization("Basic B");
    release();
    const res = await inflight;
    expect(res.statusCode).toBe(401);
    expect(getPcoAuthorization()).toBe("Basic B");
  });

  it("'not connected' 401 clears nothing", async () => {
    const app = await build(fetchReturning(200));
    const res = await app.inject({ method: "GET", url: "/api/pco/service-types" });
    expect(res.statusCode).toBe(401);
  });
});

// [P3.11]
describe("slides suggestions and item mappings [P3.11]", () => {
  let tmpDir: string;
  let prev: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-pco-routes-"));
    prev = process.env["OVERLAYSYS_DATA_DIR"];
    process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
    await storage.ensureSeeded();
    await songs.reloadSongs();
    await shows.reloadShows();
    await decks.reloadDecks();
    await reloadItemMappings();
    scheduleSync.mockClear();
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
    else process.env["OVERLAYSYS_DATA_DIR"] = prev;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const planFetch = vi.fn(async (_url: string) =>
    new Response(
      JSON.stringify({
        data: [{ type: "Item", id: "item-1", attributes: { title: "Call to Worship!", sequence: 1, item_type: "item" } }],
        included: [],
      }),
      { status: 200 },
    ),
  );

  it("the items route returns slidesSuggestions with via 'remembered' for a mapped title", async () => {
    await decks.saveDeck({
      id: "deck-cw",
      name: "Opening Liturgy",
      tags: [],
      defaultTemplateId: "tpl-graphic",
      licensing: { kind: "own" },
      slides: [{ id: "a", data: { headline: "Line A" } }],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    await upsertItemMapping({ key: "title:call to worship", kind: "slides", deckId: "deck-cw" });
    const app = await build(planFetch);
    setPcoAuthorization("Basic placeholder");
    const res = await app.inject({ method: "GET", url: "/api/pco/plans/plan-1/items?serviceTypeId=st-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.previews).toHaveLength(1);
    expect(body.slidesSuggestions["item-1"]).toMatchObject({
      deckId: "deck-cw",
      deckName: "Opening Liturgy",
      via: "remembered",
    });
  });

  it("lists mappings and deletes one as a tombstone, scheduling a sync each time", async () => {
    await upsertItemMapping({ key: "title:call to worship", kind: "slides", deckId: "deck-cw" });
    const app = await build(planFetch);

    const list = await app.inject({ method: "GET", url: "/api/pco/item-mappings" });
    expect(list.statusCode).toBe(200);
    expect(list.json().mappings).toEqual([
      expect.objectContaining({ id: "title:call to worship", deckId: "deck-cw" }),
    ]);
    expect(scheduleSync).toHaveBeenCalledTimes(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/pco/item-mappings/${encodeURIComponent("title:call to worship")}`,
    });
    expect(del.json()).toEqual({ ok: true });
    expect(scheduleSync).toHaveBeenCalledTimes(2);

    const all = await listItemMappings({ includeDeleted: true });
    expect(all).toHaveLength(1);
    expect(all[0]!.deletedAt).toBeDefined();
    expect((await app.inject({ method: "GET", url: "/api/pco/item-mappings" })).json().mappings).toEqual([]);

    const again = await app.inject({
      method: "DELETE",
      url: `/api/pco/item-mappings/${encodeURIComponent("title:call to worship")}`,
    });
    expect(again.json()).toEqual({ ok: false });
  });
});
// [/P3.11]
