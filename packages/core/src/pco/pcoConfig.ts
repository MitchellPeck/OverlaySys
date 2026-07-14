import { z } from "zod";

/**
 * Non-secret Planning Center integration settings, persisted at
 * `data/pco/config.json` (mirrors the STT config file). OAuth tokens are
 * deliberately NOT stored here — they live in the desktop keychain and the
 * server's memory. This holds only operator preferences that should survive
 * restarts.
 */
export const PcoConfigSchema = z.object({
  /** Default lyric template applied to imported song rows. */
  defaultLyricTemplateId: z.string().optional(),
  /** Default template used for non-song plan items (headers/media/notes). */
  defaultGraphicTemplateId: z.string().optional(),
  /** Service type ids the operator has chosen to show (empty = show all). */
  visibleServiceTypeIds: z.array(z.string()).default([]),
  /** Bookkeeping: the last plan imported and when. */
  lastImport: z
    .object({ planId: z.string(), at: z.string() })
    .optional(),
});
export type PcoConfig = z.infer<typeof PcoConfigSchema>;

export const DEFAULT_PCO_CONFIG: PcoConfig = { visibleServiceTypeIds: [] };
