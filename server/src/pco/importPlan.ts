import { randomUUID } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  PCO_SONG_ID_KEY,
  ShowSchema,
  buildGraphicRow,
  buildImportedSong,
  buildSongRow,
  ensureShowSongEntry,
  makeSourceRef,
  matchLibrarySong,
  pcoItemGraphicDefaults,
  resolveImportedSongId,
  type PcoPlanItem,
  type RundownRow,
  type Show,
} from "@overlaysys/core";
import * as songs from "../songs";
import * as shows from "../shows";
import { getTemplate, listTemplateMetas } from "../templates";
import { loadPcoConfig } from "../storage";
import type { PcoClient } from "./pcoClient";

export interface ImportTarget {
  mode: "new" | "existing";
  showId?: string;
  name?: string;
  projectId?: string;
}

/**
 * Per-item import configuration from the operator UI. `kind` chooses whether a
 * (song) plan item becomes a library-backed song row or a plain graphic row;
 * `templateId` is the lyric template (song) or graphic template (graphic);
 * `data` holds the configured graphic field values.
 */
export interface ImportItemConfig {
  itemId: string;
  kind: "song" | "graphic";
  /** Song kind: link an existing library song or create/update one. */
  songAction?: "link" | "create";
  /** Song kind + link: the library song id to reference. */
  songId?: string;
  /** Lyric template (song) or graphic template (graphic). */
  templateId?: string;
  /** Graphic kind: configured template field values. */
  data?: Record<string, string>;
  /** Graphic kind: optional row notes. */
  notes?: string;
}

export interface ImportPlanRequest {
  serviceTypeId: string;
  planId: string;
  planTitle?: string;
  target: ImportTarget;
  items: ImportItemConfig[];
  /** Fallback templates when an item config omits `templateId`. */
  defaultLyricTemplateId?: string;
  defaultGraphicTemplateId?: string;
}

export interface ImportPlanResult {
  ok: boolean;
  showId?: string;
  counts: {
    rows: number;
    songsCreated: number;
    songsLinked: number;
    songsUpdated: number;
  };
  warnings: string[];
  errors: { itemId: string; message: string }[];
}

/**
 * Import selected Planning Center plan items into a new or existing show.
 * Idempotent: rows are matched to prior imports by `sourceRef.itemId` and
 * updated in place; created songs are matched by `customFields.pco_song_id`.
 * `now` is injected (ISO string) so the orchestration stays deterministic in
 * tests.
 */
