// Pure resolution helpers for the song sub-takes feature. These functions
// translate the layered override model (SongRow → ShowSong → Song → fallback)
// into concrete take payloads for the operator UI and any future server-side
// dispatch path. No I/O, no dependency on app or server code.

import type { ShowSong, SongRow } from "./show";
import type { Song } from "./song";
import type { Template } from "./template";

/**
 * Built-in song fields that exist as named properties on `Song`. Anything not
 * in this set is treated as a key into `Song.customFields` (with the usual
 * Row → ShowSong → Song cascade for the value).
 */
const BUILT_IN_SONG_FIELDS = ["title", "ccliNumber", "author", "copyright"] as const;
type BuiltInSongField = (typeof BUILT_IN_SONG_FIELDS)[number];

function isBuiltInSongField(key: string): key is BuiltInSongField {
  return (BUILT_IN_SONG_FIELDS as readonly string[]).includes(key);
}

/**
 * Resolves the channel a song row should use for all three sub-takes.
 * Cascade: SongRow.channelHint → ShowSong.channelOverride → Song.defaultChannel
 * → lyricTemplate.defaultChannel. Returns undefined if no level provides one.
 */
export function resolveSongChannel(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  lyricTemplate: Template | undefined,
): string | undefined {
  return (
    row.channelHint ??
    showSong?.channelOverride ??
    song.defaultChannel ??
    lyricTemplate?.defaultChannel
  );
}

/**
 * Resolves the effective section arrangement (ordered section ids) for a song
 * row. Cascade: SongRow.arrangement → ShowSong.arrangement →
 * Song.defaultArrangement. Returned verbatim — may contain repeats; stale ids
 * are tolerated by the runtime song session and filtered by the editor.
 */
export function resolveArrangement(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
): string[] {
  return row.arrangement ?? showSong?.arrangement ?? song.defaultArrangement;
}

/**
 * Looks up the value of a song "field" by key.
 *
 * Built-in keys ("title", "ccliNumber", "author", "copyright") read straight
 * from the Song — those aren't override-able per show or per row in the
 * current schema. Everything else falls through to customFields, where the
 * cascade is Row → ShowSong → Song. The row layer has no customField override
 * map today, but the cascade is wired in so a future addition slots in.
 */
export function resolveCustomFieldValue(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future row-level overrides
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
): string | undefined {
  if (isBuiltInSongField(key)) {
    return song[key];
  }
  // Row-level customField overrides don't exist yet — placeholder for future expansion.
  const showVal = showSong?.customFieldOverrides?.[key];
  if (showVal !== undefined) return showVal;
  return song.customFields[key];
}

export interface ResolvedTake {
  templateId: string;
  fieldValues: Record<string, string>;
}

/**
 * Substitutes `{key}` tokens in `template` with values resolved through
 * {@link resolveCustomFieldValue}. Supports built-in song fields ("title",
 * "ccliNumber", "author", "copyright") and any custom field key, with the
 * usual Row → ShowSong → Song cascade for custom values.
 *
 * - `{{` and `}}` escape to literal `{` and `}` respectively.
 * - An unknown `{key}` resolves to an empty string. Brace expressions that
 *   never get a closing `}` are emitted verbatim.
 *
 * Intended for use by the intro/outro literal-value resolver — see
 * {@link resolveIntroTake} / {@link resolveOutroTake}.
 */
