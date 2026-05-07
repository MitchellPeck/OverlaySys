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

export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  ccliNumber: z.string().optional(),
  author: z.string().optional(),
  copyright: z.string().optional(),
  defaultLyricTemplateId: z.string().optional(),
  sections: z.array(SectionSchema).min(1),
  defaultArrangement: z.array(z.string()),
});
export type Song = z.infer<typeof SongSchema>;

export type SongMeta = Pick<Song, "id" | "title" | "ccliNumber" | "author">;
