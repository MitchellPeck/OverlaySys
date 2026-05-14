import { z } from "zod";
import { DEFAULT_PROJECT_ID } from "./project";

/**
 * A Hotcard is a saved graphic take that lives outside any show — titles,
 * lower-thirds, transition cards, anything you want to keep at hand across
 * services. Triggering one fires the templateId + data on a channel just
 * like a graphic rundown row, but hotcards are not part of any rundown.
 *
 * Hotcards belong to a Project. Legacy hotcards predating the Project concept
 * are read with `projectId` backfilled to the default project.
 */
export const HotcardSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("projectId" in (raw as Record<string, unknown>))
    ) {
      return { projectId: DEFAULT_PROJECT_ID, ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.object({
    id: z.string(),
    name: z.string(),
    projectId: z.string(),
    templateId: z.string(),
    data: z.record(z.string(), z.string()),
    channelHint: z.string().optional(),
    notes: z.string().optional(),
  }),
);
export type Hotcard = z.infer<typeof HotcardSchema>;

export type HotcardMeta = Pick<Hotcard, "id" | "name" | "templateId" | "projectId">;
