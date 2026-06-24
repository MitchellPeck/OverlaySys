// Filesystem-backed StorageAdapter for the Electron-embedded server.
//
// Wraps the existing per-entity loose helpers in `./storage.ts` and the
// channel-override JSON files this adapter introduces. The wrapping
// adds two contract pieces the engine needs:
//
//   1. Soft delete. delete*() saves a tombstone (record with `deletedAt`)
//      instead of unlinking, so the engine can propagate the deletion
//      through the next sync pass. A future GC pass can hard-delete
//      tombstones older than a retention threshold.
//   2. Tombstone-inclusive list*Since variants. The existing loadAll*
//      helpers don't filter — tombstones come through naturally because
//      `deletedAt` is part of the persisted JSON. We do filter for the
//      user-facing list*() reads.

import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import {
  ProjectChannelOverrideSchema,
  type ChannelConfig,
  type Hotcard,
  type Project,
  type ProjectChannelOverride,
  type Show,
  type Song,
  type StorageAdapter,
  type Template,
} from "@overlaysys/core";
import {
  dataRoot,
  loadAllChannelConfigs,
  loadAllHotcards,
  loadAllProjects,
  loadAllShows,
  loadAllSongs,
  loadAllTemplates,
  loadChannelConfig,
  loadHotcard,
  loadProject,
  loadShow,
  loadSong,
  loadTemplate,
  saveChannelConfig,
  saveHotcard,
  saveProject,
  saveShow,
  saveSong,
  saveTemplate,
} from "./storage";

function overridesDir(): string {
  return path.join(dataRoot(), "channel_overrides");
}
function overrideFile(projectId: string, channelId: string): string {
  // Encode separators in id slugs to avoid collisions with path syntax —
  // channel ids in practice are kebab-case so this is precautionary.
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(overridesDir(), `${safe(projectId)}__${safe(channelId)}.json`);
}

/**
 * Filter live records out of an unfiltered list. Used by every
 * non-`Since` list method.
 */
function live<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((i) => !i.deletedAt);
}

/**
 * Mark a record as soft-deleted by saving the existing payload with
 * `deletedAt` set. Returns false if the record didn't exist (caller can
 * treat as a no-op).
 */
async function softDeleteVia<T extends { id?: string }>(
  current: T | null,
  save: (next: T & { deletedAt: string }) => Promise<void>,
): Promise<boolean> {
  if (!current) return false;
  const now = new Date().toISOString();
  await save({ ...current, deletedAt: now, updatedAt: now } as T & {
    deletedAt: string;
  });
  return true;
}

/**
 * StorageAdapter that reads + writes JSON under `data/` on disk. Single-
 * tenant; the orgId argument is ignored.
 */
