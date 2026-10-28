import { randomUUID } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  PCO_ARRANGEMENT_ID_KEY,
  PCO_SONG_ID_KEY,
  ShowSchema,
  SongSchema,
  buildGraphicRow,
  buildImportedSong,
  buildSongRow,
  effectiveLyricsArrangement,
  ensureShowSongEntry,
  makeSourceRef,
  matchLibrarySong,
  pcoItemGraphicDefaults,
  resolveImportedSongId,
  // [P1.19]
  isPcoSectionId,
  mergePlanSections,
  orderRowsBySection,
  planHeaderSections,
  // [/P1.19]
  type Field,
  type PcoPlanItem,
  type RundownRow,
  type Show,
  type Song,
} from "@overlaysys/core";
import * as songs from "../songs";
import * as shows from "../shows";
import { getTemplate, listTemplateMetas } from "../templates";
import { loadPcoConfig } from "../storage";
import { loadScriptureSettings } from "../scriptureSettings";
import type { PcoClient } from "./pcoClient";
import { buildImportedScriptureRow } from "./scriptureImport";

export interface ImportTarget {
  mode: "new" | "existing";
  showId?: string;
  name?: string;
  projectId?: string;
}

/**
 * Per-item import configuration from the operator UI. `kind` chooses whether a
 * (song) plan item becomes a library-backed song row, a plain graphic row, or
 * a scripture row; `templateId` is the lyric template (song), graphic template
 * (graphic) or scripture slide template (scripture);
 * `data` holds the configured graphic field values.
 */
export interface ImportItemConfig {
  itemId: string;
  kind: "song" | "graphic" | "scripture";
  /** Song kind: link an existing library song or create/update one. */
  songAction?: "link" | "create";
  /** Song kind + link: the library song id to reference. */
  songId?: string;
  /**
   * Song kind + create: a fully configured song from the import UI, persisted
   * as-is. The server still owns the id, the PCO custom-field stamps and
   * `updatedAt` — a client id is never trusted.
   */
  song?: Song;
  /** Lyric template (song) or graphic template (graphic). */
  templateId?: string;
  /** Graphic kind: configured template field values. */
  data?: Record<string, string>;
  /** Graphic/scripture kind: optional row notes. */
  notes?: string;
  /** Scripture kind: reference text, e.g. "John 3:16-18". */
  reference?: string;
  /** Scripture kind: translation id (TranslationMeta.id). */
  translation?: string;
  /** Scripture kind: max characters per auto-split slide. */
  slideMaxChars?: number;
}

export interface ImportPlanRequest {
  serviceTypeId: string;
  planId: string;
  planTitle?: string;
  /** PCO plan `sort_date` (e.g. "2026-07-19T09:00:00Z"); dates the show. */
  planDate?: string;
  target: ImportTarget;
  items: ImportItemConfig[];
  /** Fallback templates when an item config omits `templateId`. */
  defaultLyricTemplateId?: string;
  defaultGraphicTemplateId?: string;
  /**
   * Existing-show target: move the rows imported from this plan into plan
   * order (rows not from this plan keep their slots). Off by default — the
   * operator may have reordered on purpose.
   */
  reorderToPlan?: boolean;
}

/** A row imported from this plan whose PCO item is no longer in the plan. */
export interface RemovedPlanRow {
  rowId: string;
  itemId: string;
  /** Best-effort label for the UI (song title, graphic text, reference). */
  label?: string;
}

