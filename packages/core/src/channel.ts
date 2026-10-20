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

export const MediaEndActionSchema = z.enum(["clear", "hold"]);
export type MediaEndAction = z.infer<typeof MediaEndActionSchema>;

export const MediaStatusSchema = z.enum(["loading", "playing", "paused", "ended", "error"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/** Last playback report from a renderer, stamped with server receive time. */
export const MediaPlaybackSchema = z.object({
  status: MediaStatusSchema,
  currentTime: z.number(),
  duration: z.number(),
  updatedAt: z.number(),
  error: z.string().optional(),
});
export type MediaPlayback = z.infer<typeof MediaPlaybackSchema>;

/**
 * Full-frame video slot, independent of `active` so a graphic can sit on
 * top of a playing video. Transport is declarative: renderers converge on
 * `paused` and apply any `seek.seq` they haven't applied for this
 * `takenAt`, so reconnects and multiple renderers need no command replay.
 */
export const ChannelMediaSchema = z.object({
  rowId: z.string(),
  assetUrl: z.string(),
  label: z.string().optional(),
  volume: z.number().min(0).max(1),
  endAction: MediaEndActionSchema,
  takenAt: z.number(),
  paused: z.boolean(),
  seek: z.object({ time: z.number(), seq: z.number() }).optional(),
  playback: MediaPlaybackSchema,
});
export type ChannelMedia = z.infer<typeof ChannelMediaSchema>;

/**
 * A song armed by its intro take. Song commands (jump / jump by kind /
 * advance) on a channel with no live session start this song instead of
 * being dropped.
 */
export const QueuedSongSchema = z.object({
  songId: z.string(),
  songRowId: z.string(),
  title: z.string(),
});
export type QueuedSong = z.infer<typeof QueuedSongSchema>;

export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
  queuedSong: QueuedSongSchema.optional(),
  media: ChannelMediaSchema.nullable().optional(),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;
