import { z } from "zod";
import { SongSchema, type Song } from "./song";
import { TemplateSchema, type Template } from "./template";
import { ShowSchema, type Show } from "./show";

export const BundleSchema = z.object({
  format: z.literal("overlaysys-bundle"),
  version: z.literal(1),
  exportedAt: z.string(),
  name: z.string().optional(),
  songs: z.array(SongSchema).default([]),
  templates: z.array(TemplateSchema).default([]),
  shows: z.array(ShowSchema).default([]),
});
export type Bundle = z.infer<typeof BundleSchema>;

export interface BundleSelection {
  songIds: string[];
  templateIds: string[];
  showIds: string[];
}

export interface MissingRef {
  kind: "song" | "template";
  id: string;
  referencedBy: string;
}

export interface BundlePayload {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  missing: MissingRef[];
}

export interface StoreSnapshot {
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  shows: Map<string, Show>;
}

export function collectDependencies(
  selection: BundleSelection,
  store: StoreSnapshot,
): BundlePayload {
  const songIds = new Set<string>(selection.songIds);
  const templateIds = new Set<string>(selection.templateIds);
  const showIds = new Set<string>(selection.showIds);
  const missing: MissingRef[] = [];

  // Walk each selected show, expanding songs + templates.
  for (const showId of showIds) {
    const show = store.shows.get(showId);
    if (!show) continue;
    for (const row of show.rows) {
      if (row.kind === "graphic") {
        templateIds.add(row.templateId);
      } else {
        songIds.add(row.songId);
        templateIds.add(row.lyricTemplateId);
      }
    }
  }

  // Walk each (now-expanded) song, pulling defaultLyricTemplateId.
  for (const songId of songIds) {
    const song = store.songs.get(songId);
    if (!song) continue;
    if (song.defaultLyricTemplateId) {
      templateIds.add(song.defaultLyricTemplateId);
    }
  }

  // Resolve.
  const songs: Song[] = [];
  const templates: Template[] = [];
  const shows: Show[] = [];

  for (const id of songIds) {
    const song = store.songs.get(id);
    if (song) {
      songs.push(song);
    } else {
      const referencedBy = findReferrer("song", id, store, selection);
      missing.push({ kind: "song", id, referencedBy });
    }
  }
  for (const id of templateIds) {
    const tpl = store.templates.get(id);
    if (tpl) {
      templates.push(tpl);
    } else {
      const referencedBy = findReferrer("template", id, store, selection);
      missing.push({ kind: "template", id, referencedBy });
    }
  }
  for (const id of showIds) {
    const show = store.shows.get(id);
    if (show) shows.push(show);
    // Shows are never referenced by other entities; missing show in selection
    // means the operator selected something that vanished from the store —
    // treat as silent.
  }

  return { songs, templates, shows, missing };
}

function findReferrer(
  kind: "song" | "template",
  id: string,
  store: StoreSnapshot,
  selection: BundleSelection,
): string {
  // Direct selection wins — operator asked for this id by name.
  if (kind === "song" && selection.songIds.includes(id)) return "(direct selection)";
  if (kind === "template" && selection.templateIds.includes(id)) return "(direct selection)";
  // Otherwise find a show or song that references it.
  for (const showId of selection.showIds) {
    const show = store.shows.get(showId);
    if (!show) continue;
    for (const row of show.rows) {
      if (kind === "template") {
        if (row.kind === "graphic" && row.templateId === id) return showId;
        if (row.kind === "song" && row.lyricTemplateId === id) return showId;
      } else {
        if (row.kind === "song" && row.songId === id) return showId;
      }
    }
  }
  if (kind === "template") {
    for (const songId of selection.songIds) {
      const song = store.songs.get(songId);
      if (song?.defaultLyricTemplateId === id) return songId;
    }
  }
  return "(unknown)";
}

export type Detected =
  | { kind: "bundle"; bundle: Bundle }
  | { kind: "song"; song: Song }
  | { kind: "template"; template: Template }
  | { kind: "show"; show: Show }
  | { kind: "error"; message: string };

export function detectImport(json: unknown): Detected {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { kind: "error", message: "expected a JSON object" };
  }
  const obj = json as Record<string, unknown>;

  if (obj.format === "overlaysys-bundle") {
    const result = BundleSchema.safeParse(obj);
    if (result.success) return { kind: "bundle", bundle: result.data };
    return { kind: "error", message: `invalid bundle: ${result.error.message}` };
  }

  // Try entity schemas in order of specificity.
  const songR = SongSchema.safeParse(obj);
  if (songR.success) return { kind: "song", song: songR.data };
  const templateR = TemplateSchema.safeParse(obj);
  if (templateR.success) return { kind: "template", template: templateR.data };
  const showR = ShowSchema.safeParse(obj);
  if (showR.success) return { kind: "show", show: showR.data };

  return {
    kind: "error",
    message: "not a bundle, song, template, or show",
  };
}
