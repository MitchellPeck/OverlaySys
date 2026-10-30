import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  collectDependencies,
  collectReferencedAssetFilenames,
  collectReferencedChannelIds,
  type Bundle,
  type BundleAsset,
  type ChannelConfig,
  type Deck,
  type Hotcard,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import * as projects from "./projects";
import * as shows from "./shows";
import * as hotcards from "./hotcards";
import * as templates from "./templates";
import * as songs from "./songs";
import * as decks from "./decks";
import * as channelConfigs from "./channelConfigs";
import { dataRoot } from "./storage";
import { isSafeAssetFilename, mimeFromFilename } from "./assets";

/**
 * `POST /api/projects/:id/publish-bundle` — the server-built bundle behind
 * the operator's per-project **Publish** button.
 *
 * Built from disk rather than from the operator's caches so the closure is
 * complete regardless of which shows/hotcards the operator has opened,
 * and so the asset bytes come straight from the content-addressed store.
 * Every included entity is re-stamped (through the registries, which is
 * how every local write gets its `updatedAt`) before it goes into the
 * bundle, so the version the operator pushes to the cloud carries the
 * same stamp as the local file: the sync engine then sees both replicas
 * agree instead of pulling the cloud copy back down as an "overwrite".
 *
 * Returns null when the project does not exist (route answers 404).
 */
export async function buildProjectPublishBundle(projectId: string): Promise<Bundle | null> {
  const project = await projects.getProject(projectId);
  if (!project) return null;

  const showMetas = (await shows.listShowMetas()).filter((m) => m.projectId === projectId);
  const hotcardMetas = (await hotcards.listHotcardMetas()).filter((m) => m.projectId === projectId);
  const projectShows = (
    await Promise.all(showMetas.map((m) => shows.getShow(m.id)))
  ).filter((s): s is Show => s !== null);
  const projectHotcards = (
    await Promise.all(hotcardMetas.map((m) => hotcards.getHotcard(m.id)))
  ).filter((h): h is Hotcard => h !== null);

  const deps = collectDependencies(
    {
      songIds: [],
      templateIds: [],
      showIds: projectShows.map((s) => s.id),
      hotcardIds: projectHotcards.map((h) => h.id),
    },
    {
      songs: new Map((await songs.listSongs()).map((s) => [s.id, s])),
      templates: new Map((await templates.listTemplates()).map((t) => [t.id, t])),
      shows: new Map(projectShows.map((s) => [s.id, s])),
      hotcards: new Map(projectHotcards.map((h) => [h.id, h])),
    },
  );

  const channelIds = collectReferencedChannelIds({
    shows: deps.shows,
    hotcards: deps.hotcards,
    songs: deps.songs,
    templates: deps.templates,
  });
  const channels = (await channelConfigs.listChannelConfigs()).filter((c) =>
    channelIds.has(c.id),
  );

  // Re-stamp through the registries — this IS a local write of the
  // published version.
  const stampedProject = await projects.saveProject(project);
  const stampedTemplates: Template[] = [];
  for (const t of deps.templates) stampedTemplates.push(await templates.saveTemplate(t));
  const stampedSongs: Song[] = [];
  for (const s of deps.songs) stampedSongs.push(await songs.saveSong(s));
  const stampedShows: Show[] = [];
  for (const s of deps.shows) stampedShows.push(await shows.saveShow(s));
  const stampedHotcards: Hotcard[] = [];
  for (const h of deps.hotcards) stampedHotcards.push(await hotcards.saveHotcard(h));
  const stampedChannels: ChannelConfig[] = [];
  for (const c of channels) stampedChannels.push(await channelConfigs.saveChannelConfig(c));

  // Decks the project's shows play: their media slides' files travel with the bundle.
  const deckIds = new Set<string>();
  for (const s of stampedShows) {
    for (const r of s.rows) if (r.kind === "slides" && r.deckId) deckIds.add(r.deckId);
  }
  const referencedDecks = (await Promise.all([...deckIds].map((id) => decks.getDeck(id)))).filter(
    (d): d is Deck => d !== null,
  );

  const assets = await readAssets(
    collectReferencedAssetFilenames({
      templates: stampedTemplates,
      hotcards: stampedHotcards,
      shows: stampedShows,
      decks: referencedDecks,
    }),
  );

  return {
    format: "overlaysys-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: stampedProject.name,
    project: stampedProject,
    songs: stampedSongs,
    templates: stampedTemplates,
    shows: stampedShows,
    hotcards: stampedHotcards,
    channels: stampedChannels,
    channelOverrides: [],
    assets,
  };
}

/**
 * Read referenced assets from the content-addressed store. A reference
 * whose file is gone is skipped, not fatal — templates can outlive their
 * assets, and a publish should still carry everything that does exist.
 */
async function readAssets(filenames: Set<string>): Promise<BundleAsset[]> {
  const out: BundleAsset[] = [];
  const dir = path.join(dataRoot(), "assets");
  for (const filename of filenames) {
    if (!isSafeAssetFilename(filename)) continue;
    let buf: Buffer;
    try {
      buf = await fs.readFile(path.join(dir, filename));
    } catch {
      continue;
    }
    const mime = mimeFromFilename(filename);
    out.push({
      filename,
      size: buf.length,
      data: buf.toString("base64"),
      ...(mime ? { mime } : {}),
    });
  }
  return out;
}

export async function registerPublishRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/publish-bundle",
    async (req, reply) => {
      const bundle = await buildProjectPublishBundle(req.params.id);
      if (!bundle) {
        reply.code(404);
        return { error: "project not found" };
      }
      return bundle;
    },
  );
}
