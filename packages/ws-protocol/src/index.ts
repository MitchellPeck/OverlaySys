import { z } from "zod";
import {
  ChannelStateSchema,
  ChannelConfigSchema,
  TemplateSchema,
  ShowSchema,
  SongSchema,
  HotcardSchema,
  ProjectSchema,
  SttSpawnerConfigSchema,
  SttSpawnerStatusSchema,
  SttPresenceSchema,
  SttModelFileSchema,
  SttCaptureDeviceSchema,
  SttInstallProgressSchema,
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
  z.object({ type: z.literal("duplicate_template"), templateId: z.string() }),
  z.object({ type: z.literal("list_shows") }),
  z.object({ type: z.literal("get_show"), showId: z.string() }),
  z.object({ type: z.literal("save_show"), show: ShowSchema }),
  z.object({ type: z.literal("delete_show"), showId: z.string() }),
  z.object({ type: z.literal("duplicate_show"), showId: z.string() }),
  z.object({ type: z.literal("list_projects") }),
  z.object({ type: z.literal("save_project"), project: ProjectSchema }),
  z.object({ type: z.literal("delete_project"), projectId: z.string() }),
  z.object({ type: z.literal("list_hotcards") }),
  z.object({ type: z.literal("get_hotcard"), hotcardId: z.string() }),
  z.object({ type: z.literal("save_hotcard"), hotcard: HotcardSchema }),
  z.object({ type: z.literal("delete_hotcard"), hotcardId: z.string() }),
  z.object({ type: z.literal("duplicate_hotcard"), hotcardId: z.string() }),
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
    // Fire a single sub-take (intro / lyrics / outro) for a song row. The
    // server resolves the Song → ShowSong → Row cascade for template id,
    // field map, and field literals, then dispatches whichever underlying
    // wire flow is right for the chosen sub: a graphic `take` for intro and
    // outro, and `song_take` (or `song_advance` if a same-song session is
    // live) for lyrics. `channel` is optional — when omitted, the server
    // uses the cascade-resolved channel.
    type: z.literal("take_song_sub"),
    showId: z.string(),
    songRowId: z.string(),
    sub: z.enum(["intro", "lyrics", "outro"]),
    channel: z.string().optional(),
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
    // True for finalized hypotheses (LF-terminated), false for partial
    // overdraws (CR-only). Defaults true so manual / older listeners that
    // only emit complete lines stay compatible.
    isFinal: z.boolean().default(true),
  }),
  z.object({ type: z.literal("stt_spawner_get_config") }),
  z.object({
    type: z.literal("stt_spawner_save_config"),
    config: SttSpawnerConfigSchema,
  }),
  z.object({ type: z.literal("stt_spawner_start") }),
  z.object({ type: z.literal("stt_spawner_stop") }),
  // Presence / installer flows. The operator's /stt page sends these to
  // poll for whisper-stream binary availability, list installed models,
  // enumerate capture devices, and drive auto-install. Server responds
  // with `stt_presence` / `stt_models` / `stt_capture_devices` and streams
  // `stt_install_progress` for the duration of any active install job.
  z.object({ type: z.literal("stt_check_presence") }),
  z.object({ type: z.literal("stt_list_models") }),
  z.object({ type: z.literal("stt_enumerate_capture_devices") }),
  z.object({ type: z.literal("stt_install_binary") }),
  z.object({
    type: z.literal("stt_download_model"),
    url: z.string().min(1),
    // .bin filename. Must not contain path separators — installer enforces.
    filename: z.string().min(1),
  }),
  z.object({
    type: z.literal("stt_cancel_install"),
    jobId: z.string(),
  }),
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
        defaultChannel: z.string().optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("template"),
    template: TemplateSchema,
  }),
  z.object({
    type: z.literal("show_list"),
    shows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        projectId: z.string(),
        rowCount: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal("show"),
    show: ShowSchema,
  }),
  z.object({
    type: z.literal("project_list"),
    projects: z.array(ProjectSchema),
  }),
  z.object({
    type: z.literal("project"),
    project: ProjectSchema,
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
    type: z.literal("hotcard_list"),
    hotcards: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        projectId: z.string(),
        templateId: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal("hotcard"),
    hotcard: HotcardSchema,
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
    // Which matcher strategy fired. Null means no match (suggestedSlide is null too).
    strategy: z.enum(["coverage", "neighborhood", "audible"]).nullable(),
    // Folded slide tokens that the matcher counted as hits — feeds the
    // operator-side debug overlay so STT tuning is visible.
    matchedTokens: z.array(z.string()).default([]),
    // Coverage of the cursor slide [0..1]. Always reported, even when
    // the firing strategy wasn't coverage-based.
    coverage: z.number().min(0).max(1).default(0),
    // Server-measured audio→suggestion latency in ms.
    latencyMs: z.number().nonnegative().default(0),
    // True for finalized hypotheses (LF), false for partial overdraws (CR).
    // Reserved for the listener-side partial/final split — defaults true so
    // older listeners stay compatible.
    isFinal: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("stt_spawner_status"),
    status: SttSpawnerStatusSchema,
  }),
  z.object({
    type: z.literal("stt_spawner_config"),
    config: SttSpawnerConfigSchema,
  }),
  z.object({
    type: z.literal("stt_presence"),
    presence: SttPresenceSchema,
  }),
  z.object({
    type: z.literal("stt_models"),
    models: z.array(SttModelFileSchema),
    // Resolved absolute path of the managed models directory — the UI
    // shows it so users can locate / drop in their own .bin files.
    modelsDir: z.string(),
  }),
  z.object({
    type: z.literal("stt_capture_devices"),
    devices: z.array(SttCaptureDeviceSchema),
  }),
  z.object({
    type: z.literal("stt_install_progress"),
    progress: SttInstallProgressSchema,
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
