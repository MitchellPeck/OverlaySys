import type { FastifyInstance } from "fastify";
import { PcoConfigSchema, buildItemPreview } from "@overlaysys/core";
import * as songs from "../songs";
import { listShowMetas } from "../shows";
import { listSongMetas } from "../songs";
import { loadPcoConfig, savePcoConfig } from "../storage";
import { broadcast } from "../broadcast";
import {
  basicHeader,
  bearerHeader,
  clearPcoAuthorization,
  getPcoAuthorization,
  isPcoConnected,
  setPcoAuthorization,
} from "./pcoTokens";
import { PcoAuthError, createPcoClient, type PcoClient } from "./pcoClient";
import { importPlan, type ImportPlanRequest } from "./importPlan";

/**
 * Planning Center Services REST surface. Token receipt mirrors the cloud
 * endpoints (`/api/cloud/tokens`); the import route mirrors `/api/import`
 * (single request → one response → broadcast).
 */
export async function registerPcoRoutes(app: FastifyInstance): Promise<void> {
  // Build a client from the current in-memory token, or throw a 401-shaped
  // error the handlers below translate.
  function requireClient(): PcoClient {
    const authorization = getPcoAuthorization();
    if (!authorization) throw new PcoAuthError("Not connected to Planning Center.");
    return createPcoClient(authorization);
  }

  // ── Credential receipt ─────────────────────────────────────────────────
  // Two ways to authenticate, both landing here:
  //   { accessToken }      → OAuth Bearer token pushed by the desktop host.
  //   { appId, secret }    → Personal Access Token (Basic auth), pasted in
  //                          the operator UI. No OAuth app needed.
  app.post<{ Body: { accessToken?: string; appId?: string; secret?: string } }>(
    "/api/pco/tokens",
    async (req, reply) => {
      const { accessToken, appId, secret } = req.body ?? {};
      if (accessToken) {
        setPcoAuthorization(bearerHeader(accessToken));
        return { ok: true };
      }
      if (appId && secret) {
        setPcoAuthorization(basicHeader(appId, secret));
        return { ok: true };
      }
      return reply
        .status(400)
        .send({ error: "provide either accessToken, or appId + secret" });
    },
  );

  app.delete("/api/pco/tokens", async () => {
    clearPcoAuthorization();
    return { ok: true };
  });

  app.get("/api/pco/status", async () => ({ connected: isPcoConnected() }));

  // ── Non-secret config ──────────────────────────────────────────────────
  app.get("/api/pco/config", async () => ({ config: await loadPcoConfig() }));

  app.put<{ Body: unknown }>("/api/pco/config", async (req, reply) => {
    const parsed = PcoConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    await savePcoConfig(parsed.data);
    return { ok: true, config: parsed.data };
  });

  // ── Browse ─────────────────────────────────────────────────────────────
  app.get("/api/pco/service-types", async (_req, reply) => {
    try {
      return { serviceTypes: await requireClient().listServiceTypes() };
    } catch (err) {
      return pcoErrorReply(reply, err);
    }
  });

  app.get<{ Querystring: { serviceTypeId?: string } }>("/api/pco/plans", async (req, reply) => {
    const serviceTypeId = req.query.serviceTypeId;
    if (!serviceTypeId) return reply.status(400).send({ error: "serviceTypeId is required" });
    try {
      return { plans: await requireClient().listPlans(serviceTypeId) };
    } catch (err) {
      return pcoErrorReply(reply, err);
    }
  });

  app.get<{ Params: { planId: string }; Querystring: { serviceTypeId?: string } }>(
    "/api/pco/plans/:planId/items",
    async (req, reply) => {
      const serviceTypeId = req.query.serviceTypeId;
      if (!serviceTypeId) return reply.status(400).send({ error: "serviceTypeId is required" });
      try {
        const items = await requireClient().getPlanItems(serviceTypeId, req.params.planId);
        const library = await songs.listSongs();
        const previews = items.map((i) => buildItemPreview(i, library));
        return { items, previews };
      } catch (err) {
        return pcoErrorReply(reply, err);
      }
    },
  );

  // ── Import ─────────────────────────────────────────────────────────────
  app.post<{ Body: ImportPlanRequest }>("/api/pco/import", async (req, reply) => {
    try {
      const client = requireClient();
      const result = await importPlan(client, req.body, new Date().toISOString());
      if (result.showId && (result.counts.rows > 0 || result.counts.songsCreated > 0 || result.counts.songsUpdated > 0)) {
        broadcast({ type: "show_list", shows: await listShowMetas() });
        broadcast({ type: "song_list", songs: await listSongMetas() });
        // Record last import for the operator UI.
        const config = await loadPcoConfig();
        await savePcoConfig({ ...config, lastImport: { planId: req.body.planId, at: new Date().toISOString() } });
      }
      return result;
    } catch (err) {
      return pcoErrorReply(reply, err);
    }
  });
}

function pcoErrorReply(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof PcoAuthError) {
    return reply.status(401).send({ error: err.message, code: "pco_auth" });
  }
  return reply
    .status(502)
    .send({ error: err instanceof Error ? err.message : String(err) });
}