export interface ImportPlanResult {
  ok: boolean;
  showId?: string;
  counts: {
    rows: number;
    songsCreated: number;
    songsLinked: number;
    songsUpdated: number;
    // [P1.19]
    /** PCO header sections in the saved show. */
    sections: number;
    /** Rows from an older import that were headers; removed (they are sections now). */
    headerRowsConverted: number;
    // [/P1.19]
  };
  /**
   * Library song ids this import wrote (created or updated in place), in write
   * order and deduped. Callers need this to tell open clients which songs
   * changed: a `song_list` broadcast only carries metadata, and editors that
   * already cache a full song skip re-fetching it — so without a full-song
   * push they keep rendering the pre-import content.
   */
  writtenSongIds: string[];
  /**
   * Rows in the target show imported from this plan whose item has since
   * been removed from the plan. They are left in place for the operator to
   * review and delete.
   */
  removedRows: RemovedPlanRow[];
  /** Whether re-imported rows were moved into plan order (reorderToPlan). */
  reordered: boolean;
  warnings: string[];
  errors: { itemId: string; message: string }[];
}

/**
 * Date-only service date from a PCO `sort_date`. PCO writes the service's
 * wall-clock time with a `Z` suffix, so the leading date is the local date —
 * converting through `Date` would shift evening services across midnight.
 */
export function planServiceDate(sortDate: string | undefined): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(sortDate ?? "");
  return m ? m[1] : undefined;
}

/**
 * Carry operator-owned fields from the row being replaced onto its re-imported
 * replacement: the sermon-notes link, and a manually set length.
 */
function carryOver(old: RundownRow, row: RundownRow): RundownRow {
  const next: RundownRow = { ...row };
  if (old.sermonNotesId) next.sermonNotesId = old.sermonNotesId;
  if (old.lengthSecManual) {
    next.lengthSecManual = true;
    if (old.lengthSec !== undefined) next.lengthSec = old.lengthSec;
    else delete next.lengthSec;
  }
  return next;
}

/**
 * Song fields the operator sets in the library (templates, intro/outro
 * mappings, channel). A re-import refreshes lyrics and PCO metadata, but a
 * PCO song carries none of these, so an incoming `undefined` means "not
 * specified" and the library's value is kept.
 */
export const OPERATOR_SONG_DEFAULT_KEYS = [
  "defaultLyricTemplateId",
  "defaultIntroTemplateId",
  "defaultIntroFieldMap",
  "defaultIntroFieldLiterals",
  "defaultOutroTemplateId",
  "defaultOutroFieldMap",
  "defaultOutroFieldLiterals",
  "defaultChannel",
] as const satisfies readonly (keyof Song)[];

export function keepSongDefaults(existing: Song | undefined, next: Song): Song {
  if (!existing) return next;
  const out: Song = { ...next };
  for (const key of OPERATOR_SONG_DEFAULT_KEYS) {
    if (out[key] === undefined && existing[key] !== undefined) {
      (out as Record<string, unknown>)[key] = existing[key];
    }
  }
  return out;
}

function isFromPlan(r: RundownRow, serviceTypeId: string, planId: string): boolean {
  const ref = r.sourceRef;
  return !!ref && ref.provider === "pco" && ref.serviceTypeId === serviceTypeId && ref.planId === planId;
}

/** Where a plan item already lives: the shows holding a row imported from it. */
export interface ImportedItemShow {
  showId: string;
  showName: string;
}

/**
 * itemId → shows that already contain a row imported from that item of
 * (serviceTypeId, planId). Drives the "already imported" badge.
 */
export function findImportedItems(
  liveShows: readonly Pick<Show, "id" | "name" | "rows">[],
  serviceTypeId: string,
  planId: string,
): Record<string, ImportedItemShow[]> {
  const out: Record<string, ImportedItemShow[]> = {};
  for (const show of liveShows) {
    const seen = new Set<string>();
    for (const r of show.rows) {
      if (!isFromPlan(r, serviceTypeId, planId)) continue;
      const itemId = r.sourceRef!.itemId;
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      (out[itemId] ??= []).push({ showId: show.id, showName: show.name });
    }
  }
  return out;
}

