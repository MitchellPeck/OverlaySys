// Supabase-backed StorageAdapter. Lives here (not in apps/operator)
// because both the browser-side cloud operator and the desktop Electron
// server need to reconcile against the same backend, so the wiring has
// to be platform-agnostic. Callers instantiate with their own
// `OverlaySysSupabaseClient` — browser builds use the anon client
// hydrated from a session; the desktop server uses a Node-side anon
// client with the user's tokens applied via `setSession`.

import {
  ChannelConfigSchema,
  DeckSchema,
  MediaItemSchema,
  HotcardSchema,
  PcoItemMappingSchema,
  ProjectChannelOverrideSchema,
  ProjectSchema,
  ShowSchema,
  SongSchema,
  StageLayoutSchema,
  TemplateSchema,
  type ChannelConfig,
  type Deck,
  type MediaItem,
  type Hotcard,
  type PcoItemMapping,
  type Project,
  type ProjectChannelOverride,
  type Show,
  type Song,
  type StageLayout,
  type StorageAdapter,
  type Template,
} from "@overlaysys/core";
import type { Database, Json } from "./database.types";
import type { OverlaySysSupabaseClient } from "./index";
import {
  hotkeyFromColumn,
  hotkeyToColumn,
  showExtra,
  showInputsFromRow,
  withOptionalColumn,
  type OptionalColumn,
} from "./optionalColumns";

/** The JSON-payload tables (`id, org_id, payload, updated_at, deleted_at`). */
type PayloadTable =
  | "songs"
  | "templates"
  | "stage_layouts"
  | "channel_configs"
  | "decks"
  | "pco_item_mappings"
  | "media_items";

const SHOW_COLUMNS = "id, project_id, name, rows, updated_at, deleted_at";
const HOTCARD_COLUMNS = "id, project_id, name, template_id, data, channel_hint, notes, updated_at, deleted_at";
function showSelect(withExtra: boolean): string {
  return withExtra ? `${SHOW_COLUMNS}, extra` : SHOW_COLUMNS;
}
function hotcardSelect(withHotkey: boolean): string {
  return withHotkey ? `${HOTCARD_COLUMNS}, hotkey` : HOTCARD_COLUMNS;
}

/**
 * StorageAdapter implementation backed by apps-portal's Supabase. Differs
 * from the loose helpers in apps/operator/src/lib/cloudData.ts in three
 * ways: tombstone-inclusive `list*Since` variants for the sync engine,
 * soft-delete semantics (stamp `deleted_at` instead of unlinking), and
 * the orgId is passed in per call rather than read from a singleton.
 *
 * Construct with whichever Supabase client your runtime has wired up:
 *
 *   const adapter = new CloudStorageAdapter(getCloudClient());
 *
 * The adapter is otherwise stateless — fresh instantiations are cheap.
 */
export class CloudStorageAdapter implements StorageAdapter {
  constructor(private readonly client: OverlaySysSupabaseClient) {}

  /**
   * Optional cloud columns this org's schema turned out not to have
   * (apps-portal migration not applied yet). Queries skip them from then
   * on; see `withOptionalColumn`.
   */
  private missingColumns = new Set<OptionalColumn>();

  // ── Projects ───────────────────────────────────────────────────────────

  async listProjects(orgId: string): Promise<Project[]> {
    return this.queryProjects(orgId, false);
  }
  async listProjectsSince(orgId: string, _watermark: string): Promise<Project[]> {
    void _watermark;
    return this.queryProjects(orgId, true);
  }
  async getProject(orgId: string, id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, name, notes, song_custom_field_schema, created_at, updated_at, deleted_at")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToProject(data) : null;
  }
  async saveProject(orgId: string, project: Project): Promise<void> {
    const { error } = await this.client.from("projects").upsert(
      [
        {
          id: project.id,
          org_id: orgId,
          name: project.name,
          notes: project.notes ?? null,
          song_custom_field_schema: project.songCustomFieldSchema ?? null,
          created_at: project.createdAt,
          ...(project.updatedAt ? { updated_at: project.updatedAt } : {}),
          deleted_at: project.deletedAt ?? null,
        },
      ],
      { onConflict: "org_id,id" },
    );
    if (error) throw error;
  }
  async deleteProject(orgId: string, id: string): Promise<boolean> {
    const { error } = await this.client
      .from("projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
    return true;
  }
  private async queryProjects(
    orgId: string,
    includeTombstones: boolean,
  ): Promise<Project[]> {
    let q = this.client
      .from("projects")
      .select("id, name, notes, song_custom_field_schema, created_at, updated_at, deleted_at")
      .eq("org_id", orgId);
    if (!includeTombstones) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToProject);
  }

