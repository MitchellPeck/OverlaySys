import type { FastifyInstance } from "fastify";
import {
  clearApiBibleKey,
  getApiBibleStatus,
  listLicensedBibles,
  setApiBibleKey,
  setApiBibleTranslations,
} from "./config";
import { ScriptureProviderError } from "@overlaysys/scripture";
import { reportViews } from "./fums";

const ENV_MESSAGE = "Set by environment (OVERLAYSYS_API_BIBLE_KEY)";

export async function registerApiBibleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scripture/api-bible", async () => getApiBibleStatus());

  app.put<{ Body: { apiKey?: unknown } }>("/api/scripture/api-bible", async (req, reply) => {
    const key = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!key) return reply.code(400).send({ ...getApiBibleStatus(), message: "Missing apiKey" });
    const result = await setApiBibleKey(key);
    if (result === "env") return reply.code(409).send({ ...getApiBibleStatus(), message: ENV_MESSAGE });
    return result.state === "ok" ? result : reply.code(400).send(result);
  });

  app.delete("/api/scripture/api-bible", async (_req, reply) => {
    const result = await clearApiBibleKey();
    if (result === "env") return reply.code(409).send({ ...getApiBibleStatus(), message: ENV_MESSAGE });
    return result;
  });

  // Bibles the configured key licenses, for the translation picker.
  app.get("/api/scripture/api-bible/bibles", async (_req, reply) => {
    try {
      const bibles = await listLicensedBibles();
      if (!bibles) return reply.code(409).send({ message: "No API.Bible key configured" });
      return { bibles };
    } catch (e) {
      const code = e instanceof ScriptureProviderError && e.code === "rejected" ? 400 : 503;
      return reply.code(code).send({ message: e instanceof Error ? e.message : String(e) });
    }
  });

  // Replace the set of registered API.Bible translations.
  app.put<{ Body: { bibleIds?: unknown } }>("/api/scripture/api-bible/translations", async (req, reply) => {
    const raw = Array.isArray(req.body?.bibleIds) ? req.body.bibleIds : null;
    if (!raw) return reply.code(400).send({ message: "bibleIds must be an array" });
    const ids = raw.filter((x): x is string => typeof x === "string" && x.length > 0);
    try {
      const result = await setApiBibleTranslations(ids);
      if (!result) return reply.code(409).send({ message: "No API.Bible key configured" });
      return { ...result.status, unknown: result.unknown };
    } catch (e) {
      return reply.code(503).send({ message: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Body: { tokens?: unknown } }>("/api/scripture/usage", async (req) => {
    const raw = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    const tokens = raw.filter((t): t is string => typeof t === "string" && t.length > 0);
    void reportViews(tokens);
    return { ok: true };
  });
}
