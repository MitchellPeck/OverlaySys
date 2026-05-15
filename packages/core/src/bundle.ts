import { z } from "zod";
import { SongSchema, type Song } from "./song";
import { TemplateSchema, type Template } from "./template";
import { ShowSchema, type Show } from "./show";
import { HotcardSchema, type Hotcard } from "./hotcard";
import { ProjectSchema, type Project } from "./project";
import {
  ChannelConfigSchema,
  ProjectChannelOverrideSchema,
  type ChannelConfig,
  type ProjectChannelOverride,
} from "./channelConfig";

/**
 * A binary asset embedded in a bundle. `filename` is the content-addressed
 * `<sha256>.<ext>` name as stored on disk under data/assets/. `data` is the
 * raw bytes encoded as base64. On import, the receiving server writes the
 * decoded bytes verbatim to data/assets/<filename> so the existing absolute
 * URLs in templates and hotcards still resolve.
 */
export const BundleAssetSchema = z.object({
  filename: z.string(),
  mime: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  data: z.string(),
});
export type BundleAsset = z.infer<typeof BundleAssetSchema>;

export const BundleSchema = z.object({
  format: z.literal("overlaysys-bundle"),
  version: z.literal(1),
  exportedAt: z.string(),
  name: z.string().optional(),
  /**
   * Optional project descriptor. When present, the bundle represents a
   * project export: included shows and hotcards belong to this project and
   * the importer should create/update the Project on apply. Library exports
   * (a single song or template with no project context) omit this field.
   */
  project: ProjectSchema.optional(),
  songs: z.array(SongSchema).default([]),
  templates: z.array(TemplateSchema).default([]),
  shows: z.array(ShowSchema).default([]),
  hotcards: z.array(HotcardSchema).default([]),
  /**
   * Org channels referenced by the bundle. On project export, includes any
   * channel mentioned by a row's channelHint, a song's defaultChannel, or
   * a hotcard's channelHint plus all channels with an override in
   * `channelOverrides`. Org-default cascades resolve at the importer using
   * `resolveChannelConfig`.
   */
  channels: z.array(ChannelConfigSchema).default([]),
  /**
   * Per-project channel overrides scoped to the bundle's project. Empty
   * when the bundle has no `project` field (library exports) or when the
   * project has no overrides.
   */
  channelOverrides: z.array(ProjectChannelOverrideSchema).default([]),
  assets: z.array(BundleAssetSchema).default([]),
});
export type Bundle = z.infer<typeof BundleSchema>;

export interface BundleSelection {
  songIds: string[];
  templateIds: string[];
  showIds: string[];
  hotcardIds: string[];
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
  hotcards: Hotcard[];
  missing: MissingRef[];
}

export interface StoreSnapshot {
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  shows: Map<string, Show>;
  hotcards: Map<string, Hotcard>;
}

export function collectDependencies(
  selection: BundleSelection,
  store: StoreSnapshot,
): BundlePayload {
  const songIds = new Set<string>(selection.songIds);
  const templateIds = new Set<string>(selection.templateIds);
  const showIds = new Set<string>(selection.showIds);
  const hotcardIds = new Set<string>(selection.hotcardIds);
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

  // Walk each selected hotcard, expanding its template.
  for (const hotcardId of hotcardIds) {
    const h = store.hotcards.get(hotcardId);
    if (!h) continue;
    templateIds.add(h.templateId);
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
  const hotcards: Hotcard[] = [];

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
  for (const id of hotcardIds) {
    const h = store.hotcards.get(id);
    if (h) hotcards.push(h);
  }

  return { songs, templates, shows, hotcards, missing };
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
    for (const hotcardId of selection.hotcardIds) {
      const h = store.hotcards.get(hotcardId);
      if (h?.templateId === id) return hotcardId;
    }
    for (const songId of selection.songIds) {
      const song = store.songs.get(songId);
      if (song?.defaultLyricTemplateId === id) return songId;
    }
  }
  return "(unknown)";
}