  // ── Shows ──────────────────────────────────────────────────────────────

  async listShows(orgId: string, projectId?: string): Promise<Show[]> {
    return this.queryShows(orgId, false, projectId);
  }
  async listShowsSince(orgId: string, _watermark: string): Promise<Show[]> {
    void _watermark;
    return this.queryShows(orgId, true);
  }
  async getShow(orgId: string, id: string): Promise<Show | null> {
    const { data, error } = await withOptionalColumn(this.missingColumns, "shows.extra", (include) =>
      this.client
        .from("shows")
        .select(showSelect(include))
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle(),
    );
    if (error) throw error;
    return data ? rowToShow(data as unknown as ShowRow) : null;
  }
  async saveShow(orgId: string, show: Show): Promise<void> {
    const { error } = await withOptionalColumn(this.missingColumns, "shows.extra", (include) =>
      this.client.from("shows").upsert(
        [
          {
            id: show.id,
            org_id: orgId,
            project_id: show.projectId,
            name: show.name,
            rows: show.rows as unknown as Json,
            ...(include ? { extra: showExtra(show) as unknown as Json } : {}),
            ...(show.updatedAt ? { updated_at: show.updatedAt } : {}),
            deleted_at: show.deletedAt ?? null,
          },
        ],
        { onConflict: "org_id,id" },
      ),
    );
    if (error) throw error;
  }
  async deleteShow(orgId: string, id: string): Promise<boolean> {
    const { error } = await this.client
      .from("shows")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
    return true;
  }
  private async queryShows(
    orgId: string,
    includeTombstones: boolean,
    projectId?: string,
  ): Promise<Show[]> {
    const { data, error } = await withOptionalColumn(this.missingColumns, "shows.extra", (include) => {
      let q = this.client.from("shows").select(showSelect(include)).eq("org_id", orgId);
      if (projectId) q = q.eq("project_id", projectId);
      if (!includeTombstones) q = q.is("deleted_at", null);
      return q;
    });
    if (error) throw error;
    return ((data ?? []) as unknown as ShowRow[]).map(rowToShow);
  }

  // ── Hotcards ───────────────────────────────────────────────────────────

  async listHotcards(orgId: string, projectId?: string): Promise<Hotcard[]> {
    return this.queryHotcards(orgId, false, projectId);
  }
  async listHotcardsSince(orgId: string, _watermark: string): Promise<Hotcard[]> {
    void _watermark;
    return this.queryHotcards(orgId, true);
  }
  async getHotcard(orgId: string, id: string): Promise<Hotcard | null> {
    const { data, error } = await withOptionalColumn(this.missingColumns, "hotcards.hotkey", (include) =>
      this.client
        .from("hotcards")
        .select(hotcardSelect(include))
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle(),
    );
    if (error) throw error;
    return data ? rowToHotcard(data as unknown as HotcardRow) : null;
  }
  async saveHotcard(orgId: string, hotcard: Hotcard): Promise<void> {
    const { error } = await withOptionalColumn(this.missingColumns, "hotcards.hotkey", (include) =>
      this.client.from("hotcards").upsert(
        [
          {
            id: hotcard.id,
            org_id: orgId,
            project_id: hotcard.projectId,
            name: hotcard.name,
            template_id: hotcard.templateId,
            data: hotcard.data as unknown as Json,
            channel_hint: hotcard.channelHint ?? null,
            notes: hotcard.notes ?? null,
            ...(include ? { hotkey: hotkeyToColumn(hotcard.hotkey) } : {}),
            ...(hotcard.updatedAt ? { updated_at: hotcard.updatedAt } : {}),
            deleted_at: hotcard.deletedAt ?? null,
          },
        ],
        { onConflict: "org_id,id" },
      ),
    );
    if (error) throw error;
  }
  async deleteHotcard(orgId: string, id: string): Promise<boolean> {
    const { error } = await this.client
      .from("hotcards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
    return true;
  }
  private async queryHotcards(
    orgId: string,
    includeTombstones: boolean,
    projectId?: string,
  ): Promise<Hotcard[]> {
    const { data, error } = await withOptionalColumn(this.missingColumns, "hotcards.hotkey", (include) => {
      let q = this.client.from("hotcards").select(hotcardSelect(include)).eq("org_id", orgId);
      if (projectId) q = q.eq("project_id", projectId);
      if (!includeTombstones) q = q.is("deleted_at", null);
      return q;
    });
    if (error) throw error;
    return ((data ?? []) as unknown as HotcardRow[]).map(rowToHotcard);
  }

  // ── JSON-payload tables (songs, templates, stage_layouts, decks, …) ────

  async listSongs(orgId: string): Promise<Song[]> {
    return this.queryPayloadTable(orgId, "songs", false, SongSchema);
  }
  async listSongsSince(orgId: string, _watermark: string): Promise<Song[]> {
    void _watermark;
    return this.queryPayloadTable(orgId, "songs", true, SongSchema);
  }
  async getSong(orgId: string, id: string): Promise<Song | null> {
    return this.getPayload(orgId, "songs", id, SongSchema);
  }
  async saveSong(orgId: string, song: Song): Promise<void> {
    return this.savePayload(orgId, "songs", song);
  }
  async deleteSong(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "songs", id);
  }

