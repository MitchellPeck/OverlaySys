"use client";

import {
  collectDependencies,
  collectReferencedAssetFilenames,
  type Bundle,
  type Project,
} from "@overlaysys/core";
import { useStore } from "./store";
import {
  applyBundleCloud,
  getHotcardCloud,
  getProjectCloud,
  getShowCloud,
  getSongCloud,
  getTemplateCloud,
  listHotcardMetasCloud,
  listProjectsCloud,
  listShowMetasCloud,
} from "./cloudData";
import { fetchAssetBase64 } from "./assetTransfer";

/**
 * Cross-side project sync helpers used by Phase 4 publish/pull. These
 * walk the entity graph for a single project (or library item), gather
 * dependencies, and either push to or pull from cloud.
 *
 * "Publish from local" reads from the WS-backed Zustand caches, so the
 * caller is responsible for triggering the necessary `get_*` messages
 * before invoking. The /projects publish path waits for the entities to
 * land in the cache before kicking off the bundle build.
 */

interface PublishProgress {
  message: string;
}

/**
 * Build a Bundle from the LOCAL store for the given project id, then
 * apply it to the cloud via Supabase. Errors are returned in the
 * ApplyBundleResult shape so callers can present them inline.
 */
export async function publishProjectToCloud(
  projectId: string,
  onProgress?: (p: PublishProgress) => void,
): Promise<{
  ok: boolean;
  counts: Record<string, number>;
  errors: { kind: string; id: string; message: string }[];
}> {
  const bundle = await buildLocalProjectBundle(projectId, onProgress);
  const result = await applyBundleCloud(bundle, (msg) =>
    onProgress?.({ message: msg }),
  );
  return {
    ok: result.errors.length === 0,
    counts: result.counts,
    errors: result.errors,
  };
}

/**
 * Build a Bundle from the CLOUD for the given project id and feed it
 * into the local `/api/import` endpoint. Used by /projects pull-from-
 * cloud action when running in Electron with a cloud session.
 */
