import {
  ChannelConfigSchema,
  ProjectChannelOverrideSchema,
  type ChannelConfig,
  type ProjectChannelOverride,
} from "./channelConfig";
import { HotcardSchema, type Hotcard } from "./hotcard";
import { ProjectSchema, type Project } from "./project";
import { ShowSchema, type Show } from "./show";
import { SongSchema, type Song } from "./song";
import { TemplateSchema, type Template } from "./template";
import type { StorageAdapter } from "./storageAdapter";

/**
 * A {@link StorageAdapter} backed by Ovation's overlay sync API.
 *
 * This replaces the direct-to-Supabase `CloudStorageAdapter`. The canonical
 * store is now the `overlay` database inside Ovation's Supabase project, which
 * PostgREST does not serve — so the operator reaches it over Ovation's HTTP
 * sync surface instead of a database client. The practical win is that the
 * overlay database credentials never leave Ovation's API; an operator machine
 * only ever holds a workspace-scoped key.
 *
 * The `orgId` argument every StorageAdapter method takes is the Ovation
 * **workspace id** here. Nothing else in the sync engine changes: it still sees
 * an adapter with the same shape, so `sync()`, tombstone propagation, and
 * last-writer-wins all work unmodified.
 */

/** Entities the sync API exposes; mirrors Ovation's `OverlaySyncEntity`. */
export type OvationSyncEntity =
  | "projects"
  | "shows"
  | "hotcards"
  | "songs"
  | "templates"
  | "channel_configs"
  | "project_channel_overrides";

/** A record as carried over the sync wire. */
export interface OvationSyncRecord {
  id: string;
  updatedAt: string;
  deletedAt?: string | null;
  projectId?: string;
  channelId?: string;
  payload: Record<string, unknown>;
}

export interface OvationCloudConfig {
  /** Ovation API base, e.g. `https://api.ovation-os.com`. No trailing slash. */
  baseUrl: string;
  /** The operator key issued from the workspace's OverlaySys settings. */
  operatorKey: string;
  /** Optional injection point for tests / non-browser runtimes. */
  fetchImpl?: typeof fetch;
}

export class OvationCloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly entity?: string,
  ) {
    super(message);
    this.name = "OvationCloudError";
  }
}

/** Page size per pull request. The API caps this at 2000. */
const PAGE_SIZE = 500;