/**
 * Extract the bare `<sha256>.<ext>` filename from a stored asset URL. The
 * operator stores absolute URLs like `http://host:4000/assets/<filename>`
 * (and occasionally raw `/assets/<filename>`) in template field defaults,
 * layer values, and hotcard data. Return null when the string isn't an
 * asset URL — fields can carry arbitrary text content that we shouldn't
 * try to bundle.
 */
export function extractAssetFilename(value: string): string | null {
  if (typeof value !== "string" || !value) return null;
  const idx = value.indexOf("/assets/");
  if (idx === -1) return null;
  const tail = value.slice(idx + "/assets/".length);
  // Stop at the first character that wouldn't appear in a sha256.ext name
  // (query strings, fragments, additional path segments).
  const match = tail.match(/^[A-Fa-f0-9]+\.[A-Za-z0-9]+/);
  return match ? match[0] : null;
}

/**
 * Rewrite an asset URL so it points at the given origin, leaving non-asset
 * strings unchanged. Used by the bundle importer to retarget URLs from the
 * exporter's host to the importer's host — without this, hotcards/templates
 * bundled on machine A:4000 would load 404s when imported onto machine B:4000.
 *
 * `originBase` should be the importer's HTTP origin without a trailing slash
 * (e.g. `http://localhost:4000`). Pass an empty string to produce relative
 * `/assets/<filename>` URLs instead, which work in any same-origin deploy.
 */
export function rewriteAssetUrlToHost(value: string, originBase: string): string {
  if (typeof value !== "string" || !value) return value;
  const filename = extractAssetFilename(value);
  if (!filename) return value;
  return `${originBase}/assets/${filename}`;
}

/**
 * Walk a bundle payload and collect every asset filename referenced from
 * templates (layer values, field defaults, fonts) and hotcards (data values).
 * Songs don't carry direct asset URLs — they reference templates which do.
 * Show rows likewise only carry overrides for the template's declared fields,
 * and those overrides may also be asset URLs.
 */
export function collectReferencedAssetFilenames(payload: {
  templates: Template[];
  hotcards: Hotcard[];
  shows: Show[];
}): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined): void => {
    if (!s) return;
    const f = extractAssetFilename(s);
    if (f) out.add(f);
  };

  for (const t of payload.templates) {
    for (const f of t.fields) add(f.default);
    for (const f of t.fonts ?? []) add(f.src);
    walkLayers(t.layers, add);
  }
  for (const h of payload.hotcards) {
    for (const v of Object.values(h.data)) add(v);
  }
  for (const sh of payload.shows) {
    for (const row of sh.rows) {
      if (row.kind === "graphic") {
        for (const v of Object.values(row.data)) add(v);
      }
    }
  }
  return out;
}

function walkLayers(
  layers: Template["layers"],
  add: (s: string | undefined) => void,
): void {
  for (const layer of layers) {
    if (layer.type === "image" || layer.type === "video") {
      if (typeof layer.src === "string") add(layer.src);
    }
    if (layer.type === "text" && typeof layer.content === "string") {
      // Text layers rarely carry asset URLs, but a pasted URL in literal
      // text would still resolve via the renderer's <img> fallback; cheap
      // to scan.
      add(layer.content);
    }
    if (layer.type === "group") {
      walkLayers(layer.children, add);
    }
  }
}

/**
 * Return a copy of the template with every asset URL (layer src, field
 * default, font src) re-anchored at `originBase`. Used on bundle import
 * so imported entities point at the importer's host instead of the
 * exporter's. FieldRef bindings are left alone — they're keys into row
 * data, not URLs.
 */
