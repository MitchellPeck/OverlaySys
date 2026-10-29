import type { Hotcard, Show, Song, Template, BundleAsset } from "@overlaysys/core";
import type { ImportDecision } from "./planImport";

export interface RequestRow {
  kind: "song" | "template" | "show" | "hotcard";
  id: string;
  decision: ImportDecision;
  targetProject: string;
}

export interface ImportRequestBody {
  templates: Template[];
  songs: Song[];
  hotcards: Hotcard[];
  shows: Show[];
  assets: BundleAsset[];
}

/**
 * Project an imported item should land in: the bundle's own project only when it
 * exists on this install, else the current project. The preview shows this value
 * and the request sends exactly it.
 */
export function resolveTargetProject(
  sourceProject: string | undefined,
  localProjectIds: readonly string[],
  currentProject: string,
): string {
  return sourceProject && localProjectIds.includes(sourceProject) ? sourceProject : currentProject;
}

function remapId<T extends { songId?: string; templateId?: string; deckId?: string }>(
  r: T,
  songs: Map<string, string>,
  templates: Map<string, string>,
): T {
  const out: T = { ...r };
  if (out.songId && songs.has(out.songId)) out.songId = songs.get(out.songId)!;
  if (out.templateId && templates.has(out.templateId)) out.templateId = templates.get(out.templateId)!;
  return out;
}

/** Rewrite a show's references to copied songs/templates so no row or override dangles. */
function remapShow(show: Show, songs: Map<string, string>, templates: Map<string, string>): Show {
  if (songs.size === 0 && templates.size === 0) return show;
  const rows = show.rows.map((row) => {
    const r = remapId(row as never, songs, templates) as Record<string, unknown>;
    const lyric = r.lyricTemplateId;
    if (typeof lyric === "string" && templates.has(lyric)) r.lyricTemplateId = templates.get(lyric);
    const local = r.localSlides;
    if (Array.isArray(local)) {
      r.localSlides = local.map((s: { templateId?: string }) => remapId(s, songs, templates));
    }
    return r as unknown as Show["rows"][number];
  });
  const showSongs = show.songs.map((s) => {
    const m = remapId(s, songs, templates);
    for (const k of ["introTemplateId", "outroTemplateId", "lyricTemplateId"] as const) {
      const v = m[k];
      if (v && templates.has(v)) m[k] = templates.get(v);
    }
    return m;
  });
  return { ...show, rows, songs: showSongs };
}

/**
 * Build the body for `/api/import` from the previewed entities and the per-row
 * decisions. Copies get fresh ids (and "(copy)" names), and every imported show
 * is rewritten to reference the copies; shows and hotcards move to the row's
 * target project.
 */
export function buildImportRequest(
  preview: { songs: Song[]; templates: Template[]; shows: Show[]; hotcards: Hotcard[]; assets: BundleAsset[] },
  rows: readonly RequestRow[],
  makeId: (prefix: string) => string,
): ImportRequestBody {
  const by = (kind: RequestRow["kind"]) =>
    new Map(rows.filter((r) => r.kind === kind && r.decision !== "skip").map((r) => [r.id, r]));
  const songRows = by("song");
  const templateRows = by("template");
  const hotcardRows = by("hotcard");
  const showRows = by("show");

  const songMap = new Map<string, string>();
  const templateMap = new Map<string, string>();
  const songs = preview.songs.flatMap((s) => {
    const r = songRows.get(s.id);
    if (!r) return [];
    if (r.decision !== "copy") return [s];
    const id = makeId("song");
    songMap.set(s.id, id);
    return [{ ...s, id, title: `${s.title} (copy)` }];
  });
  const templates = preview.templates.flatMap((t) => {
    const r = templateRows.get(t.id);
    if (!r) return [];
    if (r.decision !== "copy") return [t];
    const id = makeId("template");
    templateMap.set(t.id, id);
    return [{ ...t, id, name: `${t.name} (copy)` }];
  });
  const hotcards = preview.hotcards.flatMap((h) => {
    const r = hotcardRows.get(h.id);
    if (!r) return [];
    const moved = { ...h, projectId: r.targetProject };
    const next = r.decision === "copy" ? { ...moved, id: makeId("hotcard"), name: `${h.name} (copy)` } : moved;
    // Hotcards point at a template; follow it if that was copied too.
    return [templateMap.has(next.templateId) ? { ...next, templateId: templateMap.get(next.templateId)! } : next];
  });
  const shows = preview.shows.flatMap((sh) => {
    const r = showRows.get(sh.id);
    if (!r) return [];
    const moved = remapShow({ ...sh, projectId: r.targetProject }, songMap, templateMap);
    return [r.decision === "copy" ? { ...moved, id: makeId("show"), name: `${sh.name} (copy)` } : moved];
  });
  return { templates, songs, hotcards, shows, assets: preview.assets };
}
