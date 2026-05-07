import { z } from "zod";
import {
  ChannelStateSchema,
  ChannelConfigSchema,
  TemplateSchema,
  ShowSchema,
  SongSchema,
  SttSpawnerConfigSchema,
  SttSpawnerStatusSchema,
  type TemplateMeta,
} from "@overlaysys/core";

export const PROTOCOL_VERSION = 1;

const DataPayload = z.record(z.string(), z.string());

// ───── Client → Server ─────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    channel: z.string(),
    role: z.enum(["operator", "renderer"]).default("renderer"),
  }),
  z.object({
    type: z.literal("take"),
    channel: z.string(),
    templateId: z.string(),
    data: DataPayload,
  }),
  z.object({
    type: z.literal("clear"),
    channel: z.string(),
  }),
  z.object({
    type: z.literal("update"),
    channel: z.string(),
    data: DataPayload,
  }),
  z.object({
    type: z.literal("cue"),
    channel: z.string(), // typically "preview"
    templateId: z.string(),
    data: DataPayload,
  }),
  z.object({ type: z.literal("list_templates") }),
  z.object({ type: z.literal("get_template"), templateId: z.string() }),
  z.object({ type: z.literal("save_template"), template: TemplateSchema }),
  z.object({ type: z.literal("delete_template"), templateId: z.string() }),
  z.object({ type: z.literal("list_shows") }),
  z.object({ type: z.literal("get_show"), showId: z.string() }),
  z.object({ type: z.literal("save_show"), show: ShowSchema }),
  z.object({ type: z.literal("delete_show"), showId: z.string() }),
  z.object({ type: z.literal("list_songs") }),
  z.object({ type: z.literal("get_song"), songId: z.string() }),
  z.object({ type: z.literal("save_song"), song: SongSchema }),
  z.object({ type: z.literal("delete_song"), songId: z.string() }),
  z.object({
    type: z.literal("song_take"),
    channel: z.string(),
    showId: z.string(),
    songRowId: z.string(),
  }),
  z.object({
    type: z.literal("song_advance"),
    channel: z.string(),
    delta: z.number().int(),
  }),
  z.object({
    type: z.literal("song_jump"),
    channel: z.string(),
    sectionId: z.string(),
    slideIdx: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("song_jump_kind"),
    channel: z.string(),
    kind: z.string(),
    ordinal: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("song_blank"),
    channel: z.string(),
  }),
  z.object({
    type: z.literal("song_set_trust"),
    channel: z.string(),
    trustMode: z.boolean(),
  }),
  z.object({
    type: z.literal("song_end"),
    channel: z.string(),
  }),
  z.object({
    // Promote a song session: if `fromChannel` already has a session for
    // `songRowId`, copy its cursor (and trustMode) to a fresh session on
    // `toChannel`, then end the source. Otherwise start a fresh session
    // on `toChannel` at slide 0. Lets the operator cue a song to preview,
    // navigate to a starting slide, then take to program at that cursor.
    type: z.literal("song_take_pvw_to_pgm"),
    showId: z.string(),
    songRowId: z.string(),
    fromChannel: z.string().default("preview"),
    toChannel: z.string().default("program"),
  }),
  z.object({
    type: z.literal("take_pvw_to_pgm"),
    fromChannel: z.string().default("preview"),
    toChannel: z.string().default("program"),
  }),
  z.object({ type: z.literal("list_channels") }),
  z.object({ type: z.literal("get_channel"), channelId: z.string() }),
  z.object({ type: z.literal("save_channel"), config: ChannelConfigSchema }),
  z.object({ type: z.literal("delete_channel"), channelId: z.string() }),
  z.object({ type: z.literal("ping"), t: z.number() }),
  z.object({
    type: z.literal("stt_listener_register"),
    audioSourceId: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("stt_hypothesis"),
    audioSourceId: z.string(),
    text: z.string(),
    t: z.number(),
  }),
  z.object({ type: z.literal("stt_spawner_get_config") }),
  z.object({
    type: z.literal("stt_spawner_save_config"),
    config: SttSpawnerConfigSchema,
  }),
  z.object({ type: z.literal("stt_spawner_start") }),
  z.object({ type: z.literal("stt_spawner_stop") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ───── Server → Client ─────────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.number(),
    serverTime: z.number(),
  }),
  z.object({
    type: z.literal("state"),
    channel: z.string(),
    state: ChannelStateSchema,
  }),
  z.object({
    type: z.literal("template_list"),
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        size: z.object({ w: z.number(), h: z.number() }),
      }),
    ),
  }),
  z.object({
    type: z.literal("template"),
    template: TemplateSchema,
  }),
  z.object({
    type: z.literal("show_list"),
    shows: z.array(z.object({ id: z.string(), name: z.string(), rowCount: z.number() })),
  }),
  z.object({
    type: z.literal("show"),
    show: ShowSchema,
  }),
  z.object({
    type: z.literal("song_list"),
    songs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        ccliNumber: z.string().optional(),
        author: z.string().optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("song"),
    song: SongSchema,
  }),
  z.object({
    type: z.literal("channel_list"),
    configs: z.array(ChannelConfigSchema),
  }),
  z.object({
    type: z.literal("channel"),
    config: ChannelConfigSchema,
  }),
  z.object({
    type: z.literal("ack"),
    op: z.string(),
    id: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal("pong"), t: z.number() }),
  z.object({
    type: z.literal("stt_listener_state"),
    listeners: z.array(
      z.object({
        audioSourceId: z.string(),
        label: z.string().optional(),
        online: z.boolean(),
        lastSeen: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal("stt_match"),
    channel: z.string(),
    suggestedSlide: z
      .object({
        sectionIdx: z.number().int().nonnegative(),
        slideIdx: z.number().int().nonnegative(),
      })
      .nullable(),
    confidence: z.number().min(0).max(1),
    hypothesis: z.string(),
  }),
  z.object({
    type: z.literal("stt_spawner_status"),
    status: SttSpawnerStatusSchema,
  }),
  z.object({
    type: z.literal("stt_spawner_config"),
    config: SttSpawnerConfigSchema,
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ───── Helpers ──────────────────────────────────────────────────────────────

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage {
  return ClientMessageSchema.parse(JSON.parse(raw));
}

export function decodeServer(raw: string): ServerMessage {
  return ServerMessageSchema.parse(JSON.parse(raw));
}

export type { TemplateMeta };
