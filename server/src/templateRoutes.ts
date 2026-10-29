import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TemplateSchema, type Show } from "@overlaysys/core";
import * as shows from "./shows";
import * as songs from "./songs";
import { deckRegistrySnapshot } from "./decks";
import * as hotcards from "./hotcards";
import { loadScriptureSettings } from "./scriptureSettings";
import { templateUsage, type TemplateUsage } from "./templateUsage";
// [P2b.11]
import { broadcast } from "./broadcast";
import * as channels from "./channels";
import { draftTemplateId, dropDraftTemplate, setDraftTemplate } from "./templateDrafts";
// [/P2b.11]

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
    return templateUsage(req.params.id, { shows: liveShows, hotcards: cards, songs: songList, scripture, decks: [...deckRegistrySnapshot().values()] });
  });

  // [P2b.11] draft preview
  registerDraftPreviewRoutes(app);
  // [/P2b.11]
}

// [P2b.11] draft preview
/** The only channel a draft may ever be cued on. Hard-coded: the body has no channel. */
const DRAFT_CHANNEL = "preview";

const DraftPreviewBody = z.object({
  template: TemplateSchema,
  data: z.record(z.string()).default({}),
});

/**
 * `POST /api/templates/draft-preview` cues the designer's unsaved draft on
 * preview; `DELETE /api/templates/draft-preview/:id` (source id) takes it off.
 * Error replies name the op so the client reports them instead of timing out.
 */
function registerDraftPreviewRoutes(app: FastifyInstance): void {
  app.post("/api/templates/draft-preview", async (req, reply) => {
    const parsed = DraftPreviewBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        op: "draft_preview",
        error: parsed.error.issues[0]?.message ?? "invalid template",
      });
    }
    const draft = setDraftTemplate(parsed.data.template);
    // The template first, so renderers hold the new draft when the take arrives.
    broadcast({ type: "template", template: draft });
    channels.take(DRAFT_CHANNEL, draft.id, parsed.data.data);
    return { ok: true, draftId: draft.id };
  });

  app.delete<{ Params: { id: string } }>("/api/templates/draft-preview/:id", async (req) => {
    const draftId = draftTemplateId(req.params.id);
    if (channels.getState(DRAFT_CHANNEL).active?.templateId === draftId) channels.clear(DRAFT_CHANNEL);
    dropDraftTemplate(req.params.id);
    return { ok: true };
  });
}
// [/P2b.11]
