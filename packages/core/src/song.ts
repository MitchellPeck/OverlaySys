import { z } from "zod";

export const SectionKindSchema = z.enum([
  "verse",
  "chorus",
  "bridge",
  "tag",
  "intro",
  "outro",
  "other",
]);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  lines: z.array(z.string()).min(1),
});
export type Slide = z.infer<typeof SlideSchema>;

export const SectionSchema = z.object({
  id: z.string(),
  kind: SectionKindSchema,
  label: z.string(),
  slides: z.array(SlideSchema).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

/**
 * Songs predating custom fields and sub-take defaults have no `customFields`
 * key. Default missing `customFields` to `{}` on read; writes always include
 * the field. Mirrors the row-kind / projectId backfill patterns in `show.ts`.
 */
export const SongSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("customFields" in (raw as Record<string, unknown>))
    ) {
      return { customFields: {}, ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.object({
    id: z.string(),
    title: z.string(),
    ccliNumber: z.string().optional(),
    author: z.string().optional(),
    copyright: z.string().optional(),
    defaultLyricTemplateId: z.string().optional(),
    sections: z.array(SectionSchema).min(1),
    defaultArrangement: z.array(z.string()),
    customFields: z.record(z.string(), z.string()),
    defaultIntroTemplateId: z.string().optional(),
    defaultIntroFieldMap: z.record(z.string(), z.string()).optional(),
    defaultOutroTemplateId: z.string().optional(),
    defaultOutroFieldMap: z.record(z.string(), z.string()).optional(),
    defaultChannel: z.string().optional(),
  }),
);
export type Song = z.infer<typeof SongSchema>;

export type SongMeta = Pick<Song, "id" | "title" | "ccliNumber" | "author">;

/**
 * Lightweight description of a live SongSession sent to clients via
 * ChannelState.songSession. The server keeps the full session in memory;
 * this is just what's needed to render the operator UI.
 */
export const SongSessionSummarySchema = z.object({
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()),
  cursor: z.object({
    sectionIdx: z.number().int().nonnegative(),
    slideIdx: z.number().int().nonnegative(),
  }),
  blanked: z.boolean(),
  trustMode: z.boolean(),
  startedAt: z.number(),
});
export type SongSessionSummary = z.infer<typeof SongSessionSummarySchema>;
