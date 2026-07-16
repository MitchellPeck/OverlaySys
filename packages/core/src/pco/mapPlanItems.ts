import { type Section, type Song } from "../song";
import type {
  GraphicRow,
  RowSourceRef,
  ShowSong,
  SongRow,
} from "../show";
import { slugifyTitle } from "../songSelectParser";
import { parsePlainLyrics } from "../parsePlainLyrics";
import type { PcoArrangement, PcoPlanItem, PcoSong } from "./pcoTypes";

/**
 * Pure Planning Center → OverlaySys mapping. No network, no id/time
 * generation (callers pass row ids, timestamps, and template ids in) so the
 * whole module is trivially unit-testable against fixtures.
 */

/** customFields key stashing the originating PCO song id (idempotency key). */
export const PCO_SONG_ID_KEY = "pco_song_id";
/** customFields key stashing the PCO arrangement id the lyrics came from. */
export const PCO_ARRANGEMENT_ID_KEY = "pco_arrangement_id";

export type SongMatchConfidence = "pco-id" | "ccli" | "title";

export interface SongMatch {
  song: Song;
  confidence: SongMatchConfidence;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find the library song a PCO song should link to. Precedence:
 *  1. `pco-id`  — a prior import stamped `customFields.pco_song_id` (exact,
 *     most reliable; keeps re-imports idempotent).
 *  2. `ccli`    — matching CCLI number (the user's primary link key).
 *  3. `title`   — same title slug (best-effort; surfaced as low confidence so
 *     the operator can override).
 * Tombstoned (soft-deleted) songs are ignored. Returns null → create new.
 */
export function matchLibrarySong(
  pcoSong: PcoSong,
  library: Song[],
): SongMatch | null {
  const live = library.filter((s) => !s.deletedAt);

  const byPcoId = live.find(
    (s) => s.customFields?.[PCO_SONG_ID_KEY] === pcoSong.id,
  );
  if (byPcoId) return { song: byPcoId, confidence: "pco-id" };

  if (pcoSong.ccliNumber) {
    const byCcli = live.find((s) => s.ccliNumber === pcoSong.ccliNumber);
    if (byCcli) return { song: byCcli, confidence: "ccli" };
  }

  const slug = slugifyTitle(pcoSong.title);
  const byTitle = live.find(
    (s) => s.id === slug || norm(s.title) === norm(pcoSong.title),
  );
  if (byTitle) return { song: byTitle, confidence: "title" };

  return null;
}

/**
 * Resolve a collision-free library id for a newly imported song, appending
 * `-2`, `-3`, … when the title slug is already taken (mirrors the SongSelect
 * importer). `existingIds` should hold every live song id.
 */
export function resolveImportedSongId(
  pcoSong: PcoSong,
  existingIds: Set<string>,
): string {
  const base = slugifyTitle(pcoSong.title);
  if (!existingIds.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

/**
 * Reorder section ids to follow the PCO arrangement `sequence` (labels like
 * "Verse 1", "Chorus"), matching case-insensitively against section labels.
 * Sequence entries may repeat; unmatched entries are skipped. Falls back to
 * source section order when nothing matches.
 */
export function reorderArrangementBySequence(
  sections: Section[],
  sequence: string[] | undefined,
): string[] {
  const fallback = sections.map((s) => s.id);
  if (!sequence || sequence.length === 0) return fallback;

  const byLabel = new Map<string, string>();
  for (const s of sections) {
    const key = norm(s.label);
    if (!byLabel.has(key)) byLabel.set(key, s.id);
  }

  const ordered: string[] = [];
  for (const label of sequence) {
    const id = byLabel.get(norm(label));
    if (id) ordered.push(id);
  }
  return ordered.length > 0 ? ordered : fallback;
}

const STUB_SECTION: Section = {
  id: "v1",
  kind: "verse",
  label: "Verse 1",
  slides: [{ id: "v1s1", lines: [""] }],
};

export interface BuiltSong {
  song: Song;
  warnings: string[];
}

/**
 * Build a library {@link Song} from a PCO song + arrangement. `id` is supplied
 * by the caller (a fresh slug for new songs, or the existing id when updating
 * a previously imported song in place). Empty arrangements yield a single
 * empty stub section plus a warning rather than failing — PCO often stores
 * lyrics on only one of several arrangements.
 */
export function buildImportedSong(
  id: string,
  pcoSong: PcoSong,
  arrangement: PcoArrangement | undefined,
  opts: { updatedAt?: string; preserveCustomFields?: Record<string, string> } = {},
): BuiltSong {
  const warnings: string[] = [];
  const parsed = parsePlainLyrics(arrangement?.lyrics ?? "");

  let sections: Section[];
  let defaultArrangement: string[];
  if (parsed.sections.length === 0) {
    warnings.push(
      `No lyrics found for "${pcoSong.title}" — created an empty stub.`,
    );
    sections = [STUB_SECTION];
    defaultArrangement = [STUB_SECTION.id];
  } else {
    sections = parsed.sections;
    defaultArrangement = reorderArrangementBySequence(
      sections,
      arrangement?.sequence,
    );
  }

  const customFields: Record<string, string> = {
    ...(opts.preserveCustomFields ?? {}),
    [PCO_SONG_ID_KEY]: pcoSong.id,
  };
  if (arrangement) customFields[PCO_ARRANGEMENT_ID_KEY] = arrangement.id;

  const song: Song = {
    id,
    title: pcoSong.title,
    ...(pcoSong.ccliNumber ? { ccliNumber: pcoSong.ccliNumber } : {}),
    ...(pcoSong.author ? { author: pcoSong.author } : {}),
    ...(pcoSong.copyright ? { copyright: pcoSong.copyright } : {}),
    sections,
    defaultArrangement,
    customFields,
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
  };

  return { song, warnings };
}

export function makeSourceRef(
  serviceTypeId: string,
  planId: string,
  itemId: string,
): RowSourceRef {
  return { provider: "pco", serviceTypeId, planId, itemId };
}

/** Build a rundown song row referencing a resolved library song. */
export function buildSongRow(opts: {
  rowId: string;
  songId: string;
  lyricTemplateId: string;
  sourceRef: RowSourceRef;
}): SongRow {
  return {
    kind: "song",
    id: opts.rowId,
    songId: opts.songId,
    lyricTemplateId: opts.lyricTemplateId,
    sourceRef: opts.sourceRef,
  };
}

/**
 * Default graphic field values + notes for a plan item: the item title lands
 * in `titleField` (the template's first text field, when known) and PCO's
 * plain-text description / html details become the row `notes`. Used to seed
 * the import UI's field form and as a server-side fallback when the client
 * sends no explicit field values.
 */
export function pcoItemGraphicDefaults(
  item: PcoPlanItem,
  titleField?: string,
): { data: Record<string, string>; notes?: string } {
  const notesParts = [item.description, item.htmlDetails].filter(
    (v): v is string => !!v && v.trim() !== "",
  );
  return {
    data: titleField ? { [titleField]: item.title } : {},
    ...(notesParts.length > 0 ? { notes: notesParts.join("\n\n") } : {}),
  };
}

/**
 * Build a graphic row from an explicit template id + field-value `data` map
 * (configured in the import UI). `notes` is optional free text.
 */
export function buildGraphicRow(opts: {
  rowId: string;
  templateId: string;
  data?: Record<string, string>;
  notes?: string;
  sourceRef: RowSourceRef;
}): GraphicRow {
  return {
    kind: "graphic",
    id: opts.rowId,
    templateId: opts.templateId,
    data: opts.data ?? {},
    ...(opts.notes && opts.notes.trim() !== "" ? { notes: opts.notes } : {}),
    sourceRef: opts.sourceRef,
  };
}

/**
 * Ensure a {@link ShowSong} override entry exists for `songId`, mirroring the
 * operator's addSongRow behavior. Returns the (possibly unchanged) list.
 */
export function ensureShowSongEntry(
  songs: ShowSong[],
  songId: string,
): ShowSong[] {
  if (songs.some((s) => s.songId === songId)) return songs;
  return [...songs, { songId }];
}

// ---- Preview (for the selection UI) ------------------------------------

export interface ItemPreview {
  itemId: string;
  title: string;
  itemType: PcoPlanItem["itemType"];
  sequence?: number;
  /** Song items only: the library song this would link to, if any. */
  match?: { songId: string; title: string; confidence: SongMatchConfidence };
  /** Song items with no match will create a new library song. */
  willCreateSong?: boolean;
  /** Song items: whether the referenced arrangement has any lyrics. */
  hasLyrics?: boolean;
}

/**
 * Pre-compute per-item import status against the current library so the
 * operator UI can show "links to X" / "will create" / "no lyrics".
 */
export function buildItemPreview(
  item: PcoPlanItem,
  library: Song[],
): ItemPreview {
  const base: ItemPreview = {
    itemId: item.id,
    title: item.title,
    itemType: item.itemType,
    ...(item.sequence !== undefined ? { sequence: item.sequence } : {}),
  };
  if (item.itemType !== "song" || !item.song) return base;

  const match = matchLibrarySong(item.song, library);
  return {
    ...base,
    ...(match
      ? {
          match: {
            songId: match.song.id,
            title: match.song.title,
            confidence: match.confidence,
          },
        }
      : { willCreateSong: true }),
    hasLyrics: !!item.arrangement?.lyrics && item.arrangement.lyrics.trim() !== "",
  };
}
