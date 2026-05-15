// Pure resolution helpers for the song sub-takes feature. These functions
// translate the layered override model (SongRow → ShowSong → Song → fallback)
// into concrete take payloads for the operator UI and any future server-side
// dispatch path. No I/O, no dependency on app or server code.

import type { ShowSong, SongRow } from "./show";
import type { Song } from "./song";
import type { Template, Field } from "./template";

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

interface ResolvedTake {
  templateId: string;
  fieldValues: Record<string, string>;
}

/**
 * Shared core of resolveIntroTake / resolveOutroTake — differs only in which
 * row/show/song properties feed the cascade. Pulled into a helper so the two
 * public entry points stay one-liners and there's a single place to fix.
 */
function resolveSubTake(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  templates: Template[],
  rowTemplateId: string | undefined,
  showTemplateId: string | undefined,
  songTemplateId: string | undefined,
  rowFieldMap: Record<string, string> | undefined,
  showFieldMap: Record<string, string> | undefined,
  songFieldMap: Record<string, string> | undefined,
): ResolvedTake | null {
  const templateId = rowTemplateId ?? showTemplateId ?? songTemplateId;
  if (!templateId) return null;
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;

  const fieldMap: Record<string, string> =
    rowFieldMap ?? showFieldMap ?? songFieldMap ?? {};

  const fieldValues: Record<string, string> = {};
  for (const field of template.fields) {
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
  if (row.skipIntro) return null;
  return resolveSubTake(
    row,
    showSong,
    song,
    templates,
    row.introTemplateId,
    showSong?.introTemplateId,
    song.defaultIntroTemplateId,
    row.introFieldMap,
    showSong?.introFieldMap,
    song.defaultIntroFieldMap,
  );
}

/** Same as {@link resolveIntroTake} for the outro sub-take. Honors row.skipOutro. */
export function resolveOutroTake(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
  templates: Template[],
): ResolvedTake | null {
  if (row.skipOutro) return null;
  return resolveSubTake(
    row,
    showSong,
    song,
    templates,
    row.outroTemplateId,
    showSong?.outroTemplateId,
    song.defaultOutroTemplateId,
    row.outroFieldMap,
    showSong?.outroFieldMap,
    song.defaultOutroFieldMap,
  );
}

// --- Field-map suggestion helpers ----------------------------------------

interface FieldDescriptor {
  key: string;
  label: string;
  type: "text" | "number";
}

type TemplateFieldLike = { key: string; label: string; type: string };

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

function typesCompatible(templateType: string, songType: "text" | "number"): boolean {
  if (templateType === "number") return songType === "number";
  // text / image / color / video / time all accept text-ish input from a song field
  return true;
}

/**
 * Compute a suggested map from template fields to song fields. Exact-key
 * matches (case-insensitive) win; otherwise we greedily assign the highest-
 * scoring label-similarity match per template field, with the tie-break on
 * type compatibility. A song field cannot be suggested for two template
 * fields — first claim wins under descending score order.
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
      const compatBonus = typesCompatible(tf.type, sf.type) ? 0.05 : 0;
      candidates.push({ tfKey: tf.key, sfKey: sf.key, score: score + compatBonus });
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

// Re-export the field type for callers wanting a typed handle on the descriptor shape.
export type { Field };