export function interpolateSongString(
  template: string,
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "{") {
      if (template[i + 1] === "{") {
        out += "{";
        i += 2;
        continue;
      }
      const end = template.indexOf("}", i + 1);
      if (end < 0) {
        // Unterminated `{` — emit the rest verbatim. Treating this as an error
        // would break ergonomics for templates that happen to mention braces.
        out += template.slice(i);
        break;
      }
      const key = template.slice(i + 1, end);
      const value = resolveCustomFieldValue(key, row, showSong, song);
      out += value ?? "";
      i = end + 1;
    } else if (ch === "}" && template[i + 1] === "}") {
      out += "}";
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Shared core of resolveIntroTake / resolveOutroTake — differs only in which
 * row/show/song properties feed the cascade. Pulled into a helper so the two
 * public entry points stay one-liners and there's a single place to fix.
 */
function resolveSubTake(args: {
  skip: boolean | undefined;
  rowTemplateId: string | undefined;
  showTemplateId: string | undefined;
  songTemplateId: string | undefined;
  rowFieldMap: Record<string, string> | undefined;
  showFieldMap: Record<string, string> | undefined;
  songFieldMap: Record<string, string> | undefined;
  rowFieldLiterals: Record<string, string> | undefined;
  showFieldLiterals: Record<string, string> | undefined;
  songFieldLiterals: Record<string, string> | undefined;
  templates: Template[];
  row: SongRow;
  showSong: ShowSong | undefined;
  song: Song;
}): ResolvedTake | null {
  const {
    skip,
    rowTemplateId,
    showTemplateId,
    songTemplateId,
    rowFieldMap,
    showFieldMap,
    songFieldMap,
    rowFieldLiterals,
    showFieldLiterals,
    songFieldLiterals,
    templates,
    row,
    showSong,
    song,
  } = args;
  if (skip) return null;
  const templateId = rowTemplateId ?? showTemplateId ?? songTemplateId;
  if (!templateId) return null;
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;

  // Template id, field map, and field literals all cascade independently as
  // whole-object replacements. A row that overrides only the template id can
  // still inherit lower-level maps/literals even though their keys may not
  // match the new template — callers (the editor UI) should re-confirm both
  // when changing the template. Within a single resolution, literals win
  // over map entries when both target the same template field key.
  const fieldMap: Record<string, string> =
    rowFieldMap ?? showFieldMap ?? songFieldMap ?? {};
  const fieldLiterals: Record<string, string> =
    rowFieldLiterals ?? showFieldLiterals ?? songFieldLiterals ?? {};

  const fieldValues: Record<string, string> = {};
  for (const field of template.fields) {
    const literal = fieldLiterals[field.key];
    if (literal !== undefined) {
      fieldValues[field.key] = interpolateSongString(literal, row, showSong, song);
      continue;
    }
    const songFieldKey = fieldMap[field.key];
    if (songFieldKey !== undefined) {
      const value = resolveCustomFieldValue(songFieldKey, row, showSong, song);
      fieldValues[field.key] = value ?? "";
    } else {
      fieldValues[field.key] = field.default ?? "";
    }
  }
  return { templateId, fieldValues };
}

/**
 * Resolves the intro sub-take. Returns null if intro is opted-out via
 * `row.skipIntro`, if no template is configured at any level, or if the
 * resolved template id doesn't exist in `templates` (graceful degradation for
 * stale references).
 */
export function resolveIntroTake(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  templates: Template[],
): ResolvedTake | null {
  return resolveSubTake({
    skip: row.skipIntro,
    rowTemplateId: row.introTemplateId,
    showTemplateId: showSong?.introTemplateId,
    songTemplateId: song.defaultIntroTemplateId,
    rowFieldMap: row.introFieldMap,
    showFieldMap: showSong?.introFieldMap,
    songFieldMap: song.defaultIntroFieldMap,
    rowFieldLiterals: row.introFieldLiterals,
    showFieldLiterals: showSong?.introFieldLiterals,
    songFieldLiterals: song.defaultIntroFieldLiterals,
    templates,
    row,
    showSong,
    song,
  });
}

/** Same as {@link resolveIntroTake} for the outro sub-take. Honors row.skipOutro. */
export function resolveOutroTake(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  templates: Template[],
): ResolvedTake | null {
  return resolveSubTake({
    skip: row.skipOutro,
    rowTemplateId: row.outroTemplateId,
    showTemplateId: showSong?.outroTemplateId,
    songTemplateId: song.defaultOutroTemplateId,
    rowFieldMap: row.outroFieldMap,
    showFieldMap: showSong?.outroFieldMap,
    songFieldMap: song.defaultOutroFieldMap,
    rowFieldLiterals: row.outroFieldLiterals,
    showFieldLiterals: showSong?.outroFieldLiterals,
    songFieldLiterals: song.defaultOutroFieldLiterals,
    templates,
    row,
    showSong,
    song,
  });
}

// --- Field-map suggestion helpers ----------------------------------------

export interface FieldDescriptor {
  key: string;
  label: string;
  type: "text" | "number";
}

export type TemplateFieldLike = { key: string; label: string; type: string };

export type SuggestedFieldMatch =
  | { kind: "exact"; songFieldKey: string }
  | { kind: "suggested"; songFieldKey: string }
  | { kind: "none" };

/**
 * Cheap, dependency-free similarity score for label-matching. Returns a number
 * in [0, 1]. Looks for shared lowercased prefix of ≥4 chars and substring
 * containment in either direction. Not a real fuzzy matcher — just enough to
 * surface "Song Title" ≈ "title" for the suggestion UI.
 */
function labelSimilarity(a: string, b: string): number {
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.8;
  // Shared lowercased prefix.
  let i = 0;
  const limit = Math.min(la.length, lb.length);
  while (i < limit && la[i] === lb[i]) i++;
  if (i >= 4) return 0.4 + (i / Math.max(la.length, lb.length)) * 0.3;
  return 0;
}

/**
 * Compute a suggested map from template fields to song fields. Exact-key
 * matches (case-insensitive) win; otherwise we greedily assign the highest-
 * scoring label-similarity match per template field. A song field cannot be
 * suggested for two template fields — first claim wins under descending score
 * order, with ties broken by template-field insertion order (stable sort).
 */
export function suggestFieldMap(
  templateFields: Array<TemplateFieldLike>,
  songFields: Array<FieldDescriptor>,
): Record<string, SuggestedFieldMatch> {
  const result: Record<string, SuggestedFieldMatch> = {};
  const claimed = new Set<string>();

  // Pass 1: exact key matches (case-insensitive).
  const songByLowerKey = new Map<string, FieldDescriptor>();
  for (const sf of songFields) songByLowerKey.set(sf.key.toLowerCase(), sf);
  const unmatched: TemplateFieldLike[] = [];
  for (const tf of templateFields) {
    const match = songByLowerKey.get(tf.key.toLowerCase());
    if (match && !claimed.has(match.key)) {
      result[tf.key] = { kind: "exact", songFieldKey: match.key };
      claimed.add(match.key);
    } else {
      unmatched.push(tf);
    }
  }

  // Pass 2: score remaining template fields against remaining song fields,
  // sort by score desc, greedily assign.
  const candidates: Array<{ tfKey: string; sfKey: string; score: number }> = [];
  for (const tf of unmatched) {
    for (const sf of songFields) {
      if (claimed.has(sf.key)) continue;
      const score = labelSimilarity(tf.label, sf.label);
      if (score <= 0) continue;
      candidates.push({ tfKey: tf.key, sfKey: sf.key, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const tfAssigned = new Set<string>();
  for (const c of candidates) {
    if (tfAssigned.has(c.tfKey) || claimed.has(c.sfKey)) continue;
    result[c.tfKey] = { kind: "suggested", songFieldKey: c.sfKey };
    tfAssigned.add(c.tfKey);
    claimed.add(c.sfKey);
  }
  // Pass 3: anything still missing → none.
  for (const tf of templateFields) {
    if (!result[tf.key]) result[tf.key] = { kind: "none" };
  }
  return result;
}

const BUILT_IN_DESCRIPTORS: FieldDescriptor[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "ccliNumber", label: "CCLI Number", type: "text" },
  { key: "author", label: "Author", type: "text" },
  { key: "copyright", label: "Copyright", type: "text" },
];

/**
 * Returns descriptors for every selectable song field: the built-ins first
 * (in a fixed order), then one descriptor per key in `song.customFields`
 * (sorted by key for deterministic ordering). When the project supplies a
 * `songCustomFieldSchema`, use its label/type; otherwise fall back to the
 * key as label with text type.
 */
export function listSongFieldDescriptors(
  song: Song,
  projectCustomFieldSchema?: Array<{ key: string; label: string; type?: "text" | "number" }>,
): FieldDescriptor[] {
  const schemaByKey = new Map<string, { label: string; type?: "text" | "number" }>();
  for (const entry of projectCustomFieldSchema ?? []) {
    schemaByKey.set(entry.key, { label: entry.label, type: entry.type });
  }
  const customKeys = Object.keys(song.customFields).sort();
  const customDescriptors: FieldDescriptor[] = customKeys.map((key) => {
    const schema = schemaByKey.get(key);
    return {
      key,
      label: schema?.label ?? key,
      type: schema?.type ?? "text",
    };
  });
  return [...BUILT_IN_DESCRIPTORS, ...customDescriptors];
}
