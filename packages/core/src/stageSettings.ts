import { z } from "zod";

export const DEFAULT_MESSAGE_PRESETS = ["Wrap up", "5 minutes", "Stand by"];

export const StageSettingsSchema = z.object({
  messagePresets: z
    .array(z.string())
    .default(DEFAULT_MESSAGE_PRESETS)
    .transform((list) => list.map((p) => p.trim()).filter(Boolean)),
  /** Start a countdown from a row's length when it is taken to air. */
  autoItemTimer: z.boolean().default(true),
  /** Item countdown runs on past zero as +M:SS instead of stopping. */
  itemTimerOvertime: z.boolean().default(true),
});
export type StageSettings = z.infer<typeof StageSettingsSchema>;
