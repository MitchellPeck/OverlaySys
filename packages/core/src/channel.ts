import { z } from "zod";
import { SongSessionSummarySchema } from "./song";

export const ChannelPhaseSchema = z.enum(["in", "on", "out"]);
export type ChannelPhase = z.infer<typeof ChannelPhaseSchema>;

/**
 * When the active mount was produced by a `take_song_sub` intro/outro flow,
 * the server tags it with the originating song row + sub so identity-aware
 * consumers (Companion feedback, future operator UI) can tell "Song A's
 * intro" from "Song B's intro" even when both songs share the same intro
 * template. Absent for plain graphic takes and for lyrics (lyrics identity
 * is carried by `ChannelState.songSession.songId`).
 */
export const SubTakeContextSchema = z.object({
  songRowId: z.string(),
  sub: z.enum(["intro", "outro"]),
});
export type SubTakeContext = z.infer<typeof SubTakeContextSchema>;

export const ActiveGraphicSchema = z.object({
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  phase: ChannelPhaseSchema,
  takenAt: z.number(), // epoch ms
  subTakeContext: SubTakeContextSchema.optional(),
});
export type ActiveGraphic = z.infer<typeof ActiveGraphicSchema>;

export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;
