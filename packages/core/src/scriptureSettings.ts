import { z } from "zod";

/** Install-wide scripture defaults (stored server-side in settings/scripture.json). */
export const ScriptureSettingsSchema = z.object({
  /** Template pre-selected for new scripture rows (and PCO-imported ones). */
  defaultTemplateId: z.string().optional(),
  introTemplateId: z.string().optional(),
  introFieldMap: z.record(z.string(), z.string()).optional(),
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
});
export type ScriptureSettings = z.infer<typeof ScriptureSettingsSchema>;