export async function importPlan(
  client: PcoClient,
  req: ImportPlanRequest,
  now: string,
): Promise<ImportPlanResult> {
  const counts = { rows: 0, songsCreated: 0, songsLinked: 0, songsUpdated: 0 };
  const warnings: string[] = [];
  const errors: { itemId: string; message: string }[] = [];

  // Resolve fallback templates (request → config → first available), used only
  // when an item config omits its own templateId.
  const config = await loadPcoConfig();
  const metas = await listTemplateMetas();
  const fallbackLyric =
    req.defaultLyricTemplateId ?? config.defaultLyricTemplateId ?? metas[0]?.id;
  const fallbackGraphic =
    req.defaultGraphicTemplateId ?? config.defaultGraphicTemplateId ?? metas[0]?.id;

  // Fetch authoritative plan items; keep the configured items in plan order.
  const allItems = await client.getPlanItems(req.serviceTypeId, req.planId);
  const cfgById = new Map(req.items.map((c) => [c.itemId, c]));
  const chosen = allItems.filter((i) => cfgById.has(i.id));

  // Memoize each template's first text field (the title target) for graphic
  // fallbacks — only loaded when a config omits explicit field data.
  const titleFieldCache = new Map<string, string | undefined>();
  async function titleFieldFor(templateId: string): Promise<string | undefined> {
    if (titleFieldCache.has(templateId)) return titleFieldCache.get(templateId);
    const tpl = await getTemplate(templateId);
    const key = tpl?.fields.find((f) => f.type === "text")?.key;
    titleFieldCache.set(templateId, key);
    return key;
  }

  /** Whether a config may be treated as a song (needs real PCO song data). */
  function isSongConfig(item: PcoPlanItem, cfg: ImportItemConfig): boolean {
    return cfg.kind === "song" && item.itemType === "song" && !!item.song;
  }

  // ── 1. Resolve/create library songs for song-kind items ──────────────
  const library = await songs.listSongs();
  const existingIds = new Set(library.map((s) => s.id));
  const songIdByItem = new Map<string, string>();

  for (const item of chosen) {
    const cfg = cfgById.get(item.id)!;
    if (!isSongConfig(item, cfg) || !item.song) continue;
    const pcoSong = item.song;

    if (cfg.songAction === "link" && cfg.songId) {
      songIdByItem.set(item.id, cfg.songId);
      counts.songsLinked++;
      continue;
    }
    if (!cfg.songAction) {
      // No explicit action: link a pre-existing match (CCLI/title); a
      // `pco-id` match means we imported it before — refresh it in place.
      const match = matchLibrarySong(pcoSong, library);
      if (match && match.confidence !== "pco-id") {
        songIdByItem.set(item.id, match.song.id);
        counts.songsLinked++;
        continue;
      }
    }

    // Create — or update a previously imported song in place.
    const existing = library.find(
      (s) => !s.deletedAt && s.customFields?.[PCO_SONG_ID_KEY] === pcoSong.id,
    );
    const id = existing ? existing.id : resolveImportedSongId(pcoSong, existingIds);
    const built = buildImportedSong(id, pcoSong, item.arrangement, {
      updatedAt: now,
      preserveCustomFields: existing?.customFields,
    });
    warnings.push(...built.warnings);
    try {
      await songs.saveSong(built.song);
    } catch (err) {
      errors.push({ itemId: item.id, message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (existing) {
      counts.songsUpdated++;
    } else {
      counts.songsCreated++;
      existingIds.add(id);
      library.push(built.song);
    }
    songIdByItem.set(item.id, id);
  }

  // ── 2. Resolve the target show ───────────────────────────────────────
  let show: Show;
  if (req.target.mode === "existing") {
    if (!req.target.showId) {
      return { ok: false, counts, warnings, errors: [{ itemId: "", message: "existing target requires showId" }] };
    }
    const found = await shows.getShow(req.target.showId);
    if (!found) {
      return { ok: false, counts, warnings, errors: [{ itemId: "", message: `show ${req.target.showId} not found` }] };
    }
    show = structuredClone(found);
  } else {
    show = {
      id: `show-${randomUUID().slice(0, 8)}`,
      name: req.target.name ?? req.planTitle ?? "Imported Plan",
      projectId: req.target.projectId ?? DEFAULT_PROJECT_ID,
      rows: [],
      songs: [],
    };
  }

  // ── 3. Build rows per item config (song row vs graphic row) ──────────
  for (const item of chosen) {
    const cfg = cfgById.get(item.id)!;
    const sourceRef = makeSourceRef(req.serviceTypeId, req.planId, item.id);
    const existingIdx = show.rows.findIndex((r) => r.sourceRef?.itemId === item.id);
    const rowId = existingIdx >= 0 ? show.rows[existingIdx]!.id : randomUUID();

    let row: RundownRow;
    const songId = songIdByItem.get(item.id);
    if (isSongConfig(item, cfg) && songId) {
      const lyricTemplateId = cfg.templateId ?? fallbackLyric;
      if (!lyricTemplateId) {
        errors.push({ itemId: item.id, message: "No lyric template available for song row." });
        continue;
      }
      row = buildSongRow({ rowId, songId, lyricTemplateId, sourceRef });
      show.songs = ensureShowSongEntry(show.songs, songId);
    } else {
      const templateId = cfg.templateId ?? fallbackGraphic;
      if (!templateId) {
        errors.push({ itemId: item.id, message: "No graphic template available for row." });
        continue;
      }
      // Prefer the client's configured field values; fall back to seeding the
      // item title into the template's first text field + description → notes.
      const hasData = !!cfg.data && Object.keys(cfg.data).length > 0;
      let data = cfg.data;
      let notes = cfg.notes;
      if (!hasData || notes === undefined) {
        const defaults = pcoItemGraphicDefaults(item, await titleFieldFor(templateId));
        if (!hasData) data = defaults.data;
        if (notes === undefined) notes = defaults.notes;
      }
      row = buildGraphicRow({ rowId, templateId, data, notes, sourceRef });
    }

    if (existingIdx >= 0) show.rows[existingIdx] = row;
    else show.rows.push(row);
    counts.rows++;
  }

  show.updatedAt = now;

  // Validate the assembled show before persisting — this path doesn't go
  // through the WS ShowSchema boundary, so parse here (small payloads).
  const parsed = ShowSchema.parse(show);
  await shows.saveShow(parsed);

  return { ok: errors.length === 0, showId: parsed.id, counts, warnings, errors };
}
