import type { FastifyInstance } from "fastify";
import type { Show } from "@overlaysys/core";
import * as shows from "./shows";
import * as songs from "./songs";
import * as hotcards from "./hotcards";
import { loadScriptureSettings } from "./scriptureSettings";
import { templateUsage, type TemplateUsage } from "./templateUsage";

/** `GET /api/templates/:id/usage` — what would break if this template were deleted. */
export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/templates/:id/usage", async (req): Promise<TemplateUsage> => {
    const metas = await shows.listShowMetas();
    const liveShows: Show[] = [];
    for (const m of metas) {
      const s = await shows.getShow(m.id);
      if (s) liveShows.push(s);
    }
    const [cards, songList, scripture] = await Promise.all([
      hotcards.listHotcardMetas(),
      songs.listSongs(),
      loadScriptureSettings(),
    ]);
    return templateUsage(req.params.id, { shows: liveShows, hotcards: cards, songs: songList, scripture });
  });
}
