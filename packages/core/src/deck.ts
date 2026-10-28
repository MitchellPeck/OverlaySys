import { z } from "zod";

export const DeckLicensingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ccli"), ccliNumber: z.string().optional() }),
  z.object({ kind: z.literal("public-domain") }),
  z.object({ kind: z.literal("own") }),
]);
export type DeckLicensing = z.infer<typeof DeckLicensingSchema>;

export const DeckSlideSchema = z
  .object({
    id: z.string(),
    templateId: z.string().optional(),
    data: z.record(z.string(), z.string()),
    label: z.string().optional(),
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
  })
  .passthrough();
export type Deck = z.infer<typeof DeckSchema>;

export type DeckMeta = {
  id: string;
  name: string;
  tags: string[];
  slideCount: number;
  licensing: DeckLicensing["kind"];
  usedBy: number;
  createdAt: string;
  updatedAt?: string;
};

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
