import { z } from "zod";
import { SongSessionSummarySchema } from "./song";

export const ChannelPhaseSchema = z.enum(["in", "on", "out"]);
export type ChannelPhase = z.infer<typeof ChannelPhaseSchema>;

export const ActiveGraphicSchema = z.object({
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  phase: ChannelPhaseSchema,
  takenAt: z.number(), // epoch ms
});
export type ActiveGraphic = z.infer<typeof ActiveGraphicSchema>;

export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;