export class FsStorageAdapter implements StorageAdapter {
  // ── Projects ───────────────────────────────────────────────────────────
  async listProjects(): Promise<Project[]> {
    return live(await loadAllProjects());
  }
  async listProjectsSince(): Promise<Project[]> {
    return loadAllProjects();
  }
  async getProject(_org: string, id: string): Promise<Project | null> {
    const p = await loadProject(id);
    return p && !p.deletedAt ? p : null;
  }
  async saveProject(_org: string, project: Project): Promise<void> {
    await saveProject({
      ...project,
      updatedAt: project.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteProject(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadProject(id), (p) => saveProject(p));
  }

  // ── Shows ──────────────────────────────────────────────────────────────
  async listShows(_org: string, projectId?: string): Promise<Show[]> {
    const all = live(await loadAllShows());
    return projectId ? all.filter((s) => s.projectId === projectId) : all;
  }
  async listShowsSince(): Promise<Show[]> {
    return loadAllShows();
  }
  async getShow(_org: string, id: string): Promise<Show | null> {
    const s = await loadShow(id);
    return s && !s.deletedAt ? s : null;
  }
  async saveShow(_org: string, show: Show): Promise<void> {
    await saveShow({
      ...show,
      updatedAt: show.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteShow(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadShow(id), (s) => saveShow(s));
  }

  // ── Hotcards ───────────────────────────────────────────────────────────
  async listHotcards(_org: string, projectId?: string): Promise<Hotcard[]> {
    const all = live(await loadAllHotcards());
    return projectId ? all.filter((h) => h.projectId === projectId) : all;
  }
  async listHotcardsSince(): Promise<Hotcard[]> {
    return loadAllHotcards();
  }
  async getHotcard(_org: string, id: string): Promise<Hotcard | null> {
    const h = await loadHotcard(id);
    return h && !h.deletedAt ? h : null;
  }
  async saveHotcard(_org: string, hotcard: Hotcard): Promise<void> {
    await saveHotcard({
      ...hotcard,
      updatedAt: hotcard.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteHotcard(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadHotcard(id), (h) => saveHotcard(h));
  }

  // ── Songs ──────────────────────────────────────────────────────────────
  async listSongs(): Promise<Song[]> {
    return live(await loadAllSongs());
  }
  async listSongsSince(): Promise<Song[]> {
    return loadAllSongs();
  }
  async getSong(_org: string, id: string): Promise<Song | null> {
    const s = await loadSong(id);
    return s && !s.deletedAt ? s : null;
  }
  async saveSong(_org: string, song: Song): Promise<void> {
    await saveSong({
      ...song,
      updatedAt: song.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteSong(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadSong(id), (s) => saveSong(s));
  }

  // ── Templates ──────────────────────────────────────────────────────────
  async listTemplates(): Promise<Template[]> {
    return live(await loadAllTemplates());
  }
  async listTemplatesSince(): Promise<Template[]> {
    return loadAllTemplates();
  }
  async getTemplate(_org: string, id: string): Promise<Template | null> {
    const t = await loadTemplate(id);
    return t && !t.deletedAt ? t : null;
  }
  async saveTemplate(_org: string, template: Template): Promise<void> {
    await saveTemplate({
      ...template,
      updatedAt: template.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteTemplate(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadTemplate(id), (t) => saveTemplate(t));
  }

  // ── Channel configs ────────────────────────────────────────────────────
  async listChannelConfigs(): Promise<ChannelConfig[]> {
    return live(await loadAllChannelConfigs());
  }
  async listChannelConfigsSince(): Promise<ChannelConfig[]> {
    return loadAllChannelConfigs();
  }
  async getChannelConfig(_org: string, id: string): Promise<ChannelConfig | null> {
    const c = await loadChannelConfig(id);
    return c && !c.deletedAt ? c : null;
  }
  async saveChannelConfig(_org: string, config: ChannelConfig): Promise<void> {
    await saveChannelConfig({
      ...config,
      updatedAt: config.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteChannelConfig(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadChannelConfig(id), (c) =>
      saveChannelConfig(c),
    );
  }

  // ── Project channel overrides ─────────────────────────────────────────
  //
  // These are new in the W2 cut — no existing helpers in storage.ts, so
  // this adapter owns the filesystem layout directly:
  //   data/channel_overrides/<projectId>__<channelId>.json
  // Same atomic-write + tombstone semantics as the other entities.

  async listProjectChannelOverrides(
    _org: string,
    projectId?: string,
  ): Promise<ProjectChannelOverride[]> {
    const all = await this.readAllOverrides();
    const filtered = live(all);
    return projectId
      ? filtered.filter((o) => o.projectId === projectId)
      : filtered;
  }
  async listProjectChannelOverridesSince(): Promise<ProjectChannelOverride[]> {
    return this.readAllOverrides();
  }
  async saveProjectChannelOverride(
    _org: string,
    override: ProjectChannelOverride,
  ): Promise<void> {
    await fs.mkdir(overridesDir(), { recursive: true });
    const next: ProjectChannelOverride = {
      ...override,
      updatedAt: override.updatedAt ?? new Date().toISOString(),
    };
    await writeAtomic(
      overrideFile(next.projectId, next.channelId),
      JSON.stringify(next, null, 2),
    );
  }
  async deleteProjectChannelOverride(
    _org: string,
    projectId: string,
    channelId: string,
  ): Promise<boolean> {
    const file = overrideFile(projectId, channelId);
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = ProjectChannelOverrideSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return false;
      const now = new Date().toISOString();
      await writeAtomic(
        file,
        JSON.stringify(
          { ...parsed.data, deletedAt: now, updatedAt: now },
          null,
          2,
        ),
      );
      return true;
    } catch {
      return false;
    }
  }
  private async readAllOverrides(): Promise<ProjectChannelOverride[]> {
    try {
      const names = await fs.readdir(overridesDir());
      const out: ProjectChannelOverride[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(
            path.join(overridesDir(), name),
            "utf8",
          );
          const parsed = ProjectChannelOverrideSchema.safeParse(JSON.parse(raw));
          if (parsed.success) out.push(parsed.data);
        } catch {
          // skip malformed file
        }
      }
      return out;
    } catch {
      // directory doesn't exist yet — nothing to read
      return [];
    }
  }

  // ── Assets — unused by the engine ──────────────────────────────────────
  async putAsset(): Promise<void> {
    throw new Error("FsStorageAdapter.putAsset not implemented for sync path");
  }
  async hasAsset(): Promise<boolean> {
    return false;
  }
  async getAssetUrl(): Promise<string | null> {
    return null;
  }
}
