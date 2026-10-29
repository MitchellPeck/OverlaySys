import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setCloudTokens = vi.fn(async (_t: unknown) => true);
let lastError: string | null = null;
vi.mock("./cloudSync", () => ({
  setCloudTokens: (t: unknown) => setCloudTokens(t),
  clearCloudTokens: vi.fn(async () => {}),
  runSyncNow: vi.fn(async () => null),
  getCloudSyncStatus: () => ({ paired: false, running: false, lastRanAt: null, lastError, lastResult: null }),
}));
import { registerCloudRoutes } from "./cloudRoutes";

async function build() {
  const app = Fastify();
  registerCloudRoutes(app);
  return app;
}
const body = { accessToken: "a", refreshToken: "r", orgId: "o" };

describe("POST /api/cloud/tokens", () => {
  beforeEach(() => {
    setCloudTokens.mockReset();
    lastError = null;
  });

  it("200 { ok: true } when the session is applied", async () => {
    setCloudTokens.mockResolvedValue(true);
    const res = await (await build()).inject({ method: "POST", url: "/api/cloud/tokens", payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("an error status with the reason when setSession fails", async () => {
    setCloudTokens.mockImplementation(async () => {
      lastError = "setSession failed: invalid JWT";
      return false;
    });
    const res = await (await build()).inject({ method: "POST", url: "/api/cloud/tokens", payload: body });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: "setSession failed: invalid JWT" });
  });

  it("400 when fields are missing", async () => {
    const res = await (await build()).inject({ method: "POST", url: "/api/cloud/tokens", payload: { orgId: "o" } });
    expect(res.statusCode).toBe(400);
    expect(setCloudTokens).not.toHaveBeenCalled();
  });
});