  async listTemplates(orgId: string): Promise<Template[]> {
    return this.queryPayloadTable(orgId, "templates", false, TemplateSchema);
  }
  async listTemplatesSince(orgId: string, _watermark: string): Promise<Template[]> {
    void _watermark;
    return this.queryPayloadTable(orgId, "templates", true, TemplateSchema);
  }
  async getTemplate(orgId: string, id: string): Promise<Template | null> {
    return this.getPayload(orgId, "templates", id, TemplateSchema);
  }
  async saveTemplate(orgId: string, template: Template): Promise<void> {
    return this.savePayload(orgId, "templates", template);
  }
  async deleteTemplate(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "templates", id);
  }

  async listStageLayouts(orgId: string): Promise<StageLayout[]> {
    return this.queryPayloadTable(orgId, "stage_layouts", false, StageLayoutSchema);
  }
  async listStageLayoutsSince(orgId: string, _watermark: string): Promise<StageLayout[]> {
    void _watermark;
    return this.queryPayloadTable(orgId, "stage_layouts", true, StageLayoutSchema);
  }
  async getStageLayout(orgId: string, id: string): Promise<StageLayout | null> {
    return this.getPayload(orgId, "stage_layouts", id, StageLayoutSchema);
  }
  async saveStageLayout(orgId: string, l: StageLayout): Promise<void> {
    return this.savePayload(orgId, "stage_layouts", l);
  }
  async deleteStageLayout(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "stage_layouts", id);
  }

  async listDecks(orgId: string): Promise<Deck[]> {
    return this.queryPayloadTable(orgId, "decks", false, DeckSchema);
  }
  async listDecksSince(orgId: string, _watermark: string): Promise<Deck[]> {
    void _watermark;
    return this.queryPayloadTable(orgId, "decks", true, DeckSchema);
  }
  async getDeck(orgId: string, id: string): Promise<Deck | null> {
    return this.getPayload(orgId, "decks", id, DeckSchema);
  }
  async saveDeck(orgId: string, d: Deck): Promise<void> {
    return this.savePayload(orgId, "decks", d);
  }
  async deleteDeck(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "decks", id);
  }

  // ── Media library (optional table; docs/cloud-media-sync-migration.md) ──
  async listMediaItems(orgId: string): Promise<MediaItem[]> {
    return this.queryPayloadTable(orgId, "media_items", false, MediaItemSchema);
  }
  async listMediaItemsSince(orgId: string, _watermark: string): Promise<MediaItem[]> {
    return this.queryPayloadTable(orgId, "media_items", true, MediaItemSchema);
  }
  async getMediaItem(orgId: string, id: string): Promise<MediaItem | null> {
    return this.getPayload(orgId, "media_items", id, MediaItemSchema);
  }
  async saveMediaItem(orgId: string, m: MediaItem): Promise<void> {
    return this.savePayload(orgId, "media_items", m);
  }
  async deleteMediaItem(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "media_items", id);
  }

  async listPcoItemMappings(orgId: string): Promise<PcoItemMapping[]> {
    return this.queryPayloadTable(orgId, "pco_item_mappings", false, PcoItemMappingSchema);
  }
  async listPcoItemMappingsSince(orgId: string, _watermark: string): Promise<PcoItemMapping[]> {
    void _watermark;
    return this.queryPayloadTable(orgId, "pco_item_mappings", true, PcoItemMappingSchema);
  }
  async savePcoItemMapping(orgId: string, m: PcoItemMapping): Promise<void> {
    return this.savePayload(orgId, "pco_item_mappings", m);
  }
  async deletePcoItemMapping(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "pco_item_mappings", id);
  }

  async listChannelConfigs(orgId: string): Promise<ChannelConfig[]> {
    return this.queryPayloadTable(
      orgId,
      "channel_configs",
      false,
      ChannelConfigSchema,
    );
  }
  async listChannelConfigsSince(
    orgId: string,
    _watermark: string,
  ): Promise<ChannelConfig[]> {
    void _watermark;
    return this.queryPayloadTable(
      orgId,
      "channel_configs",
      true,
      ChannelConfigSchema,
    );
  }
  async getChannelConfig(orgId: string, id: string): Promise<ChannelConfig | null> {
    return this.getPayload(orgId, "channel_configs", id, ChannelConfigSchema);
  }
  async saveChannelConfig(orgId: string, config: ChannelConfig): Promise<void> {
    return this.savePayload(orgId, "channel_configs", config);
  }
  async deleteChannelConfig(orgId: string, id: string): Promise<boolean> {
    return this.softDeletePayload(orgId, "channel_configs", id);
  }

  // ── Project channel overrides ──────────────────────────────────────────

  async listProjectChannelOverrides(
    orgId: string,
    projectId?: string,
  ): Promise<ProjectChannelOverride[]> {
    return this.queryOverrides(orgId, false, projectId);
  }
  async listProjectChannelOverridesSince(
    orgId: string,
    _watermark: string,
  ): Promise<ProjectChannelOverride[]> {
    void _watermark;
    return this.queryOverrides(orgId, true);
  }
  async saveProjectChannelOverride(
    orgId: string,
    override: ProjectChannelOverride,
  ): Promise<void> {
    const { error } = await this.client.from("project_channel_overrides").upsert(
      [
        {
          org_id: orgId,
          project_id: override.projectId,
          channel_id: override.channelId,
          payload: override as unknown as Database["overlaysys"]["Tables"]["project_channel_overrides"]["Row"]["payload"],
          ...(override.updatedAt ? { updated_at: override.updatedAt } : {}),
          deleted_at: override.deletedAt ?? null,
        },
      ],
      { onConflict: "org_id,project_id,channel_id" },
    );
    if (error) throw error;
  }
  async deleteProjectChannelOverride(
    orgId: string,
    projectId: string,
    channelId: string,
  ): Promise<boolean> {
    const { error } = await this.client
      .from("project_channel_overrides")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("channel_id", channelId);
    if (error) throw error;
    return true;
  }
  private async queryOverrides(
    orgId: string,
    includeTombstones: boolean,
    projectId?: string,
  ): Promise<ProjectChannelOverride[]> {
    let q = this.client
      .from("project_channel_overrides")
      .select("project_id, channel_id, payload, updated_at, deleted_at")
      .eq("org_id", orgId);
    if (projectId) q = q.eq("project_id", projectId);
    if (!includeTombstones) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? [])
      .map((row): ProjectChannelOverride | null => {
        const parsed = ProjectChannelOverrideSchema.safeParse(row.payload);
        if (!parsed.success) return null;
        return {
          ...parsed.data,
          updatedAt: isoZ(row.updated_at),
          deletedAt: row.deleted_at ?? undefined,
        };
      })
      .filter((o): o is ProjectChannelOverride => o !== null);
  }

  // ── Assets — passthrough; sync engine doesn't touch them yet ──────────

  async putAsset(): Promise<void> {
    throw new Error(
      "CloudStorageAdapter.putAsset not implemented — asset bundling stays in cloudData.ts for now",
    );
  }
  async hasAsset(): Promise<boolean> {
    return false;
  }
  async getAssetUrl(): Promise<string | null> {
    return null;
  }

  // ── Generic helpers for the JSON-payload tables ───────────────────────

  private async queryPayloadTable<T>(
    orgId: string,
    table: PayloadTable,
    includeTombstones: boolean,
    schema: { safeParse: (raw: unknown) => { success: boolean; data?: T } },
  ): Promise<T[]> {
    let q = this.client
      .from(table)
      .select("id, payload, updated_at, deleted_at")
      .eq("org_id", orgId);
    if (!includeTombstones) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? [])
      .map((row): T | null => {
        const parsed = schema.safeParse(row.payload);
        if (!parsed.success || !parsed.data) return null;
        return {
          ...parsed.data,
          updatedAt: isoZ(row.updated_at),
          deletedAt: row.deleted_at ?? undefined,
        } as T;
      })
      .filter((x): x is T => x !== null);
  }

  private async getPayload<T>(
    orgId: string,
    table: PayloadTable,
    id: string,
    schema: { safeParse: (raw: unknown) => { success: boolean; data?: T } },
  ): Promise<T | null> {
    const { data, error } = await this.client
      .from(table)
      .select("id, payload, updated_at, deleted_at")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const parsed = schema.safeParse(data.payload);
    if (!parsed.success || !parsed.data) return null;
    return {
      ...parsed.data,
      updatedAt: isoZ(data.updated_at),
      deletedAt: data.deleted_at ?? undefined,
    } as T;
  }

  private async savePayload(
    orgId: string,
    table: PayloadTable,
    entity: { id: string; updatedAt?: string; deletedAt?: string },
  ): Promise<void> {
    const { error } = await this.client.from(table).upsert(
      [
        {
          id: entity.id,
          org_id: orgId,
          payload: entity as unknown as Database["overlaysys"]["Tables"]["songs"]["Row"]["payload"],
          ...(entity.updatedAt ? { updated_at: entity.updatedAt } : {}),
          deleted_at: entity.deletedAt ?? null,
        },
      ],
      { onConflict: "org_id,id" },
    );
    if (error) throw error;
  }

  private async softDeletePayload(
    orgId: string,
    table: PayloadTable,
    id: string,
  ): Promise<boolean> {
    const { error } = await this.client
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
    return true;
  }
}

