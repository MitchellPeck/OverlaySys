import type { Project } from "./project";
import type { Show } from "./show";
import type { Hotcard } from "./hotcard";
import type { Song } from "./song";
import type { Template } from "./template";
import type { ChannelConfig, ProjectChannelOverride } from "./channelConfig";

/**
 * Backend-agnostic persistence interface for OverlaySys's domain entities.
 *
 * The Electron-embedded Fastify server implements this against the local
 * filesystem (see server/src/storage.ts); the web operator implements it
 * against Supabase. Both implementations are wired by the SyncEngine —
 * desktop reads/writes its local replica through this interface and the
 * engine reconciles with the cloud replica through the same interface,
 * just with a different concrete adapter.
 *
 * **Operations are scoped to a single org.** The FS implementation ignores
 * the orgId argument (single-tenant by definition); the Supabase
 * implementation uses it as the RLS scope.
 *
 * **Soft-delete semantics.** Every `delete*` method should leave a tombstone
 * (`deletedAt` timestamp set on the row) rather than removing it outright,
 * so the deletion can propagate via sync before a separate GC pass hard-
 * deletes. The `list*` methods filter tombstones by default; `list*Since`
 * variants include them so the sync engine can apply remote deletions.
 *
 * **Sync watermark.** `list*Since(orgId, watermark)` returns every entity
 * (including tombstones) whose `updatedAt` is strictly after `watermark`.
 * The watermark is an ISO timestamp; pass the empty string for an initial
 * full pull. Each list returns rows in `updatedAt` ascending order so
 * batched cursors are stable.
 */
export interface StorageAdapter {
  // ── Projects ───────────────────────────────────────────────────────────
  listProjects(orgId: string): Promise<Project[]>;
  listProjectsSince(orgId: string, watermark: string): Promise<Project[]>;
  getProject(orgId: string, id: string): Promise<Project | null>;
  saveProject(orgId: string, project: Project): Promise<void>;
  deleteProject(orgId: string, id: string): Promise<boolean>;

  // ── Shows (scoped to a project) ────────────────────────────────────────
  listShows(orgId: string, projectId?: string): Promise<Show[]>;
  listShowsSince(orgId: string, watermark: string): Promise<Show[]>;
  getShow(orgId: string, id: string): Promise<Show | null>;
  saveShow(orgId: string, show: Show): Promise<void>;
  deleteShow(orgId: string, id: string): Promise<boolean>;

  // ── Hotcards (scoped to a project) ────────────────────────────────────
  listHotcards(orgId: string, projectId?: string): Promise<Hotcard[]>;
  listHotcardsSince(orgId: string, watermark: string): Promise<Hotcard[]>;
  getHotcard(orgId: string, id: string): Promise<Hotcard | null>;
  saveHotcard(orgId: string, hotcard: Hotcard): Promise<void>;
  deleteHotcard(orgId: string, id: string): Promise<boolean>;

  // ── Songs (org library — no project scoping) ──────────────────────────
  listSongs(orgId: string): Promise<Song[]>;
  listSongsSince(orgId: string, watermark: string): Promise<Song[]>;
  getSong(orgId: string, id: string): Promise<Song | null>;
  saveSong(orgId: string, song: Song): Promise<void>;
  deleteSong(orgId: string, id: string): Promise<boolean>;

  // ── Templates (org library — no project scoping) ──────────────────────
  listTemplates(orgId: string): Promise<Template[]>;
  listTemplatesSince(orgId: string, watermark: string): Promise<Template[]>;
  getTemplate(orgId: string, id: string): Promise<Template | null>;
  saveTemplate(orgId: string, template: Template): Promise<void>;
  deleteTemplate(orgId: string, id: string): Promise<boolean>;

