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

/** Identity of a scripture take: its intro, or one of its slides. */
export const ScriptureContextSchema = z.discriminatedUnion("sub", [
  z.object({ rowId: z.string(), sub: z.literal("intro") }),
  z.object({ rowId: z.string(), sub: z.literal("slide"), slideIdx: z.number().int().nonnegative() }),
]);
export type ScriptureContext = z.infer<typeof ScriptureContextSchema>;

export const ActiveGraphicSchema = z.object({
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  phase: ChannelPhaseSchema,
  takenAt: z.number(), // epoch ms
  subTakeContext: SubTakeContextSchema.optional(),
  scriptureContext: ScriptureContextSchema.optional(),
});
export type ActiveGraphic = z.infer<typeof ActiveGraphicSchema>;

export const MediaEndActionSchema = z.enum(["clear", "hold"]);
export type MediaEndAction = z.infer<typeof MediaEndActionSchema>;

/**
 * How a video enters/leaves the output. Audio ramps over the same duration
 * as the picture. `cut` ignores durationMs.
 */
export const MediaTransitionStyleSchema = z.enum(["cut", "fade", "zoom", "slide"]);
export type MediaTransitionStyle = z.infer<typeof MediaTransitionStyleSchema>;

export const MediaTransitionSchema = z.object({
  style: MediaTransitionStyleSchema,
  durationMs: z.number().int().min(0).max(5000),
});
export type MediaTransition = z.infer<typeof MediaTransitionSchema>;

export const DEFAULT_MEDIA_TRANSITION: MediaTransition = { style: "fade", durationMs: 500 };

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
  // Defaulted so state from a pre-transition server still parses.
  transitionIn: MediaTransitionSchema.default(DEFAULT_MEDIA_TRANSITION),
  transitionOut: MediaTransitionSchema.default(DEFAULT_MEDIA_TRANSITION),
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

/** The scripture row whose slides are live on a channel. */
export const ScriptureSessionSummarySchema = z.object({
  rowId: z.string(),
  reference: z.string(),
  slideIdx: z.number().int().nonnegative(),
  slideCount: z.number().int().positive(),
  /** Reference of the live slide, e.g. "John 3:16b-17". */
  slideReference: z.string(),
  text: z.string(),
});
export type ScriptureSessionSummary = z.infer<typeof ScriptureSessionSummarySchema>;

/** A scripture row armed by its intro; the next slide command starts it. */
export const QueuedScriptureSchema = z.object({ rowId: z.string(), reference: z.string() });
export type QueuedScripture = z.infer<typeof QueuedScriptureSchema>;

/** The rundown row a take came from. */
export const RowSourceSchema = z.object({ showId: z.string(), rowId: z.string() });
export type RowSource = z.infer<typeof RowSourceSchema>;

export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
  queuedSong: QueuedSongSchema.optional(),
  scriptureSession: ScriptureSessionSummarySchema.optional(),
  queuedScripture: QueuedScriptureSchema.optional(),
  media: ChannelMediaSchema.nullable().optional(),
  /**
   * True when the last media_clear asked for a hard cut, so renderers skip
   * the take's Out transition. Reset by the next media_take.
   */
  mediaClearCut: z.boolean().optional(),
  /**
   * Last rundown row taken to this channel. Only takes that carry a source
   * change it — hotcards, ad-hoc takes and clears leave it — so stage
   * monitors keep the row's cue up while a lower third flashes by.
   */
  liveRow: RowSourceSchema.optional(),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;
