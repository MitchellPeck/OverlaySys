import { z } from "zod";
import { MediaStatusSchema } from "./channel";
import { StageLayoutSchema } from "./stageLayout";
import { TimeFormatSchema } from "./template";

/**
 * Everything a confidence monitor renders, derived server-side
 * (server/src/stageFeed.ts) and pushed as `stage_feed`. Time-based values
 * are raw (anchors, playback reports) — the renderer ticks them locally.
 */

export const SlideViewSchema = z.object({
  kind: z.enum(["lyric", "scripture", "graphic", "none"]),
  lines: z.array(z.string()),
  reference: z.string().optional(),
});
export type SlideView = z.infer<typeof SlideViewSchema>;

export const NONE_SLIDE: SlideView = { kind: "none", lines: [] };

export const StageRowViewSchema = z.object({ title: z.string(), cue: z.string() });
export type StageRowView = z.infer<typeof StageRowViewSchema>;

export const StageTimerSchema = z.object({
  label: z.string(),
  channel: z.string(),
  mode: z.enum(["countdown", "countup"]),
  format: TimeFormatSchema.optional(),
  /** Encoded TimerValue (see timeField.ts). */
  value: z.string(),
});
export type StageTimer = z.infer<typeof StageTimerSchema>;

export const StageVideoSchema = z.object({
  status: MediaStatusSchema,
  currentTime: z.number(),
  duration: z.number(),
  /** Server ms when currentTime was reported. */
  at: z.number(),
  label: z.string().optional(),
});
export type StageVideo = z.infer<typeof StageVideoSchema>;

export const StageFeedSchema = z.object({
  layout: StageLayoutSchema,
  current: SlideViewSchema,
  next: SlideViewSchema,
  row: StageRowViewSchema.nullable(),
  nextRow: StageRowViewSchema.nullable(),
  timers: z.array(StageTimerSchema),
  video: StageVideoSchema.nullable(),
  serverNow: z.number(),
});
export type StageFeed = z.infer<typeof StageFeedSchema>;