export async function pullProjectFromCloud(
  projectId: string,
  localImportUrl: string,
  onProgress?: (p: PublishProgress) => void,
): Promise<{ ok: boolean; error?: string }> {
  const bundle = await buildCloudProjectBundle(projectId, onProgress);
  onProgress?.({ message: "writing to local server…" });
  const res = await fetch(localImportUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Local server's /api/import doesn't accept the bundle envelope —
    // strip to the body shape it wants.
    body: JSON.stringify({
      templates: bundle.templates,
      songs: bundle.songs,
      hotcards: bundle.hotcards,
      shows: bundle.shows,
      project: bundle.project,
      assets: bundle.assets,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
  }
  return { ok: true };
}

export async function listCloudProjects(): Promise<Project[]> {
  return listProjectsCloud();
}

// ─── Bundle builders ──────────────────────────────────────────────────────

async function buildLocalProjectBundle(
  projectId: string,
  onProgress?: (p: PublishProgress) => void,
): Promise<Bundle> {
  // The local store carries metadata + an entity-cache populated via WS.
  // We assume the export tab on /data has already lazily pulled everything,
  // OR that the publish caller did so. Anything not in the cache won't be
  // bundled — caller can detect via the local server export endpoint
  // (`/data` flow) if needed.
  const state = useStore.getState();
  onProgress?.({ message: "collecting dependencies…" });

  // Find the local project metadata.
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`local project ${projectId} not found`);

  // Walk the project's shows + hotcards via cached metadata.
  const showsInProject = state.showMetas
    .filter((s) => s.projectId === projectId)
    .map((m) => state.showCache[m.id])
    .filter((s): s is NonNullable<typeof s> => !!s);
  const hotcardsInProject = state.hotcards
    .filter((h) => h.projectId === projectId)
    .map((m) => state.hotcardCache[m.id])
    .filter((h): h is NonNullable<typeof h> => !!h);

  const deps = collectDependencies(
    {
      songIds: [],
      templateIds: [],
      showIds: showsInProject.map((s) => s.id),
      hotcardIds: hotcardsInProject.map((h) => h.id),
    },
    {
      songs: new Map(Object.entries(state.songCache)),
      templates: new Map(Object.entries(state.templateCache)),
      shows: new Map(Object.entries(state.showCache)),
      hotcards: new Map(Object.entries(state.hotcardCache)),
    },
  );

  const assets = await collectAssetsBase64(deps);

  return {
    format: "overlaysys-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: project.name,
    project,
    songs: deps.songs,
    templates: deps.templates,
    shows: deps.shows,
    hotcards: deps.hotcards,
    assets,
  };
}

async function buildCloudProjectBundle(
  projectId: string,
  onProgress?: (p: PublishProgress) => void,
): Promise<Bundle> {
  onProgress?.({ message: "loading project metadata…" });
  const project = await getProjectCloud(projectId);
  if (!project) throw new Error(`cloud project ${projectId} not found`);

  // Pull every show + hotcard scoped to this project. The metadata list
  // already carries project_id so a filter is enough.
  const [showMetas, hotcardMetas] = await Promise.all([
    listShowMetasCloud(),
    listHotcardMetasCloud(),
  ]);
  const projectShowMetas = showMetas.filter((s) => s.projectId === projectId);
  const projectHotcardMetas = hotcardMetas.filter((h) => h.projectId === projectId);

  onProgress?.({ message: "loading shows…" });
  const shows = (
    await Promise.all(projectShowMetas.map((m) => getShowCloud(m.id)))
  ).filter((s): s is NonNullable<typeof s> => !!s);
  onProgress?.({ message: "loading hotcards…" });
  const hotcards = (
    await Promise.all(projectHotcardMetas.map((m) => getHotcardCloud(m.id)))
  ).filter((h): h is NonNullable<typeof h> => !!h);

  // Transitive deps: songs and templates referenced by the shows/hotcards.
  const songIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const sh of shows) {
    for (const row of sh.rows) {
      if (row.kind === "graphic") templateIds.add(row.templateId);
      else {
        songIds.add(row.songId);
        templateIds.add(row.lyricTemplateId);
      }
    }
  }
  for (const h of hotcards) templateIds.add(h.templateId);

  onProgress?.({ message: "loading songs + templates…" });
  const [songs, templates] = await Promise.all([
    Promise.all(Array.from(songIds).map((id) => getSongCloud(id))).then((arr) =>
      arr.filter((s): s is NonNullable<typeof s> => !!s),
    ),
    Promise.all(Array.from(templateIds).map((id) => getTemplateCloud(id))).then(
      (arr) => arr.filter((t): t is NonNullable<typeof t> => !!t),
    ),
  ]);

  // Songs may also reference a defaultLyricTemplateId we haven't pulled yet.
  for (const s of songs) {
    if (s.defaultLyricTemplateId && !templateIds.has(s.defaultLyricTemplateId)) {
      const t = await getTemplateCloud(s.defaultLyricTemplateId);
      if (t) templates.push(t);
    }
  }

  onProgress?.({ message: "loading asset bytes…" });
  const assets = await collectAssetsBase64({
    templates,
    shows,
    hotcards,
  });

  return {
    format: "overlaysys-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: project.name,
    project,
    songs,
    templates,
    shows,
    hotcards,
    assets,
  };
}

async function collectAssetsBase64(payload: {
  templates: ReturnType<typeof collectDependencies>["templates"];
  hotcards: ReturnType<typeof collectDependencies>["hotcards"];
  shows: ReturnType<typeof collectDependencies>["shows"];
}): Promise<Bundle["assets"]> {
  const filenames = collectReferencedAssetFilenames({
    templates: payload.templates,
    hotcards: payload.hotcards,
    shows: payload.shows,
  });
  const assets: Bundle["assets"] = [];
  for (const filename of filenames) {
    const raw = await fetchAssetBase64(filename);
    if (raw) {
      assets.push({
        filename: raw.filename,
        size: raw.size,
        data: raw.base64,
      });
    }
  }
  return assets;
}
