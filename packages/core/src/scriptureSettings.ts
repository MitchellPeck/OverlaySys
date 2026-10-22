import { z } from "zod";

/** Install-wide scripture defaults (stored server-side in settings/scripture.json). */
export const ScriptureSettingsSchema = z.object({
  introTemplateId: z.string().optional(),
  introFieldMap: z.record(z.string(), z.string()).optional(),
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
});
export type ScriptureSettings = z.infer<typeof ScriptureSettingsSchema>;
