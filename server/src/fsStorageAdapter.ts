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
  type Deck,
  type Hotcard,
  type PcoItemMapping,
  type Project,
  type ProjectChannelOverride,
  type Show,
  type Song,
  type StorageAdapter,
  type StageLayout,
  isBuiltInStageLayoutId,
  type Template,
} from "@overlaysys/core";
import { withoutBuiltIn } from "./stageLayouts";
import { loadAllDecks, loadDeck, writeDeck } from "./decksStore";
import {
  deleteItemMapping,
  listItemMappings,
  putItemMapping,
} from "./pco/itemMappings";
import {
  dataRoot,
  loadAllChannelConfigs,
  loadAllHotcards,
  loadAllProjects,
  loadAllShows,
  loadAllSongs,
  loadAllStageLayouts,
  loadAllTemplates,
  loadChannelConfig,
  loadHotcard,
  loadProject,
  loadShow,
  loadSong,
  loadStageLayout,
  loadTemplate,
  saveChannelConfig,
  saveHotcard,
  saveProject,
  saveShow,
  saveSong,
  saveStageLayout,
  saveTemplate,
} from "./storage";

/**
 * Stopgap until the cloud `shows` table carries sermon notes: a pulled show
 * arrives without `sermonNotes`, so keep the local copy's rather than wiping
 * them. An explicit `[]` still clears. See docs/cloud-sermon-notes-migration.md.
 */
export function keepLocalSermonNotes(incoming: Show, existing: Show | null): Show {
  if (incoming.sermonNotes !== undefined || !existing?.sermonNotes) return incoming;
  return { ...incoming, sermonNotes: existing.sermonNotes };
}

/**
 * Stopgap until `shows.extra` is live on every org: a show pulled from a
 * cloud without the column arrives without `sections`, so keep the
 * local copy's. An explicit `[]` still clears. See
 * docs/cloud-slides-sync-migration.md.
 */
export function keepLocalSections(incoming: Show, existing: Show | null): Show {
  if (incoming.sections !== undefined || !existing?.sections) return incoming;
  return { ...incoming, sections: existing.sections };
}

/**
 * Stopgap until the cloud `hotcards` table carries `hotkey` (plan 3): a
 * pulled hotcard arrives without it, so keep the local copy's F-key, or
 * its deliberate `null`, rather than wiping it. Without this, a pull would
 * drop the key and the boot migration could renumber the project.
 */
export function keepLocalHotkey(incoming: Hotcard, existing: Hotcard | null): Hotcard {
  if (incoming.hotkey !== undefined || !existing || existing.hotkey === undefined) return incoming;
  return { ...incoming, hotkey: existing.hotkey };
}

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
    const needsLocal = show.sermonNotes === undefined || show.sections === undefined;
    const existing = needsLocal ? await loadShow(show.id) : null;
    const merged = keepLocalSections(keepLocalSermonNotes(show, existing), existing);
    await saveShow({
      ...merged,
      updatedAt: merged.updatedAt ?? new Date().toISOString(),
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
    const merged = hotcard.hotkey === undefined ? keepLocalHotkey(hotcard, await loadHotcard(hotcard.id)) : hotcard;
    await saveHotcard({
      ...merged,
      updatedAt: merged.updatedAt ?? new Date().toISOString(),
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

  // ── Stage layouts ──────────────────────────────────────────────────────
  async listStageLayouts(_org: string): Promise<StageLayout[]> {
    return live(await loadAllStageLayouts());
  }
  async listStageLayoutsSince(_org: string, _watermark: string): Promise<StageLayout[]> {
    return loadAllStageLayouts();
  }
  async getStageLayout(_org: string, id: string): Promise<StageLayout | null> {
    const l = await loadStageLayout(id);
    return l && !l.deletedAt ? l : null;
  }
  async saveStageLayout(_org: string, layout: StageLayout): Promise<void> {
    // Built-ins live in code: never write one (or re-push a pulled one).
    if (isBuiltInStageLayoutId(layout.id)) return;
    // `builtIn` is a code-only flag; a stored layout must never claim it.
    const stored = withoutBuiltIn(layout);
    await saveStageLayout({
      ...stored,
      updatedAt: layout.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteStageLayout(_org: string, id: string): Promise<boolean> {
    return softDeleteVia(await loadStageLayout(id), (l) => saveStageLayout(l));
  }

  // ── Slides decks ───────────────────────────────────────────────────────
  //
  // Writes go straight to decksStore (not the registry in decks.ts, which
  // re-stamps `updatedAt` for operator edits) so a pulled deck keeps its
  // incoming timestamp. cloudSync's fan-out reloads the registry afterwards.
  async listDecks(_org: string): Promise<Deck[]> {
    return live(await loadAllDecks());
  }
  async listDecksSince(_org: string, _watermark: string): Promise<Deck[]> {
    return loadAllDecks();
  }
  async getDeck(_org: string, id: string): Promise<Deck | null> {
    const d = await loadDeck(id);
    return d && !d.deletedAt ? d : null;
  }
  async saveDeck(_org: string, deck: Deck): Promise<void> {
    await writeDeck({
      ...deck,
      updatedAt: deck.updatedAt ?? new Date().toISOString(),
    });
  }
  async deleteDeck(_org: string, id: string): Promise<boolean> {
    const current = await loadDeck(id);
    if (!current || current.deletedAt) return false;
    return softDeleteVia(current, (d) => writeDeck(d));
  }

  // ── PCO item mappings ──────────────────────────────────────────────────
  //
  // putItemMapping stores the record as-is (tombstones and `updatedAt`
  // included), which is exactly what a pull needs.
  async listPcoItemMappings(_org: string): Promise<PcoItemMapping[]> {
    return listItemMappings();
  }
  async listPcoItemMappingsSince(_org: string, _watermark: string): Promise<PcoItemMapping[]> {
    return listItemMappings({ includeDeleted: true });
  }
  async savePcoItemMapping(_org: string, m: PcoItemMapping): Promise<void> {
    await putItemMapping(m);
  }
  async deletePcoItemMapping(_org: string, id: string): Promise<boolean> {
    return deleteItemMapping(id);
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
