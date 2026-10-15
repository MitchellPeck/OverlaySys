import { z } from "zod";

/**
 * Normalized Planning Center Services types — the denormalized slice of the
 * PCO JSON:API responses that OverlaySys consumes. The server's pcoClient
 * flattens PCO's `{ data, included, relationships }` envelope into these
 * shapes; core's mapping logic and the operator UI only ever see these.
 */

export const PcoServiceTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type PcoServiceType = z.infer<typeof PcoServiceTypeSchema>;

export const PcoPlanSchema = z.object({
  id: z.string(),
  /** Human title if set (often blank for dated plans). */
  title: z.string().optional(),
  /** PCO's pre-formatted date label, e.g. "May 17, 2026". */
  dates: z.string().optional(),
  /** ISO sort date, e.g. "2026-05-17T00:00:00Z". */
  sortDate: z.string().optional(),
});
export type PcoPlan = z.infer<typeof PcoPlanSchema>;

export const PcoSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().optional(),
  ccliNumber: z.string().optional(),
  copyright: z.string().optional(),
});
export type PcoSong = z.infer<typeof PcoSongSchema>;

export const PcoArrangementSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  /** Plain-text lyrics with section headers; may be empty. */
  lyrics: z.string().optional(),
  /** Arrangement sequence, e.g. ["Verse 1","Chorus","Verse 2"]. */
  sequence: z.array(z.string()).optional(),
});
export type PcoArrangement = z.infer<typeof PcoArrangementSchema>;

export const PcoItemTypeSchema = z.enum(["song", "header", "media", "item"]);
export type PcoItemType = z.infer<typeof PcoItemTypeSchema>;

export const PcoPlanItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 1-based position within the plan. */
  sequence: z.number().int().nonnegative().optional(),
  itemType: PcoItemTypeSchema,
  description: z.string().optional(),
  htmlDetails: z.string().optional(),
  /** Present (with lyrics/meta) when itemType === "song". */
  song: PcoSongSchema.optional(),
  arrangement: PcoArrangementSchema.optional(),
  /**
   * An arrangement of the same PCO song that carries lyrics, resolved by the
   * client when the item's own `arrangement` has none. Absent when the item's
   * arrangement has lyrics, or when no sibling arrangement has any either.
   */
  lyricsArrangement: PcoArrangementSchema.optional(),
});
export type PcoPlanItem = z.infer<typeof PcoPlanItemSchema>;
