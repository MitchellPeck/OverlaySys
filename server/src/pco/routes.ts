import type { FastifyInstance } from "fastify";
import { PcoConfigSchema, buildItemPreview } from "@overlaysys/core";
import * as songs from "../songs";
import { getShow, listShowMetas } from "../shows";
import { listSongMetas } from "../songs";
import { loadPcoConfig, savePcoConfig } from "../storage";
import { broadcast } from "../broadcast";
import * as stageFeedHub from "../stageFeedHub";
import {
  basicHeader,
  bearerHeader,
  clearPcoAuthorization,
  clearPcoAuthorizationIf,
  getPcoAuthorization,
  isPcoConnected,
  setPcoAuthorization,
} from "./pcoTokens";
import { PcoAuthError, createPcoClient, verifyPcoCredentials, type PcoClient } from "./pcoClient";
import { findImportedItems, importPlan, type ImportPlanRequest } from "./importPlan";
// [P3.11]
import { scheduleSync } from "../cloudSync";
import { deleteItemMapping, listItemMappings } from "./itemMappings";
import { slidesSuggestionsFor } from "./slidesImport";
// [/P3.11]

/**
 * Planning Center Services REST surface. Token receipt mirrors the cloud
 * endpoints (`/api/cloud/tokens`); the import route mirrors `/api/import`
 * (single request → one response → broadcast).
 */
export async function registerPcoRoutes(
  app: FastifyInstance,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Build a client from the current in-memory token, or throw a 401-shaped
  // error the handlers below translate.
  function requireClient(): PcoClient {
    const authorization = getPcoAuthorization();
    if (!authorization) throw new PcoAuthError("Not connected to Planning Center.");
    // Capture the header this client uses: a 401 clears it only if it is
    // still the stored credential, so a late 401 for an old credential can't
    // wipe a newer valid one.
    const guarded = (async (...args: Parameters<typeof fetch>) => {
      const res = await fetchImpl(...args);
      if (res.status === 401) clearPcoAuthorizationIf(authorization);
      return res;
    }) as typeof fetch;
    return createPcoClient(authorization, guarded);
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
      let header: string;
      if (accessToken) header = bearerHeader(accessToken);
      else if (appId && secret) header = basicHeader(appId, secret);
      else {
        return reply
          .status(400)
          .send({ error: "provide either accessToken, or appId + secret" });
      }
      // Validate before storing: a wrong credential must not flip the app to
      // "connected".
      try {
        await verifyPcoCredentials(header, fetchImpl);
      } catch (err) {
        if (err instanceof PcoAuthError) {
          return reply.status(400).send({ error: err.message, code: "pco_auth" });
        }
        return reply.status(502).send({
          error: `Couldn't reach Planning Center to check the credential. ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      setPcoAuthorization(header);
      return { ok: true };
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
        // Which shows already hold rows from this plan's items ("already
        // imported" badges). Small: a handful of shows per project.
        const liveShows = [];
        for (const m of await listShowMetas()) {
          const show = await getShow(m.id);
          if (show) liveShows.push(show);
        }
        const imported = findImportedItems(liveShows, serviceTypeId, req.params.planId);
        // [P3.11] Deck to pre-select per item for "Import as Slides".
        const slidesSuggestions = await slidesSuggestionsFor(items);
        return { items, previews, imported, slidesSuggestions };
        // [/P3.11]
      } catch (err) {
        return pcoErrorReply(reply, err);
      }
    },
  );

  // [P3.11] ── Remembered "Import as Slides" mappings ─────────────────────
  app.get("/api/pco/item-mappings", async () => {
    scheduleSync();
    return { mappings: await listItemMappings() };
  });

  app.delete<{ Params: { id: string } }>("/api/pco/item-mappings/:id", async (req) => {
    const ok = await deleteItemMapping(req.params.id);
    scheduleSync();
    return { ok };
  });
  // [/P3.11]

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
      // `song_list` above only carries metadata, and the show/song editors
      // skip fetching any song already in their cache — so a client that had
      // one of these songs open would keep rendering its pre-import content
      // (which reads as "my edits didn't persist"). Push the full song for
      // everything this import wrote, whatever the counts above said.
      for (const songId of result.writtenSongIds) {
        const song = await songs.getSong(songId);
        if (song) broadcast({ type: "song", song });
      }
      // A confidence monitor may be showing the imported show or songs.
      if (result.showId || result.writtenSongIds.length > 0) stageFeedHub.invalidateAll();
      return result;
    } catch (err) {
      return pcoErrorReply(reply, err);
    }
  });
}

function pcoErrorReply(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof PcoAuthError) {
    // Clearing already happened (header-scoped) where the 401 was seen; the
    // "Not connected" error has nothing to clear.
    return reply.status(401).send({ error: err.message, code: "pco_auth" });
  }
  return reply
    .status(502)
    .send({ error: err instanceof Error ? err.message : String(err) });
}
