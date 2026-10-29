import { z } from "zod";
import {
  ChannelStateSchema,
  ChannelConfigSchema,
  MediaEndActionSchema,
  MediaTransitionSchema,
  MediaStatusSchema,
  MediaPlaybackSchema,
  TemplateSchema,
  StageLayoutSchema,
  StageLayoutMetaSchema,
  ShowSchema,
  StageStateSchema,
  SongSchema,
  DeckSchema,
  DeckMetaSchema,
  DeckLicensingSchema,
  HotcardSchema,
  HotkeySchema,
  ProjectSchema,
  SttSpawnerConfigSchema,
  SttSpawnerStatusSchema,
  SttPresenceSchema,
  SttModelFileSchema,
  SttCaptureDeviceSchema,
  SttInputDeviceSchema,
  SttInstallProgressSchema,
  RowSourceSchema,
  StageFeedSchema,
  StageTimerInstanceSchema,
  StageServiceViewSchema,
  MAX_TIMER_DURATION_MS,
  type TemplateMeta,
} from "@overlaysys/core";

export const PROTOCOL_VERSION = 3;

/** True when a peer's protocol major differs from ours (log a warning). */
export function protocolMismatch(peerVersion: number | undefined): boolean {
  return typeof peerVersion === "number" && peerVersion !== PROTOCOL_VERSION;
}

export const OutputPresenceSchema = z.object({
  count: z.number().int().nonnegative(),
  /** Most recent sign of life from any of the channel's outputs (ms epoch). */
  lastSeen: z.number(),
  labels: z.array(z.string()),
});
export type OutputPresence = z.infer<typeof OutputPresenceSchema>;
export type OutputsState = Record<string, OutputPresence>;

const DataPayload = z.record(z.string(), z.string());