/** Rows imported from (serviceTypeId, planId) whose item id isn't in the plan any more. */
export function findRemovedPlanRows(
  rows: readonly RundownRow[],
  serviceTypeId: string,
  planId: string,
  planItemIds: ReadonlySet<string>,
  songTitle: (songId: string) => string | undefined,
): RemovedPlanRow[] {
  const out: RemovedPlanRow[] = [];
  for (const r of rows) {
    if (!isFromPlan(r, serviceTypeId, planId) || planItemIds.has(r.sourceRef!.itemId)) continue;
    let label: string | undefined;
    if (r.kind === "song") label = songTitle(r.songId);
    else if (r.kind === "graphic") label = Object.values(r.data ?? {}).find((v) => typeof v === "string" && v.trim());
    else if (r.kind === "scripture") label = r.reference;
    out.push({ rowId: r.id, itemId: r.sourceRef!.itemId, ...(label ? { label } : {}) });
  }
  return out;
}

/**
 * Put rows sourced from (serviceTypeId, planId) and still in the plan into
 * plan order, reusing the slots those rows occupy. Every other row (manual,
 * other plans, removed from the plan) keeps its index. Returns the same
 * array when nothing moves.
 */
export function reorderRowsToPlan(
  rows: RundownRow[],
  serviceTypeId: string,
  planId: string,
  planOrder: readonly string[],
): RundownRow[] {
  const rank = new Map(planOrder.map((id, i) => [id, i]));
  const slots: number[] = [];
  const planRows: RundownRow[] = [];
  rows.forEach((r, i) => {
    if (isFromPlan(r, serviceTypeId, planId) && rank.has(r.sourceRef!.itemId)) {
      slots.push(i);
      planRows.push(r);
    }
  });
  const sorted = planRows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank.get(a.r.sourceRef!.itemId)! - rank.get(b.r.sourceRef!.itemId)! || a.i - b.i)
    .map((x) => x.r);
  if (sorted.every((r, i) => r === planRows[i])) return rows;
  const next = rows.slice();
  slots.forEach((slot, i) => {
    next[slot] = sorted[i]!;
  });
  return next;
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
  const counts = {
    rows: 0,
    songsCreated: 0,
    songsLinked: 0,
    songsUpdated: 0,
    // [P1.19]
    sections: 0,
    headerRowsConverted: 0,
    // [/P1.19]
  };
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
  // [P1.19] Headers become show sections, never rows, whatever the config says.
  const chosen = allItems.filter((i) => cfgById.has(i.id) && i.itemType !== "header");
  const { sections: planSections, sectionByItem } = planHeaderSections(allItems);
  const importedRowIds = new Set<string>();
  // [/P1.19]

  // Memoize each template's field list (used only when a config omits explicit
  // field data and we fall back to deriving values from the plan item).
  const templateFieldsCache = new Map<string, Field[]>();
  async function templateFieldsFor(templateId: string): Promise<Field[]> {
    const hit = templateFieldsCache.get(templateId);
    if (hit) return hit;
    const tpl = await getTemplate(templateId);
    const fields = tpl?.fields ?? [];
    templateFieldsCache.set(templateId, fields);
    return fields;
  }

  /** Whether a config may be treated as a song (needs real PCO song data). */
  function isSongConfig(item: PcoPlanItem, cfg: ImportItemConfig): boolean {
    return cfg.kind === "song" && item.itemType === "song" && !!item.song;
  }

  // ── 1. Resolve/create library songs for song-kind items ──────────────
  const library = await songs.listSongs();
  const existingIds = new Set(library.map((s) => s.id));
  const songIdByItem = new Map<string, string>();
  // Every library song actually persisted below — reported to the caller so it
  // can broadcast the full song to connected clients.
  const writtenSongIds = new Set<string>();
  // Items whose song could not be persisted. They are skipped in the row loop
  // rather than silently falling through to a graphic row.
  const failedItems = new Set<string>();

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
    // Lyrics (and the sequence that orders them) may come from a sibling
    // arrangement when the plan item's own has none — see pcoClient.
    const lyricsArrangement = effectiveLyricsArrangement(item);

    let songToSave: Song;
    if (cfg.song) {
      // The operator configured this song in the import UI: persist their
      // draft verbatim, but keep ownership of identity + PCO stamps.
      const parsed = SongSchema.safeParse(cfg.song);
      if (!parsed.success) {
        errors.push({ itemId: item.id, message: `Invalid song configuration: ${parsed.error.message}` });
        failedItems.add(item.id);
        continue;
      }
      songToSave = {
        ...parsed.data,
        id,
        // A client draft must never resurrect (or create) a tombstone: the
        // show row would point at a song the library treats as deleted.
        deletedAt: undefined,
        customFields: {
          ...(existing?.customFields ?? {}),
          ...parsed.data.customFields,
          [PCO_SONG_ID_KEY]: pcoSong.id,
          ...(lyricsArrangement ? { [PCO_ARRANGEMENT_ID_KEY]: lyricsArrangement.id } : {}),
        },
        updatedAt: now,
      };
    } else {
      const built = buildImportedSong(id, pcoSong, lyricsArrangement, {
        updatedAt: now,
        preserveCustomFields: existing?.customFields,
      });
      warnings.push(...built.warnings);
      songToSave = built.song;
    }

    // Re-import refreshes lyrics/metadata but must not wipe the operator's
    // library defaults (templates, intro/outro, channel).
    songToSave = keepSongDefaults(existing, songToSave);

    try {
      await songs.saveSong(songToSave);
    } catch (err) {
      errors.push({ itemId: item.id, message: err instanceof Error ? err.message : String(err) });
      failedItems.add(item.id);
      continue;
    }
    writtenSongIds.add(id);
    if (existing) {
      counts.songsUpdated++;
    } else {
      counts.songsCreated++;
      existingIds.add(id);
      library.push(songToSave);
    }
    songIdByItem.set(item.id, id);
  }

  // ── 2. Resolve the target show ───────────────────────────────────────
  let show: Show;
  if (req.target.mode === "existing") {
    if (!req.target.showId) {
      return {
        ok: false,
        counts,
        writtenSongIds: [...writtenSongIds],
        removedRows: [],
        reordered: false,
        warnings,
        errors: [{ itemId: "", message: "existing target requires showId" }],
      };
    }
    const found = await shows.getShow(req.target.showId);
    if (!found) {
      return {
        ok: false,
        counts,
        writtenSongIds: [...writtenSongIds],
        removedRows: [],
        reordered: false,
        warnings,
        errors: [{ itemId: "", message: `show ${req.target.showId} not found` }],
      };
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

  // [P1.19] Rows an older import made from header items are sections now.
  const headerItemIds = new Set(allItems.filter((i) => i.itemType === "header").map((i) => i.id));
  const rowsBefore = show.rows.length;
  show.rows = show.rows.filter(
    (r) => !(isFromPlan(r, req.serviceTypeId, req.planId) && headerItemIds.has(r.sourceRef!.itemId)),
  );
  counts.headerRowsConverted = rowsBefore - show.rows.length;
  // [/P1.19]

  // ── 3. Build rows per item config (song row vs graphic row) ──────────
  for (const item of chosen) {
    if (failedItems.has(item.id)) continue;
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
    } else if (cfg.kind === "scripture") {
      if (!cfg.reference?.trim() || !cfg.translation) {
        errors.push({ itemId: item.id, message: "Scripture item needs a reference and translation." });
        continue;
      }
      const templateId =
        cfg.templateId ?? (await loadScriptureSettings()).defaultTemplateId ?? fallbackGraphic;
      if (!templateId) {
        errors.push({ itemId: item.id, message: "No scripture template available for row." });
        continue;
      }
      try {
        row = await buildImportedScriptureRow({
          rowId,
          reference: cfg.reference,
          translation: cfg.translation,
          templateId,
          slideMaxChars: cfg.slideMaxChars,
          notes: cfg.notes ?? pcoItemGraphicDefaults(item, []).notes,
          sourceRef,
          existing: existingIdx >= 0 ? show.rows[existingIdx] : undefined,
        });
      } catch (err) {
        errors.push({
          itemId: item.id,
          message: `Scripture "${cfg.reference}": ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
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
        const defaults = pcoItemGraphicDefaults(item, await templateFieldsFor(templateId));
        if (!hasData) data = defaults.data;
        if (notes === undefined) notes = defaults.notes;
      }
      row = buildGraphicRow({ rowId, templateId, data, notes, sourceRef });
    }
    if (item.lengthSec) row = { ...row, lengthSec: item.lengthSec };

    // [P1.19] A section the operator chose (not a PCO one) survives re-import.
    const prevSection = existingIdx >= 0 ? show.rows[existingIdx]!.sectionId : undefined;
    const sectionId =
      prevSection !== undefined && !isPcoSectionId(prevSection) ? prevSection : sectionByItem.get(item.id);
    if (sectionId !== undefined) row = { ...row, sectionId };
    importedRowIds.add(row.id);
    // [/P1.19]

    if (existingIdx >= 0) {
      show.rows[existingIdx] = carryOver(show.rows[existingIdx]!, row);
    } else show.rows.push(row);
    counts.rows++;
  }

  // Rows from earlier imports of this plan whose item was since removed in
  // PCO: flag them (left in place) so the operator can review.
  const titleById = new Map(library.map((s) => [s.id, s.title]));
  const removedRows = findRemovedPlanRows(
    show.rows,
    req.serviceTypeId,
    req.planId,
    new Set(allItems.map((i) => i.id)),
    (id) => titleById.get(id),
  );
  if (removedRows.length > 0) {
    warnings.push(
      `${removedRows.length} row${removedRows.length === 1 ? " was" : "s were"} removed from the plan in Planning Center: ` +
        removedRows.map((r) => r.label ?? r.itemId).join(", "),
    );
  }

  let reordered = false;
  if (req.reorderToPlan) {
    // getPlanItems returns plan order already; sort by sequence defensively.
    const planOrder = allItems
      .map((it, i) => ({ id: it.id, seq: it.sequence ?? i }))
      .sort((a, b) => a.seq - b.seq)
      .map((x) => x.id);
    const next = reorderRowsToPlan(show.rows, req.serviceTypeId, req.planId, planOrder);
    reordered = next !== show.rows;
    show.rows = next;
  }

  // [P1.19] Merge PCO header sections (only those that hold rows) and keep
  // rows in display order.
  const usedSections = new Set(show.rows.map((r) => r.sectionId).filter((x): x is string => x !== undefined));
  const mergedSections = mergePlanSections(show.sections, planSections, (id) => usedSections.has(id));
  if (mergedSections) show.sections = mergedSections;
  else delete show.sections;
  // Rows not imported this run (manual, other plans) and without a section
  // inherit the nearest preceding row's section, so they keep their place.
  let carried: string | undefined;
  show.rows = show.rows.map((r) => {
    if (r.sectionId !== undefined) {
      carried = r.sectionId;
      return r;
    }
    return carried !== undefined && !importedRowIds.has(r.id) ? ({ ...r, sectionId: carried } as RundownRow) : r;
  });
  show = orderRowsBySection(show);
  counts.sections = (show.sections ?? []).filter((s) => isPcoSectionId(s.id)).length;
  // [/P1.19]

  // Date the show from the plan. A show that already has a date keeps it —
  // the operator may have set it deliberately.
  const serviceDate = planServiceDate(req.planDate);
  if (serviceDate && !show.scheduledFor) show.scheduledFor = serviceDate;

  show.updatedAt = now;

  // Validate the assembled show before persisting — this path doesn't go
  // through the WS ShowSchema boundary, so parse here (small payloads).
  const parsed = ShowSchema.parse(show);
  await shows.saveShow(parsed);

  return {
    ok: errors.length === 0,
    showId: parsed.id,
    counts,
    writtenSongIds: [...writtenSongIds],
    removedRows,
    reordered,
    warnings,
    errors,
  };
}
