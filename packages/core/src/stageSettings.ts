import { z } from "zod";

export const DEFAULT_MESSAGE_PRESETS = ["Wrap up", "5 minutes", "Stand by"];

export const StageSettingsSchema = z.object({
  messagePresets: z
    .array(z.string())
    .default(DEFAULT_MESSAGE_PRESETS)
    .transform((list) => list.map((p) => p.trim()).filter(Boolean)),
});
export type StageSettings = z.infer<typeof StageSettingsSchema>;
