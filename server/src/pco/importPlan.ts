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
  resolveImportedSongId,
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

export interface SongDecision {
  action: "link" | "create";
  /** For `link`: the library song id to reference (overrides auto-match). */
  songId?: string;
}

export interface ImportPlanRequest {
  serviceTypeId: string;
  planId: string;
  planTitle?: string;
  target: ImportTarget;
  lyricTemplateId?: string;
  graphicTemplateId?: string;
  selectedItemIds: string[];
  /** Per-item overrides keyed by PCO item id; falls back to auto-match. */
  songDecisions?: Record<string, SongDecision>;
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

  // Resolve default templates (request → config → first available).
  const config = await loadPcoConfig();
  const metas = await listTemplateMetas();
  const lyricTemplateId =
    req.lyricTemplateId ?? config.defaultLyricTemplateId ?? metas[0]?.id;
  const graphicTemplateId =
    req.graphicTemplateId ?? config.defaultGraphicTemplateId ?? metas[0]?.id;
  if (!lyricTemplateId || !graphicTemplateId) {
    return {
      ok: false,
      counts,
      warnings,
      errors: [{ itemId: "", message: "No templates available to assign to imported rows." }],
    };
  }
  const graphicTemplate = await getTemplate(graphicTemplateId);
  const titleField = graphicTemplate?.fields.find((f) => f.type === "text")?.key;

  // Fetch authoritative plan items and keep selection in plan order.
  const allItems = await client.getPlanItems(req.serviceTypeId, req.planId);
  const selected = new Set(req.selectedItemIds);
  const chosen = allItems.filter((i) => selected.has(i.id));

  // ── 1. Resolve/create library songs first ────────────────────────────
  const library = await songs.listSongs();
  const existingIds = new Set(library.map((s) => s.id));
  const songIdByItem = new Map<string, string>();

  for (const item of chosen) {
    if (item.itemType !== "song" || !item.song) continue;
    const pcoSong = item.song;
    const decision = req.songDecisions?.[item.id];

    if (decision?.action === "link" && decision.songId) {
      songIdByItem.set(item.id, decision.songId);
      counts.songsLinked++;
      continue;
    }
    if (!decision) {
      // Auto-match. A match to a *pre-existing* library song (by CCLI or
      // title) is linked and left untouched. A match by `pco-id` means we
      // imported this song before — fall through to refresh it in place.
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

  // ── 3. Build rows (song → song row, everything else → graphic) ───────
  for (const item of chosen) {
    const sourceRef = makeSourceRef(req.serviceTypeId, req.planId, item.id);
    const existingIdx = show.rows.findIndex((r) => r.sourceRef?.itemId === item.id);
    const rowId = existingIdx >= 0 ? show.rows[existingIdx]!.id : randomUUID();

    let row: RundownRow;
    const songId = songIdByItem.get(item.id);
    if (item.itemType === "song" && songId) {
      row = buildSongRow({ rowId, songId, lyricTemplateId, sourceRef });
      show.songs = ensureShowSongEntry(show.songs, songId);
    } else {
      row = buildGraphicRow({ rowId, templateId: graphicTemplateId, item, titleField, sourceRef });
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