  // ── Channels (org library, configured online, synced to devices) ──────
  //
  // Channels are org-scoped configuration. Per-device window placement
  // (`WindowPrefsFile`) stays on each device and is intentionally NOT in
  // this interface — devices never sync window prefs to the cloud.
  listChannelConfigs(orgId: string): Promise<ChannelConfig[]>;
  listChannelConfigsSince(orgId: string, watermark: string): Promise<ChannelConfig[]>;
  getChannelConfig(orgId: string, id: string): Promise<ChannelConfig | null>;
  saveChannelConfig(orgId: string, config: ChannelConfig): Promise<void>;
  deleteChannelConfig(orgId: string, id: string): Promise<boolean>;

  // ── Project channel overrides (per-project patches) ───────────────────
  //
  // Overrides are keyed by `(projectId, channelId)`. The override's payload
  // is a partial patch over an org-default ChannelConfig; resolution is
  // performed in `channelResolution.ts`, not by the adapter.
  listProjectChannelOverrides(
    orgId: string,
    projectId?: string,
  ): Promise<ProjectChannelOverride[]>;
  listProjectChannelOverridesSince(
    orgId: string,
    watermark: string,
  ): Promise<ProjectChannelOverride[]>;
  saveProjectChannelOverride(
    orgId: string,
    override: ProjectChannelOverride,
  ): Promise<void>;
  deleteProjectChannelOverride(
    orgId: string,
    projectId: string,
    channelId: string,
  ): Promise<boolean>;

  // ── Assets — bytes addressed by sha256 ─────────────────────────────────
  //
  // The FS adapter stores them under data/assets/; the Supabase adapter
  // uses the `assets` Storage bucket with object path `<org_id>/<filename>`.
  // Assets aren't currently sync-tracked because the content-addressed
  // filename is the version — write-once, read-many.
  putAsset(
    orgId: string,
    filename: string,
    bytes: Uint8Array,
    mime?: string,
  ): Promise<void>;
  hasAsset(orgId: string, filename: string): Promise<boolean>;
  getAssetUrl(orgId: string, filename: string): Promise<string | null>;
}

/**
 * Sentinel orgId used by the local-only FS adapter. The Electron app
 * runs in single-tenant mode and never needs a real org until the user
 * pairs it to a cloud org; pass this value to satisfy the interface in
 * the meantime.
 */
export const LOCAL_ORG_ID = "local";

/**
 * Per-table sync cursor. Tracks the highest `updatedAt` value the local
 * replica has observed for each entity table. Sent up to the remote
 * adapter on each pull so the remote can stream only the delta. Stored
 * locally so a desktop coming back online after a long absence doesn't
 * re-download the entire org library.
 */
export interface SyncCursor {
  projects: string;
  shows: string;
  hotcards: string;
  songs: string;
  templates: string;
  channelConfigs: string;
  projectChannelOverrides: string;
}

/**
 * Empty initial cursor — every table starts with the unix epoch sentinel
 * so the first pull is a full sync.
 */
export const EMPTY_SYNC_CURSOR: SyncCursor = {
  projects: "",
  shows: "",
  hotcards: "",
  songs: "",
  templates: "",
  channelConfigs: "",
  projectChannelOverrides: "",
};

/**
 * A pending write that the local replica has captured but not yet pushed
 * to the remote adapter. The SyncEngine drains this queue on every push
 * pass, retries failed writes with exponential backoff, and persists the
 * queue so an Electron restart doesn't lose work.
 *
 * `payload` is the full entity body (not a patch) so push semantics stay
 * idempotent — if the same write is replayed after a partial-failure
 * crash, the result is identical.
 */
export type PendingWriteKind =
  | "project"
  | "show"
  | "hotcard"
  | "song"
  | "template"
  | "channelConfig"
  | "projectChannelOverride";

export interface PendingWrite {
  kind: PendingWriteKind;
  /** Stable identifier so retries dedupe. For overrides this is `${projectId}:${channelId}`. */
  id: string;
  op: "save" | "delete";
  /** Full entity payload for save ops; omitted for delete ops. */
  payload?: unknown;
  /** ISO timestamp captured when the local write happened. */
  capturedAt: string;
  attempts: number;
}
