import { z } from "zod";

/**
 * A Hotcard is a saved graphic take that lives outside any show — titles,
 * lower-thirds, transition cards, anything you want to keep at hand across
 * services. Triggering one fires the templateId + data on a channel just
 * like a graphic rundown row, but hotcards are not part of any rundown.
 */
export const HotcardSchema = z.object({
  id: z.string(),
  name: z.string(),
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type Hotcard = z.infer<typeof HotcardSchema>;

export type HotcardMeta = Pick<Hotcard, "id" | "name" | "templateId">;