export function rewriteTemplateAssetUrls(t: Template, originBase: string): Template {
  return {
    ...t,
    fields: t.fields.map((f) =>
      f.default !== undefined
        ? { ...f, default: rewriteAssetUrlToHost(f.default, originBase) }
        : f,
    ),
    fonts: (t.fonts ?? []).map((f) => ({
      ...f,
      src: rewriteAssetUrlToHost(f.src, originBase),
    })),
    layers: t.layers.map((l) => rewriteLayerAssetUrls(l, originBase)),
  };
}

function rewriteLayerAssetUrls(
  layer: Template["layers"][number],
  originBase: string,
): Template["layers"][number] {
  if (layer.type === "group") {
    return {
      ...layer,
      children: layer.children.map((l) => rewriteLayerAssetUrls(l, originBase)),
    };
  }
  if (layer.type === "image" || layer.type === "video") {
    if (typeof layer.src === "string") {
      return { ...layer, src: rewriteAssetUrlToHost(layer.src, originBase) };
    }
  }
  return layer;
}

export function rewriteHotcardAssetUrls(h: Hotcard, originBase: string): Hotcard {
  return { ...h, data: rewriteDataRecord(h.data, originBase) };
}

export function rewriteShowAssetUrls(s: Show, originBase: string): Show {
  return {
    ...s,
    rows: s.rows.map((row) =>
      row.kind === "graphic"
        ? { ...row, data: rewriteDataRecord(row.data, originBase) }
        : row,
    ),
  };
}

function rewriteDataRecord(
  data: Record<string, string>,
  originBase: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = rewriteAssetUrlToHost(v, originBase);
  }
  return out;
}

/**
 * Walk a template and replace every inline `data:` URL — layer src, field
 * default, font src — by awaiting `transform(dataUrl)` and substituting
 * its return value. Used to lift legacy embedded base64 (PNG icons, TTF
 * fonts) out of the template JSON and into the content-addressed asset
 * store. Without this, a single 600KB template stuck inside a WS
 * `save_template` payload makes the server's recursive Zod parse take
 * 30+ seconds.
 *
 * Non-data: strings are passed through untouched, so calling this on a
 * template that's already been migrated is a cheap no-op.
 */
export async function liftInlineDataUrlsInTemplate(
  t: Template,
  transform: (dataUrl: string) => Promise<string>,
): Promise<Template> {
  const liftStr = async (s: string | undefined): Promise<string | undefined> => {
    if (s === undefined) return s;
    if (!s.startsWith("data:")) return s;
    return transform(s);
  };

  const fields = await Promise.all(
    t.fields.map(async (f) => {
      if (f.default === undefined) return f;
      const replaced = await liftStr(f.default);
      return replaced === f.default ? f : { ...f, default: replaced };
    }),
  );
  const fonts = await Promise.all(
    (t.fonts ?? []).map(async (f) => {
      const replaced = await liftStr(f.src);
      return replaced === f.src ? f : { ...f, src: replaced ?? "" };
    }),
  );
  const layers = await Promise.all(t.layers.map((l) => liftLayer(l, liftStr)));
  return { ...t, fields, fonts, layers };
}

async function liftLayer(
  layer: Template["layers"][number],
  liftStr: (s: string | undefined) => Promise<string | undefined>,
): Promise<Template["layers"][number]> {
  if (layer.type === "group") {
    const children = await Promise.all(layer.children.map((c) => liftLayer(c, liftStr)));
    return { ...layer, children };
  }
  if ((layer.type === "image" || layer.type === "video") && typeof layer.src === "string") {
    const replaced = await liftStr(layer.src);
    if (replaced !== layer.src) {
      return { ...layer, src: replaced ?? "" };
    }
  }
  return layer;
}

/** Lift inline data URLs in a hotcard's data values. */
export async function liftInlineDataUrlsInHotcard(
  h: Hotcard,
  transform: (dataUrl: string) => Promise<string>,
): Promise<Hotcard> {
  const data = await liftDataRecord(h.data, transform);
  return data === h.data ? h : { ...h, data };
}