// ── Row → core type converters ───────────────────────────────────────────

/**
 * PostgREST renders timestamptz as `2026-08-29T12:00:00+00:00`; every
 * on-disk write uses JS `toISOString()` (`…00.000Z`). Normalise on the way
 * in so the two replicas spell one instant the same way — the sync engine
 * compares instants regardless, but logs, overwrite reports and anything
 * that round-trips the value back into a payload stay consistent.
 */
function isoZ(ts: string): string {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString() : ts;
}

function rowToProject(row: {
  id: string;
  name: string;
  notes: string | null;
  song_custom_field_schema: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): Project {
  // jsonb comes back untyped. Validate against the same schema the rest
  // of the app reads it through rather than trusting the column — a row
  // written before 0010, or by hand, parses as undefined and the field
  // is simply omitted (which is what legacy projects expect anyway).
  const fields = ProjectSchema.shape.songCustomFieldSchema.safeParse(
    row.song_custom_field_schema ?? undefined,
  );
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: isoZ(row.updated_at),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(fields.success && fields.data
      ? { songCustomFieldSchema: fields.data }
      : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

interface ShowRow {
  id: string;
  project_id: string;
  name: string;
  rows: unknown;
  /** Absent when the cloud has no `extra` column yet; null on rows written before it. */
  extra?: unknown;
  updated_at: string;
  deleted_at: string | null;
}

const warnedUnreadableShows = new Set<string>();

function rowToShow(row: ShowRow): Show {
  // `extra` spreads under the columned fields; a null `extra` reads as a
  // show from before the column (songs []). If `extra` holds something the
  // schema rejects, fall back to the columned fields alone.
  let base: Show | null = null;
  for (const input of showInputsFromRow(row)) {
    const parsed = ShowSchema.safeParse(input);
    if (parsed.success) {
      base = parsed.data;
      break;
    }
  }
  if (!base) {
    // The cloud copy holds rows this build can't read (e.g. a row kind from a
    // newer build). The fallback has `rows: []`; the sync engine refuses to
    // pull an emptied show over a non-empty local one (showPullLossReason).
    if (Array.isArray(row.rows) && row.rows.length > 0 && !warnedUnreadableShows.has(row.id)) {
      warnedUnreadableShows.add(row.id);
      console.warn(`[cloud] show ${row.id}: ${row.rows.length} row(s) unreadable by this build; read as empty`);
    }
    base = {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      rows: [],
      songs: [],
    };
  }
  return {
    ...base,
    updatedAt: isoZ(row.updated_at),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

interface HotcardRow {
  id: string;
  project_id: string;
  name: string;
  template_id: string;
  data: unknown;
  channel_hint: string | null;
  notes: string | null;
  /** Absent when the cloud has no `hotkey` column yet. */
  hotkey?: string | null;
  updated_at: string;
  deleted_at: string | null;
}

function rowToHotcard(row: HotcardRow): Hotcard {
  const hotkey = hotkeyFromColumn(row.hotkey ?? null);
  const parsed = HotcardSchema.safeParse({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    templateId: row.template_id,
    data: row.data,
    ...(row.channel_hint ? { channelHint: row.channel_hint } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(hotkey !== undefined ? { hotkey } : {}),
  });
  const base: Hotcard = parsed.success
    ? parsed.data
    : {
        id: row.id,
        name: row.name,
        projectId: row.project_id,
        templateId: row.template_id,
        data: {},
      };
  return {
    ...base,
    updatedAt: isoZ(row.updated_at),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}
