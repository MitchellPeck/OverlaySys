// Supabase-backed StorageAdapter. Lives here (not in apps/operator)
// because both the browser-side cloud operator and the desktop Electron
// server need to reconcile against the same backend, so the wiring has
// to be platform-agnostic. Callers instantiate with their own
// `OverlaySysSupabaseClient` — browser builds use the anon client
// hydrated from a session; the desktop server uses a Node-side anon
// client with the user's tokens applied via `setSession`.

import {
  ChannelConfigSchema,
  HotcardSchema,
  ProjectChannelOverrideSchema,
  ShowSchema,
  SongSchema,
  TemplateSchema,
  type ChannelConfig,
  type Hotcard,
  type Project,
  type ProjectChannelOverride,
  type Show,
  type Song,
  type StorageAdapter,
  type Template,
} from "@overlaysys/core";
import type { Database } from "./database.types";
import type { OverlaySysSupabaseClient } from "./index";

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
      .select("id, name, notes, created_at, updated_at, deleted_at")
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
      .select("id, name, notes, created_at, updated_at, deleted_at")
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
    const { data, error } = await this.client
      .from("shows")
      .select("id, project_id, name, rows, updated_at, deleted_at")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToShow(data) : null;
  }
  async saveShow(orgId: string, show: Show): Promise<void> {
    const { error } = await this.client.from("shows").upsert(
      [
        {
          id: show.id,
          org_id: orgId,
          project_id: show.projectId,
          name: show.name,
          rows: show.rows as unknown as Database["overlaysys"]["Tables"]["shows"]["Row"]["rows"],
          ...(show.updatedAt ? { updated_at: show.updatedAt } : {}),
          deleted_at: show.deletedAt ?? null,
        },
      ],
      { onConflict: "org_id,id" },
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
    let q = this.client
      .from("shows")
      .select("id, project_id, name, rows, updated_at, deleted_at")
      .eq("org_id", orgId);
    if (projectId) q = q.eq("project_id", projectId);
    if (!includeTombstones) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToShow);
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
    const { data, error } = await this.client
      .from("hotcards")
      .select(
        "id, project_id, name, template_id, data, channel_hint, notes, updated_at, deleted_at",
      )
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToHotcard(data) : null;
  }
  async saveHotcard(orgId: string, hotcard: Hotcard): Promise<void> {
    const { error } = await this.client.from("hotcards").upsert(
      [
        {
          id: hotcard.id,
          org_id: orgId,
          project_id: hotcard.projectId,
          name: hotcard.name,
          template_id: hotcard.templateId,
          data: hotcard.data as unknown as Database["overlaysys"]["Tables"]["hotcards"]["Row"]["data"],
          channel_hint: hotcard.channelHint ?? null,
          notes: hotcard.notes ?? null,
          ...(hotcard.updatedAt ? { updated_at: hotcard.updatedAt } : {}),
          deleted_at: hotcard.deletedAt ?? null,
        },
      ],
      { onConflict: "org_id,id" },
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
    let q = this.client
      .from("hotcards")
      .select(
        "id, project_id, name, template_id, data, channel_hint, notes, updated_at, deleted_at",
      )
      .eq("org_id", orgId);
    if (projectId) q = q.eq("project_id", projectId);
    if (!includeTombstones) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToHotcard);
  }

  // ── JSON-payload tables (songs, templates, channel_configs) ────────────

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
          updatedAt: row.updated_at,
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
    table: "songs" | "templates" | "channel_configs",
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
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at ?? undefined,
        } as T;
      })
      .filter((x): x is T => x !== null);
  }

  private async getPayload<T>(
    orgId: string,
    table: "songs" | "templates" | "channel_configs",
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
      updatedAt: data.updated_at,
      deletedAt: data.deleted_at ?? undefined,
    } as T;
  }

  private async savePayload(
    orgId: string,
    table: "songs" | "templates" | "channel_configs",
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
    table: "songs" | "templates" | "channel_configs",
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

function rowToProject(row: {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

function rowToShow(row: {
  id: string;
  project_id: string;
  name: string;
  rows: unknown;
  updated_at: string;
  deleted_at: string | null;
}): Show {
  const parsed = ShowSchema.safeParse({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    rows: row.rows,
    songs: [],
  });
  const base: Show = parsed.success
    ? parsed.data
    : {
        id: row.id,
        name: row.name,
        projectId: row.project_id,
        rows: [],
        songs: [],
      };
  return {
    ...base,
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

function rowToHotcard(row: {
  id: string;
  project_id: string;
  name: string;
  template_id: string;
  data: unknown;
  channel_hint: string | null;
  notes: string | null;
  updated_at: string;
  deleted_at: string | null;
}): Hotcard {
  const parsed = HotcardSchema.safeParse({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    templateId: row.template_id,
    data: row.data,
    ...(row.channel_hint ? { channelHint: row.channel_hint } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
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
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}
