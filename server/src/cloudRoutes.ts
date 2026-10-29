// Cloud sync endpoints. The Electron host pushes refreshed tokens here; the
// server holds the session in memory and runs the sync engine periodically
// against apps-portal's Supabase. The status endpoint lets the operator UI
// surface "last synced at" and any recent errors.

import type { FastifyInstance } from "fastify";
import { clearCloudTokens, getCloudSyncStatus, runSyncNow, setCloudTokens } from "./cloudSync";

interface SetTokensBody {
  accessToken?: string;
  refreshToken?: string;
  orgId?: string;
}

export function registerCloudRoutes(app: FastifyInstance): void {
  app.post<{ Body: SetTokensBody }>("/api/cloud/tokens", async (req, reply) => {
    const { accessToken, refreshToken, orgId } = req.body ?? {};
    if (!accessToken || !refreshToken || !orgId) {
      return reply.status(400).send({ ok: false, error: "accessToken, refreshToken, and orgId are required" });
    }
    const ok = await setCloudTokens({ accessToken, refreshToken, orgId });
    if (!ok) {
      // Not configured (no Supabase URL/key on the server) or the session was
      // refused (e.g. a token signed by a different project). The host must
      // see a failure, not a 200: it logs it, and the sync pill shows lastError.
      const error = getCloudSyncStatus().lastError ?? "cloud tokens were not applied";
      return reply.status(502).send({ ok: false, error });
    }
    return { ok: true };
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
}
