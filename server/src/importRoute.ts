import type { FastifyInstance } from "fastify";
import type {
  Hotcard,
  Show,
  Song,
  Template,
} from "@overlaysys/core";
import * as templates from "./templates";
import * as hotcards from "./hotcards";
import * as shows from "./shows";
import * as songs from "./songs";
import * as bundleApply from "./bundleApply";
import { broadcast } from "./broadcast";

/**
 * `POST /api/import` — single-shot bulk import for the operator's /data page.
 *
 * Why HTTP instead of a `save_*` WS loop: a bulk import is one big upload, not
 * a session-oriented stream of small messages. Sending dozens of WS saves and
 * awaiting per-item acks ran into all the usual single-channel pitfalls
 * (half-dead sockets dropping sends silently, ack delivery queued behind heavy
 * broadcast echoes, `ws`'s concurrent message handlers stalling the event
 * loop). An HTTP POST gives us one request → one response, and lets the
 * server own the asset lift / URL rewrite / save fan-out without ping-ponging
 * data URLs back and forth.
 *
 * The endpoint accepts the same shape the export side produces (minus the
 * `format`/`version`/`exportedAt` wrapper) and is idempotent on assets — sha-
 * named filenames mean re-importing the same bundle is a no-op on disk.
 */

const BODY_LIMIT = 1024 * 1024 * 1024;

interface ImportBody {
  templates?: Template[];
  hotcards?: Hotcard[];
  shows?: Show[];
  songs?: Song[];
  assets?: { filename: string; data: string }[];
}

interface ImportResponse {
  ok: boolean;
  counts: {
    templates: number;
    hotcards: number;
    shows: number;
    songs: number;
    assets: number;
  };
  errors: { kind: string; id: string; message: string }[];
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>(
    "/api/import",
    { bodyLimit: BODY_LIMIT },
    async (req, reply): Promise<ImportResponse> => {
      const body = (req.body ?? {}) as ImportBody;
      if (typeof body !== "object" || body === null) {
        reply.code(400);
        return {
          ok: false,
          counts: { templates: 0, hotcards: 0, shows: 0, songs: 0, assets: 0 },
          errors: [{ kind: "body", id: "", message: "expected JSON object" }],
        };
      }

      const errors: ImportResponse["errors"] = [];
      const counts = { templates: 0, hotcards: 0, shows: 0, songs: 0, assets: 0 };

      // 1. Restore embedded assets first so any entities saved below that
      //    reference them resolve immediately.
      for (const a of body.assets ?? []) {
        try {
          await bundleApply.writeBundledAsset(a.filename, a.data);
          counts.assets += 1;
        } catch (err) {
          errors.push({
            kind: "asset",
            id: a.filename,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 2. Templates first so songs / shows / hotcards that reference them
      //    resolve cleanly. Each entity is lifted (inline data: URLs hoisted
      //    to the asset store); the save layer normalizes any absolute asset
      //    URLs to relative `/assets/<file>` form so cross-host bundles work
      //    without explicit retargeting here.
      for (const t of body.templates ?? []) {
        try {
          const lifted = await bundleApply.liftTemplate(t);
          await templates.saveTemplate(lifted);
          counts.templates += 1;
        } catch (err) {
          errors.push({
            kind: "template",
            id: t?.id ?? "",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const s of body.songs ?? []) {
        try {
          await songs.saveSong(s);
          counts.songs += 1;
        } catch (err) {
          errors.push({
            kind: "song",
            id: s?.id ?? "",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const h of body.hotcards ?? []) {
        try {
          const lifted = await bundleApply.liftHotcard(h);
          await hotcards.saveHotcard(lifted);
          counts.hotcards += 1;
        } catch (err) {
          errors.push({
            kind: "hotcard",
            id: h?.id ?? "",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const sh of body.shows ?? []) {
        try {
          const lifted = await bundleApply.liftShow(sh);
          await shows.saveShow(lifted);
          counts.shows += 1;
        } catch (err) {
          errors.push({
            kind: "show",
            id: sh?.id ?? "",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 3. Broadcast meta-list updates so connected operators refresh. Full
      //    entity bodies are intentionally NOT broadcast — clients fetch on
      //    demand. Keeps the WS quiet after a big import.
      if (counts.templates > 0) {
        broadcast({ type: "template_list", templates: await templates.listTemplateMetas() });
      }
      if (counts.hotcards > 0) {
        broadcast({ type: "hotcard_list", hotcards: await hotcards.listHotcardMetas() });
      }
      if (counts.shows > 0) {
        broadcast({ type: "show_list", shows: await shows.listShowMetas() });
      }
      if (counts.songs > 0) {
        broadcast({ type: "song_list", songs: await songs.listSongMetas() });
      }

      return { ok: errors.length === 0, counts, errors };
    },
  );
}
