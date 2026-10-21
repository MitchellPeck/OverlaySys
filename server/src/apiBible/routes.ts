import type { FastifyInstance } from "fastify";
import { clearApiBibleKey, getApiBibleStatus, setApiBibleKey } from "./config";
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

  app.post<{ Body: { tokens?: unknown } }>("/api/scripture/usage", async (req) => {
    const raw = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    const tokens = raw.filter((t): t is string => typeof t === "string" && t.length > 0);
    void reportViews(tokens);
    return { ok: true };
  });
}