export class OvationCloudStorageAdapter implements StorageAdapter {
  private readonly baseUrl: string;
  private readonly operatorKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OvationCloudConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.operatorKey = config.operatorKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { "x-overlay-key": this.operatorKey };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      let message = `Ovation sync ${method} ${path} failed (${res.status})`;
      try {
        const err = (await res.json()) as { message?: string };
        if (err?.message) message = err.message;
      } catch {
        // Non-JSON error body — keep the status-derived message.
      }
      throw new OvationCloudError(message, res.status);
    }
    return (await res.json()) as T;
  }

  /**
   * Confirm the key works and learn which workspace it belongs to. Called by
   * the operator UI before saving a connection so a bad key fails loudly at
   * setup rather than silently at the next sync pass.
   */
  async hello(workspaceId: string): Promise<{
    workspace_id: string;
    workspace_name: string;
    default_channel: string;
  }> {
    return this.request(
      "GET",
      `/workspaces/${encodeURIComponent(workspaceId)}/overlay/sync/hello`,
    );
  }

  /**
   * Pull every record changed after `since`, following the watermark until the
   * API returns a short page. Tombstones are included — the sync engine needs
   * them to propagate deletions.
   */
  private async pull(
    workspaceId: string,
    entity: OvationSyncEntity,
    since: string,
  ): Promise<OvationSyncRecord[]> {
    const out: OvationSyncRecord[] = [];
    let watermark = since ?? "";

    // Bounded so a server that never advances its watermark can't spin forever.
    for (let page = 0; page < 100; page++) {
      const q = `since=${encodeURIComponent(watermark)}&limit=${PAGE_SIZE}`;
      const res = await this.request<{
        records: OvationSyncRecord[];
        watermark: string | null;
      }>(
        "GET",
        `/workspaces/${encodeURIComponent(workspaceId)}/overlay/sync/${entity}?${q}`,
      );

      out.push(...res.records);
      if (res.records.length < PAGE_SIZE || !res.watermark) break;
      // No progress means the page is full of records sharing one timestamp;
      // stop rather than request the same page forever.
      if (res.watermark === watermark) break;
      watermark = res.watermark;
    }

    return out;
  }

  private async push(
    workspaceId: string,
    entity: OvationSyncEntity,
    records: OvationSyncRecord[],
  ): Promise<void> {
    await this.request(
      "POST",
      `/workspaces/${encodeURIComponent(workspaceId)}/overlay/sync/${entity}`,
      { records },
    );
  }

  // ── Decoding ─────────────────────────────────────────────────────────────

  /**
   * Parse a wire record into a domain entity, re-merging the transport-level
   * `updatedAt`/`deletedAt` so a record is dated even when the payload omits
   * them. Records that fail validation are dropped rather than throwing: one
   * malformed row upstream shouldn't abort an entire sync pass.
   */
  private decode<T>(
    records: OvationSyncRecord[],
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  ): T[] {
    const out: T[] = [];
    for (const rec of records) {
      const candidate = {
        ...rec.payload,
        updatedAt: rec.updatedAt,
        ...(rec.deletedAt ? { deletedAt: rec.deletedAt } : {}),
      };
      const parsed = schema.safeParse(candidate);
      if (parsed.success && parsed.data !== undefined) out.push(parsed.data);
    }
    return out;
  }

  /** `list*` hides tombstones; `list*Since` includes them (see StorageAdapter). */
  private live<T extends { deletedAt?: string }>(items: T[]): T[] {
    return items.filter((i) => !i.deletedAt);
  }

  private toRecord(
    entity: { id: string; updatedAt?: string; deletedAt?: string },
    extra?: { projectId?: string; channelId?: string },
  ): OvationSyncRecord {
    return {
      id: entity.id,
      // The writer owns this value — it is what last-writer-wins compares.
      updatedAt: entity.updatedAt ?? new Date().toISOString(),
      ...(entity.deletedAt ? { deletedAt: entity.deletedAt } : {}),
      ...(extra?.projectId ? { projectId: extra.projectId } : {}),
      ...(extra?.channelId ? { channelId: extra.channelId } : {}),
      payload: entity as unknown as Record<string, unknown>,
    };
  }

  /**
   * Soft-delete: fetch the record, stamp a tombstone, push it back. Returns
   * false when there is nothing to delete, matching the FS adapter.
   */
  private async tombstone(
    workspaceId: string,
    entity: OvationSyncEntity,
    id: string,
  ): Promise<boolean> {
    const all = await this.pull(workspaceId, entity, "");
    const existing = all.find((r) => r.id === id);
    if (!existing || existing.deletedAt) return false;

    const now = new Date().toISOString();
    await this.push(workspaceId, entity, [
      {
        ...existing,
        updatedAt: now,
        deletedAt: now,
        payload: { ...existing.payload, updatedAt: now, deletedAt: now },
      },
    ]);
    return true;
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  async listProjects(orgId: string): Promise<Project[]> {
    return this.live(await this.listProjectsSince(orgId, ""));
  }
  async listProjectsSince(orgId: string, watermark: string): Promise<Project[]> {
    return this.decode<Project>(
      await this.pull(orgId, "projects", watermark),
      ProjectSchema,
    );
  }
  async getProject(orgId: string, id: string): Promise<Project | null> {
    return (await this.listProjects(orgId)).find((p) => p.id === id) ?? null;
  }
  async saveProject(orgId: string, project: Project): Promise<void> {
    await this.push(orgId, "projects", [this.toRecord(project)]);
  }
  async deleteProject(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "projects", id);
  }

  // ── Shows ────────────────────────────────────────────────────────────────

  async listShows(orgId: string, projectId?: string): Promise<Show[]> {
    const shows = this.live(await this.listShowsSince(orgId, ""));
    return projectId ? shows.filter((s) => s.projectId === projectId) : shows;
  }
  async listShowsSince(orgId: string, watermark: string): Promise<Show[]> {
    return this.decode<Show>(await this.pull(orgId, "shows", watermark), ShowSchema);
  }
  async getShow(orgId: string, id: string): Promise<Show | null> {
    return (await this.listShows(orgId)).find((s) => s.id === id) ?? null;
  }
  async saveShow(orgId: string, show: Show): Promise<void> {
    await this.push(orgId, "shows", [
      this.toRecord(show, { projectId: show.projectId }),
    ]);
  }
  async deleteShow(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "shows", id);
  }

  // ── Hotcards ─────────────────────────────────────────────────────────────

  async listHotcards(orgId: string, projectId?: string): Promise<Hotcard[]> {
    const cards = this.live(await this.listHotcardsSince(orgId, ""));
    return projectId ? cards.filter((h) => h.projectId === projectId) : cards;
  }
  async listHotcardsSince(orgId: string, watermark: string): Promise<Hotcard[]> {
    return this.decode<Hotcard>(
      await this.pull(orgId, "hotcards", watermark),
      HotcardSchema,
    );
  }
  async getHotcard(orgId: string, id: string): Promise<Hotcard | null> {
    return (await this.listHotcards(orgId)).find((h) => h.id === id) ?? null;
  }
  async saveHotcard(orgId: string, hotcard: Hotcard): Promise<void> {
    await this.push(orgId, "hotcards", [
      this.toRecord(hotcard, { projectId: hotcard.projectId }),
    ]);
  }
  async deleteHotcard(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "hotcards", id);
  }

  // ── Songs (workspace library) ────────────────────────────────────────────

  async listSongs(orgId: string): Promise<Song[]> {
    return this.live(await this.listSongsSince(orgId, ""));
  }
  async listSongsSince(orgId: string, watermark: string): Promise<Song[]> {
    return this.decode<Song>(await this.pull(orgId, "songs", watermark), SongSchema);
  }
  async getSong(orgId: string, id: string): Promise<Song | null> {
    return (await this.listSongs(orgId)).find((s) => s.id === id) ?? null;
  }
  async saveSong(orgId: string, song: Song): Promise<void> {
    await this.push(orgId, "songs", [this.toRecord(song)]);
  }
  async deleteSong(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "songs", id);
  }

  // ── Templates (workspace library) ────────────────────────────────────────

  async listTemplates(orgId: string): Promise<Template[]> {
    return this.live(await this.listTemplatesSince(orgId, ""));
  }
  async listTemplatesSince(orgId: string, watermark: string): Promise<Template[]> {
    return this.decode<Template>(
      await this.pull(orgId, "templates", watermark),
      TemplateSchema,
    );
  }
  async getTemplate(orgId: string, id: string): Promise<Template | null> {
    return (await this.listTemplates(orgId)).find((t) => t.id === id) ?? null;
  }
  async saveTemplate(orgId: string, template: Template): Promise<void> {
    await this.push(orgId, "templates", [this.toRecord(template)]);
  }
  async deleteTemplate(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "templates", id);
  }

  // ── Channel configs ──────────────────────────────────────────────────────

  async listChannelConfigs(orgId: string): Promise<ChannelConfig[]> {
    return this.live(await this.listChannelConfigsSince(orgId, ""));
  }
  async listChannelConfigsSince(
    orgId: string,
    watermark: string,
  ): Promise<ChannelConfig[]> {
    return this.decode<ChannelConfig>(
      await this.pull(orgId, "channel_configs", watermark),
      ChannelConfigSchema,
    );
  }
  async getChannelConfig(orgId: string, id: string): Promise<ChannelConfig | null> {
    return (await this.listChannelConfigs(orgId)).find((c) => c.id === id) ?? null;
  }
  async saveChannelConfig(orgId: string, config: ChannelConfig): Promise<void> {
    await this.push(orgId, "channel_configs", [this.toRecord(config)]);
  }
  async deleteChannelConfig(orgId: string, id: string): Promise<boolean> {
    return this.tombstone(orgId, "channel_configs", id);
  }

  // ── Project channel overrides ────────────────────────────────────────────
  //
  // Keyed by `(projectId, channelId)`, transported with the composite id
  // `${projectId}:${channelId}` that Ovation's sync API emits.

  async listProjectChannelOverrides(
    orgId: string,
    projectId?: string,
  ): Promise<ProjectChannelOverride[]> {
    const all = this.live(await this.listProjectChannelOverridesSince(orgId, ""));
    return projectId ? all.filter((o) => o.projectId === projectId) : all;
  }
  async listProjectChannelOverridesSince(
    orgId: string,
    watermark: string,
  ): Promise<ProjectChannelOverride[]> {
    const records = await this.pull(orgId, "project_channel_overrides", watermark);
    // The payload may omit the key parts; the record always carries them.
    const hydrated = records.map((r) => ({
      ...r,
      payload: {
        ...r.payload,
        ...(r.projectId ? { projectId: r.projectId } : {}),
        ...(r.channelId ? { channelId: r.channelId } : {}),
      },
    }));
    return this.decode<ProjectChannelOverride>(
      hydrated,
      ProjectChannelOverrideSchema,
    );
  }
  async saveProjectChannelOverride(
    orgId: string,
    override: ProjectChannelOverride,
  ): Promise<void> {
    await this.push(orgId, "project_channel_overrides", [
      {
        id: `${override.projectId}:${override.channelId}`,
        updatedAt: override.updatedAt ?? new Date().toISOString(),
        ...(override.deletedAt ? { deletedAt: override.deletedAt } : {}),
        projectId: override.projectId,
        channelId: override.channelId,
        payload: override as unknown as Record<string, unknown>,
      },
    ]);
  }
  async deleteProjectChannelOverride(
    orgId: string,
    projectId: string,
    channelId: string,
  ): Promise<boolean> {
    return this.tombstone(
      orgId,
      "project_channel_overrides",
      `${projectId}:${channelId}`,
    );
  }

  // ── Assets ───────────────────────────────────────────────────────────────
  //
  // Assets are not sync-tracked (content-addressed filenames make them
  // write-once), and the bytes live in Supabase Storage on Ovation's primary
  // project rather than behind the sync API. Mirrors the previous cloud
  // adapter, which also left these unimplemented.

  async putAsset(): Promise<void> {
    throw new Error("putAsset is not implemented for the Ovation cloud adapter");
  }
  async hasAsset(): Promise<boolean> {
    return false;
  }
  async getAssetUrl(): Promise<string | null> {
    return null;
  }
}