// ───── Client → Server ─────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    channel: z.string(),
    role: z.enum(["operator", "renderer"]).default("renderer"),
    /** Renderer windows: shown in `outputs_state` (e.g. "OBS", "Desktop window"). */
    label: z.string().max(80).optional(),
    /**
     * Set by a mirror window (fill/key alpha) subscribing to its SOURCE
     * channel: the subscription doesn't count as an output of that source,
     * and it receives `media_playback` so its video can follow the primary.
     */
    mirrorFor: z.string().optional(),
  }),
  z.object({
    type: z.literal("take"),
    channel: z.string(),
    templateId: z.string(),
    data: DataPayload,
    source: RowSourceSchema.optional(),
  }),
  z.object({
    type: z.literal("clear"),
    channel: z.string(),
  }),
  /**
   * Panic: clear graphics on every channel (mirrors excluded — they follow
   * their source) and, unless `cutVideo` is false, hard-cut every video.
   */
  z.object({
    type: z.literal("clear_all_channels"),
    cutVideo: z.boolean().default(true),
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
    source: RowSourceSchema.optional(),
  }),
  z.object({ type: z.literal("list_templates") }),
  z.object({ type: z.literal("get_template"), templateId: z.string() }),
  z.object({ type: z.literal("save_template"), template: TemplateSchema }),
  z.object({ type: z.literal("delete_template"), templateId: z.string() }),
  z.object({ type: z.literal("duplicate_template"), templateId: z.string() }),
  z.object({ type: z.literal("list_stage_layouts") }),
  z.object({ type: z.literal("get_stage_layout"), layoutId: z.string() }),
  z.object({ type: z.literal("save_stage_layout"), layout: StageLayoutSchema }),
  z.object({ type: z.literal("delete_stage_layout"), layoutId: z.string() }),
  z.object({ type: z.literal("duplicate_stage_layout"), layoutId: z.string() }),
  z.object({
    type: z.literal("stage_layout_preview"),
    channel: z.string(),
    layout: StageLayoutSchema.nullable(),
  }),
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
  // ── Scripture (server-side session; see server/src/scriptureSession.ts) ──
  z.object({
    // Intro sub-take: puts the resolved intro on air and queues the row so
    // the next scripture slide command starts it.
    type: z.literal("scripture_take_intro"),
    showId: z.string(),
    rowId: z.string(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("scripture_take_slide"),
    showId: z.string(),
    rowId: z.string(),
    slideIdx: z.number().int().nonnegative(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("scripture_advance"),
    channel: z.string(),
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({
    type: z.literal("scripture_goto"),
    channel: z.string(),
    slideIdx: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("scripture_end"), channel: z.string() }),
  // ── Media slot (full-frame video beneath graphics) ──
  z.object({
    type: z.literal("media_take"),
    channel: z.string(),
    rowId: z.string(),
    /** Show the row belongs to; with rowId it becomes the channel's liveRow. */
    showId: z.string().optional(),
    assetUrl: z.string(),
    label: z.string().optional(),
    volume: z.number().min(0).max(1),
    endAction: MediaEndActionSchema,
    /** Omitted by older senders; the server falls back to a 500 ms fade. */
    transitionIn: MediaTransitionSchema.optional(),
    transitionOut: MediaTransitionSchema.optional(),
  }),
  /** `cut: true` skips the take's Out transition (instant clear). */
  z.object({ type: z.literal("media_clear"), channel: z.string(), cut: z.boolean().optional() }),
  z.object({
    type: z.literal("media_control"),
    channel: z.string(),
    takenAt: z.number(),
    action: z.enum(["play", "pause", "restart", "seek"]),
    time: z.number().min(0).optional(),
  }),
  /** Renderer → server playback report. Stale `takenAt` is ignored. */
  z.object({
    type: z.literal("media_status"),
    channel: z.string(),
    takenAt: z.number(),
    status: MediaStatusSchema,
    currentTime: z.number().min(0),
    duration: z.number().min(0),
    error: z.string().optional(),
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
  // Optional `config` lets the operator save and start atomically in a
  // single handler. Without it, save_config + start are two separate
  // async handlers and the save's disk write can race the start's read,
  // causing the spawner to launch with stale config.
  z.object({
    type: z.literal("stt_spawner_start"),
    config: SttSpawnerConfigSchema.optional(),
  }),
  z.object({ type: z.literal("stt_spawner_stop") }),
  // Opt in/out of `stt_levels` (channel-select meter, ~10/s). Only the
  // settings page asks, so Companion and renderers never receive them.
  z.object({ type: z.literal("stt_levels_subscribe"), on: z.boolean() }),
  // Opt in/out of `stt_match` (several per second while a song is live).
  // Operator consoles and Companion ask; renderers never receive them.
  z.object({ type: z.literal("stt_match_subscribe"), on: z.boolean() }),
  // Presence / installer flows. The operator's /stt page sends these to
  // poll for whisper-stream binary availability, list installed models,
  // enumerate capture devices, and drive auto-install. Server responds
  // with `stt_presence` / `stt_models` / `stt_capture_devices` and streams
  // `stt_install_progress` for the duration of any active install job.
  z.object({ type: z.literal("stt_check_presence") }),
  z.object({ type: z.literal("stt_list_models") }),
  z.object({
    type: z.literal("stt_enumerate_capture_devices"),
    // Bypass the server's enumeration cache. Heavy — spawns whisper-stream
    // which loads ~500MB of backends and momentarily holds the audio
    // device, so it should only be set on explicit user "rescan".
    force: z.boolean().default(false),
  }),
  z.object({ type: z.literal("stt_install_binary") }),
  z.object({ type: z.literal("stt_uninstall_binary") }),
  z.object({
    type: z.literal("stt_download_model"),
    url: z.string().min(1),
    // .bin filename. Must not contain path separators — installer enforces.
    filename: z.string().min(1),
  }),
  z.object({
    type: z.literal("stt_delete_model"),
    // Filename only — installer resolves inside the managed models dir and
    // refuses anything that escapes via `..` or path separators.
    filename: z.string().min(1),
  }),
  z.object({
    type: z.literal("stt_cancel_install"),
    jobId: z.string(),
  }),
  z.object({ type: z.literal("notes_select"), showId: z.string(), notesId: z.string().nullable() }),
  // Exactly one of delta/index is required; enforced in the ws handler since
  // a refine would make this a ZodEffects, which discriminatedUnion rejects.
  z.object({ type: z.literal("notes_point"), delta: z.number().int().optional(), index: z.number().int().optional() }),
  z.object({ type: z.literal("notes_scroll"), delta: z.number() }),
  z.object({ type: z.literal("notes_reset") }),
  z.object({ type: z.literal("notes_overflow"), direction: z.enum(["next", "prev"]), atPoint: z.number().int().nonnegative() }),
  z.object({ type: z.literal("stage_message"), text: z.string().max(200) }),
  z.object({ type: z.literal("stage_message_clear") }),
  z.object({
    type: z.literal("timer_create"),
    label: z.string().max(60),
    mode: z.enum(["countdown", "countup"]),
    durationMs: z.number().finite().min(0).max(MAX_TIMER_DURATION_MS).optional(),
    overtime: z.boolean().default(true),
    /** Start it right away (the id is server-generated, so a caller can't start it after). */
    start: z.boolean().optional(),
  }),
  z.object({
    type: z.enum(["timer_start", "timer_pause", "timer_resume", "timer_reset", "timer_delete"]),
    id: z.string(),
  }),
  z.object({
    type: z.literal("timer_adjust"),
    id: z.string(),
    deltaMs: z.number().finite().min(-MAX_TIMER_DURATION_MS).max(MAX_TIMER_DURATION_MS),
  }),
  /** Start polling PCO Services Live for the show's plan (read-only). */
  z.object({ type: z.literal("pco_live_start"), showId: z.string() }),
  z.object({ type: z.literal("pco_live_stop") }),
  // [P3.4] decks, slides and convert
  z.object({ type: z.literal("list_decks") }),
  z.object({ type: z.literal("get_deck"), deckId: z.string() }),
  z.object({ type: z.literal("save_deck"), deck: DeckSchema }),
  z.object({ type: z.literal("delete_deck"), deckId: z.string() }),
  z.object({ type: z.literal("restore_deck"), deckId: z.string() }),
  z.object({ type: z.literal("duplicate_deck"), deckId: z.string() }),
  z.object({
    type: z.literal("slides_take"),
    showId: z.string(),
    rowId: z.string(),
    slideIdx: z.number().int().nonnegative().optional(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("slides_advance"),
    channel: z.string(),
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({
    type: z.literal("slides_goto"),
    channel: z.string(),
    slideIdx: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("slides_blank"), channel: z.string() }),
  z.object({ type: z.literal("slides_end"), channel: z.string() }),
  z.object({
    type: z.literal("convert_song_to_deck"),
    songId: z.string(),
    titleSlide: z.boolean(),
    licensing: DeckLicensingSchema.optional(),
  }),
  z.object({ type: z.literal("undo_convert_song"), conversionId: z.string() }),
  // [/P3.4]
  // [P2b.33] stage layout
  z.object({
    type: z.literal("set_stage_layout"),
    channel: z.string(),
    layoutId: z.string().nullable(),
  }),
  // [/P2b.33]
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ───── Server → Client ─────────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    /** Major protocol version; clients warn when it differs from theirs. */
    protocolVersion: z.number(),
    serverTime: z.number(),
    /** Server package version (absent on older servers). */
    serverVersion: z.string().optional(),
  }),
  /**
   * Connected renderer windows per channel. Sent on connect and whenever a
   * renderer subscribes or disconnects. A channel with no entry has no
   * output connected.
   */
  z.object({
    type: z.literal("outputs_state"),
    outputs: z.record(z.string(), OutputPresenceSchema),
  }),
  z.object({
    type: z.literal("state"),
    channel: z.string(),
    state: ChannelStateSchema,
  }),
  /** Confidence-monitor content for a `kind: "stage"` channel. */
  z.object({
    type: z.literal("stage_feed"),
    channel: z.string(),
    feed: StageFeedSchema,
  }),
  /** ~4 Hz playback tick for a channel's media slot. Status transitions arrive as `state`. */
  z.object({
    type: z.literal("media_playback"),
    channel: z.string(),
    takenAt: z.number(),
    playback: MediaPlaybackSchema,
  }),
  z.object({
    type: z.literal("template_list"),
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        size: z.object({ w: z.number(), h: z.number() }),
        defaultChannel: z.string().optional(),
        role: z.enum(["graphic", "lyric", "scripture", "title"]).optional(),
        updatedAt: z.string().optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("template"),
    template: TemplateSchema,
  }),
  z.object({
    type: z.literal("stage_layout_list"),
    layouts: z.array(StageLayoutMetaSchema),
  }),
  z.object({ type: z.literal("stage_layout"), layout: StageLayoutSchema }),
  z.object({
    type: z.literal("stage_layout_previews"),
    previews: z.array(z.object({ channel: z.string(), layoutId: z.string() })),
  }),
  z.object({
    type: z.literal("show_list"),
    shows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        projectId: z.string(),
        rowCount: z.number(),
        scheduledFor: z.string().optional(),
        updatedAt: z.string().optional(),
        totalLengthSec: z.number().optional(),
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
        updatedAt: z.string().optional(),
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
        hotkey: HotkeySchema.nullable().optional(),
        channelHint: z.string().optional(),
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
    // macOS input devices with channel counts, for channel select. Absent
    // on other platforms.
    inputDevices: z.array(SttInputDeviceSchema).optional(),
  }),
  z.object({
    // Channel-select capture: one 0–1 peak per channel in `channels` (the
    // running config's 1-based channel numbers), ~10x a second while
    // running; both empty when stopped. Sent only to subscribed clients.
    type: z.literal("stt_levels"),
    levels: z.array(z.number()),
    channels: z.array(z.number()),
  }),
  z.object({
    type: z.literal("stt_install_progress"),
    progress: SttInstallProgressSchema,
  }),
  z.object({
    type: z.literal("stage_state"),
    state: StageStateSchema,
    pointCount: z.number().int().nonnegative(),
    title: z.string().nullable(),
    pointHeading: z.string().nullable(),
    nextHeading: z.string().nullable(),
  }),
  z.object({ type: z.literal("timers_state"), timers: z.array(StageTimerInstanceSchema) }),
  /** PCO Live sync status; `service` is non-null only while enabled. */
  z.object({
    type: z.literal("pco_live_state"),
    enabled: z.boolean(),
    showId: z.string().nullable(),
    status: z.enum(["idle", "live", "notStarted", "ended", "error"]),
    error: z.string().optional(),
    lastPolledAt: z.number().nullable(),
    service: StageServiceViewSchema.nullable(),
  }),
  // [P3.4] decks and convert
  z.object({
    type: z.literal("deck_list"),
    decks: z.array(DeckMetaSchema),
  }),
  z.object({ type: z.literal("deck"), deck: DeckSchema }),
  z.object({
    type: z.literal("song_converted"),
    conversionId: z.string(),
    deckId: z.string(),
    deckName: z.string(),
    rows: z.number(),
    shows: z.number(),
    warnings: z.array(z.string()),
  }),
  z.object({
    type: z.literal("song_convert_undone"),
    conversionId: z.string(),
    songId: z.string(),
    restoredShows: z.number(),
    skippedShows: z.number(),
  }),
  // [/P3.4]
  // [P3.12] a convert failed and its rollback failed too: Undo with this id finishes the cleanup
  z.object({
    type: z.literal("song_convert_failed"),
    conversionId: z.string(),
    songId: z.string(),
    message: z.string(),
  }),
  // [/P3.12]
  // [P2b.33] stage layout
  z.object({
    type: z.literal("stage_layout_status"),
    screens: z.array(
      z.object({
        channel: z.string(),
        layoutId: z.string().optional(),
        reason: z.enum(["manual", "item", "default", "rule:song", "rule:scripture", "rule:slides", "rule:graphic", "rule:video"]),
        manual: z.string().nullable(),
      }),
    ),
  }),
  // [/P2b.33]
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PcoLiveStateMessage = Extract<ServerMessage, { type: "pco_live_state" }>;

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

const KNOWN_SERVER_TYPES = new Set<string>(
  ServerMessageSchema.options.map((o) => o.shape.type.value),
);

/**
 * Like {@link decodeServer}, but returns null for a message type this build
 * doesn't know — so a client older than the server (e.g. a separately
 * installed Companion module) skips new messages instead of logging a decode
 * error for each one. Malformed messages of a KNOWN type still throw.
 */
export function decodeServerTolerant(raw: string): ServerMessage | null {
  const json: unknown = JSON.parse(raw);
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !KNOWN_SERVER_TYPES.has(type)) return null;
  return ServerMessageSchema.parse(json);
}

export type { TemplateMeta };
