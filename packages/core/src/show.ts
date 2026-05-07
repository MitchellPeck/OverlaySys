import { z } from "zod";

export const GraphicRowSchema = z.object({
  kind: z.literal("graphic"),
  id: z.string(),
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type GraphicRow = z.infer<typeof GraphicRowSchema>;

export const SongRowSchema = z.object({
  kind: z.literal("song"),
  id: z.string(),
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()).optional(),
  trustMode: z.boolean().optional(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type SongRow = z.infer<typeof SongRowSchema>;

/**
 * Show JSON files predating the row union have rows without a `kind` field.
 * Default missing `kind` to `"graphic"` on read; writes always include `kind`.
 */
export const RundownRowSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("kind" in (raw as Record<string, unknown>))
    ) {
      return { kind: "graphic", ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.discriminatedUnion("kind", [GraphicRowSchema, SongRowSchema]),
);
export type RundownRow = z.infer<typeof RundownRowSchema>;

export const ShowSchema = z.object({
  id: z.string(),
  name: z.string(),
  rows: z.array(RundownRowSchema),
});
export type Show = z.infer<typeof ShowSchema>;
