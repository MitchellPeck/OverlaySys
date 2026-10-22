import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { StageSettingsSchema, type StageSettings } from "@overlaysys/core";
import { dataRoot } from "./storage";

const file = () => path.join(dataRoot(), "settings", "stage.json");

/** Install-wide stage-monitor settings. A missing or unreadable file means defaults. */
export async function loadStageSettings(): Promise<StageSettings> {
  try {
    const parsed = StageSettingsSchema.safeParse(JSON.parse(await fs.readFile(file(), "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through to defaults */
  }
  return StageSettingsSchema.parse({});
}

export async function saveStageSettings(settings: StageSettings): Promise<StageSettings> {
  const parsed = StageSettingsSchema.parse(settings);
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(parsed, null, 2));
  return parsed;
}

export async function registerStageSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stage/settings", async () => loadStageSettings());

  app.put<{ Body: unknown }>("/api/stage/settings", async (req, reply) => {
    const parsed = StageSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    return saveStageSettings(parsed.data);
  });
}