/** Lift inline data URLs in every graphic row's data values. */
export async function liftInlineDataUrlsInShow(
  s: Show,
  transform: (dataUrl: string) => Promise<string>,
): Promise<Show> {
  const rows = await Promise.all(
    s.rows.map(async (row) => {
      if (row.kind !== "graphic") return row;
      const data = await liftDataRecord(row.data, transform);
      return data === row.data ? row : { ...row, data };
    }),
  );
  return { ...s, rows };
}

async function liftDataRecord(
  data: Record<string, string>,
  transform: (dataUrl: string) => Promise<string>,
): Promise<Record<string, string>> {
  let changed = false;
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(data).map(async ([k, v]) => {
      if (typeof v === "string" && v.startsWith("data:")) {
        out[k] = await transform(v);
        changed = true;
      } else {
        out[k] = v;
      }
    }),
  );
  return changed ? out : data;
}

export type Detected =
  | { kind: "bundle"; bundle: Bundle }
  | { kind: "song"; song: Song }
  | { kind: "template"; template: Template }
  | { kind: "show"; show: Show }
  | { kind: "hotcard"; hotcard: Hotcard }
  | { kind: "error"; message: string };

export function detectImport(json: unknown): Detected {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { kind: "error", message: "expected a JSON object" };
  }
  const obj = json as Record<string, unknown>;

  // Shape-sniff rather than zod-parse. The recursive LayerSchema (z.lazy +
  // discriminated union with per-field defaults) makes BundleSchema.safeParse
  // walk every layer/keyframe/transform and allocate a fresh object at every
  // recursion — minutes of frozen UI for a bundle with non-trivial templates.
  // The producer is this app, and the server re-validates each entity on save,
  // so a structural check here is sufficient.
  if (obj.format === "overlaysys-bundle") {
    if (
      !Array.isArray(obj.songs) ||
      !Array.isArray(obj.templates) ||
      !Array.isArray(obj.shows)
    ) {
      return {
        kind: "error",
        message: "invalid bundle: expected songs/templates/shows arrays",
      };
    }
    const bundle: Bundle = {
      format: "overlaysys-bundle",
      version: 1,
      exportedAt:
        typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
      songs: obj.songs as Song[],
      templates: obj.templates as Template[],
      shows: obj.shows as Show[],
      hotcards: Array.isArray(obj.hotcards) ? (obj.hotcards as Hotcard[]) : [],
      channels: Array.isArray(obj.channels) ? (obj.channels as ChannelConfig[]) : [],
      channelOverrides: Array.isArray(obj.channelOverrides)
        ? (obj.channelOverrides as ProjectChannelOverride[])
        : [],
      assets: Array.isArray(obj.assets) ? (obj.assets as BundleAsset[]) : [],
      ...(typeof obj.name === "string" ? { name: obj.name } : {}),
    };
    return { kind: "bundle", bundle };
  }

  // Single-entity files — distinguish by required-field presence. Order
  // matters: Template before Song (a song never has `layers`); Hotcard
  // before Show because a hotcard also has rows-less {id, name} but with
  // templateId + data; Show last (rows array).
  if (Array.isArray(obj.layers) && obj.timelines && typeof obj.timelines === "object") {
    return { kind: "template", template: obj as unknown as Template };
  }
  if (Array.isArray(obj.sections) && Array.isArray(obj.defaultArrangement)) {
    return { kind: "song", song: obj as unknown as Song };
  }
  if (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.templateId === "string" &&
    typeof obj.data === "object" &&
    obj.data !== null &&
    !Array.isArray(obj.data)
  ) {
    return { kind: "hotcard", hotcard: obj as unknown as Hotcard };
  }
  if (Array.isArray(obj.rows) && typeof obj.id === "string" && typeof obj.name === "string") {
    return { kind: "show", show: obj as unknown as Show };
  }

  return {
    kind: "error",
    message: "not a bundle, song, template, show, or hotcard",
  };
}
