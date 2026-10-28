import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
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
