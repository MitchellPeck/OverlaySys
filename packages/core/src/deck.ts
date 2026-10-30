import { z } from "zod";

const DeckLicensingStrict = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ccli"), ccliNumber: z.string().optional() }),
  z.object({ kind: z.literal("public-domain") }),
  z.object({ kind: z.literal("own") }),
]);
export type DeckLicensing = z.infer<typeof DeckLicensingStrict>;
// Passthrough per variant (contracts §4): extra keys survive a re-save; unknown kinds still fail.
export const DeckLicensingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ccli"), ccliNumber: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal("public-domain") }).passthrough(),
  z.object({ kind: z.literal("own") }).passthrough(),
]) as unknown as z.ZodType<DeckLicensing, z.ZodTypeDef, unknown>;

export const MediaRefSchema = z.object({
  mediaItemId: z.string().optional(),
  assetUrl: z.string(),
  mediaType: z.enum(["image", "video"]),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const DeckSlideSchema = z
  .object({
    id: z.string(),
    templateId: z.string().optional(),
    data: z.record(z.string(), z.string()),
    label: z.string().optional(),
    /** A media slide shows this photo/video full-frame; `data` stays `{}` so old clients still parse. */
    media: MediaRefSchema.optional(),
    holdSec: z.number().positive().optional(),
    advanceOnEnd: z.boolean().optional(),
    muted: z.boolean().optional(),
  })
  .passthrough();
export type DeckSlide = z.infer<typeof DeckSlideSchema>;

export const DeckSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tags: z.array(z.string()).default([]),
    defaultTemplateId: z.string(),
    licensing: DeckLicensingSchema,
    slides: z.array(DeckSlideSchema),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    deletedAt: z.string().optional(),
    convertedFromSongId: z.string().optional(),
    /** Seconds each slide is held; its presence means the deck auto-advances. */
    defaultHoldSec: z.number().positive().optional(),
    loop: z.boolean().optional(),
    /** Live-folder library item this deck plays; slides come from the folder's files. */
    liveFolderId: z.string().optional(),
    /** Saved play order of a live folder's files. */
    folderOrder: z.array(z.object({ file: z.string(), holdSec: z.number().positive().optional() })).optional(),
  })
  .passthrough();
export type Deck = z.infer<typeof DeckSchema>;

export const DeckMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  slideCount: z.number(),
  licensing: z.enum(["ccli", "public-domain", "own"]),
  usedBy: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type DeckMeta = z.infer<typeof DeckMetaSchema>;

export interface SlidesRowFields {
  kind: "slides";
  id: string;
  deckId?: string;
  slideIds?: string[];
  templateId?: string;
  fieldOverrides?: Record<string, Record<string, string>>;
  localSlides?: DeckSlide[];
  channelHint?: string;
  notes?: string;
  sermonNotesId?: string;
  lengthSec?: number;
  lengthSecManual?: boolean;
  sectionId?: string;
  stageLayouts?: Record<string, string>;
  sourceRef?: { provider: "pco"; serviceTypeId: string; planId: string; itemId: string };
}
