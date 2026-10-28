import { z } from "zod";
import { DEFAULT_PROJECT_ID } from "./project";
import { DEFAULT_MEDIA_TRANSITION, MediaEndActionSchema, MediaTransitionSchema } from "./channel";
import { SermonNotesSchema } from "./sermonNotes";

/**
 * Provenance for a row imported from an external source (currently Planning
 * Center Services). Carried on the row so a re-import of the same plan can
 * match and update the row in place instead of appending a duplicate. Optional
 * everywhere — rows created by hand simply omit it.
 */
export const RowSourceRefSchema = z.object({
  provider: z.literal("pco"),
  serviceTypeId: z.string(),
  planId: z.string(),
  itemId: z.string(),
  /** Arrangement a PCO import last set on a song row, so re-import can tell an operator edit from its own. */
  pcoArrangement: z.array(z.string()).optional(),
});
export type RowSourceRef = z.infer<typeof RowSourceRefSchema>;

const GraphicRowObject = z.object({
  kind: z.literal("graphic"),
  id: z.string(),
  /** Id of the show section this row belongs to; absent means no section. */
  sectionId: z.string().optional(),
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  /** Sermon notes set this row selects on the confidence monitor when taken. */
  sermonNotesId: z.string().optional(),
  /** Planned length in seconds (from PCO or set by the operator); drives the stage item countdown. */
  lengthSec: z.number().int().nonnegative().optional(),
  /** Operator-set length: PCO re-import leaves `lengthSec` alone. */
  lengthSecManual: z.boolean().optional(),
  sourceRef: RowSourceRefSchema.optional(),
});
export type GraphicRow = z.infer<typeof GraphicRowObject>;
export const GraphicRowSchema = GraphicRowObject.passthrough();

const SongRowObject = z.object({
  kind: z.literal("song"),
  id: z.string(),
  /** Id of the show section this row belongs to; absent means no section. */
  sectionId: z.string().optional(),
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()).optional(),
  trustMode: z.boolean().optional(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  /** Sermon notes set this row selects on the confidence monitor when taken. */
  sermonNotesId: z.string().optional(),
  /** Planned length in seconds (from PCO or set by the operator); drives the stage item countdown. */
  lengthSec: z.number().int().nonnegative().optional(),
  /** Operator-set length: PCO re-import leaves `lengthSec` alone. */
  lengthSecManual: z.boolean().optional(),
  /** Per-row override of the intro template; falls back to ShowSong / Song default. */
  introTemplateId: z.string().optional(),
  /** Per-row override of the intro field map (templateFieldKey -> songFieldKey). */
  introFieldMap: z.record(z.string(), z.string()).optional(),
  /**
   * Per-row override of the intro field literals (templateFieldKey -> template
   * string). See {@link Song.defaultIntroFieldLiterals} for syntax; literal
   * cascade is row → ShowSong → Song.
   */
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
  /** Per-row override of the outro template; falls back to ShowSong / Song default. */
  outroTemplateId: z.string().optional(),
  /** Per-row override of the outro field map (templateFieldKey -> songFieldKey). */
  outroFieldMap: z.record(z.string(), z.string()).optional(),
  /** Per-row override of the outro field literals. See introFieldLiterals. */
  outroFieldLiterals: z.record(z.string(), z.string()).optional(),
  /** When true, the operator has explicitly opted out of an intro sub-take for this row. */
  skipIntro: z.boolean().optional(),
  /** When true, the operator has explicitly opted out of an outro sub-take for this row. */
  skipOutro: z.boolean().optional(),
  sourceRef: RowSourceRefSchema.optional(),
});
export type SongRow = z.infer<typeof SongRowObject>;
export const SongRowSchema = SongRowObject.passthrough();

/**
 * Per-show override layer for a Song. One entry per song that appears in the
 * show, keyed by `songId`. Lets the operator pin intro/outro templates, field
 * mappings, lyric template, channel, and customField values at the show level
 * without mutating the canonical Song in the library. Row-level overrides on
 * {@link SongRow} take precedence over these.
 */
const ShowSongObject = z.object({
  songId: z.string(),
  channelOverride: z.string().optional(),
  introTemplateId: z.string().optional(),
  introFieldMap: z.record(z.string(), z.string()).optional(),
  /**
   * Per-show override of intro field literals (templateFieldKey -> template
   * string). See {@link Song.defaultIntroFieldLiterals} for syntax.
   */
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
  outroTemplateId: z.string().optional(),
  outroFieldMap: z.record(z.string(), z.string()).optional(),
  /** Per-show override of outro field literals. See introFieldLiterals. */
  outroFieldLiterals: z.record(z.string(), z.string()).optional(),
  lyricTemplateId: z.string().optional(),
  customFieldOverrides: z.record(z.string(), z.string()).optional(),
  /** Per-show override of the section play order (ordered section ids; may
   *  repeat). Falls back to Song.defaultArrangement. SongRow.arrangement takes
   *  precedence over this. */
  arrangement: z.array(z.string()).optional(),
});
export type ShowSong = z.infer<typeof ShowSongObject>;
export const ShowSongSchema = ShowSongObject.passthrough();

export const ScriptureSlideSchema = z.object({
  id: z.string(),
  /**
   * Verses on this slide, in display order. Stored as structured data
   * (not pre-joined strings) so the renderer can format verse numbers and
   * per-verse styling without re-fetching the passage.
   */
  verses: z
    .array(
      z.object({
        book: z.string(),
        chapter: z.number().int().positive(),
        verse: z.number().int().positive(),
        text: z.string(),
      }),
    )
    .min(1),
});
export type ScriptureSlide = z.infer<typeof ScriptureSlideSchema>;

const ScriptureRowObject = z.object({
  kind: z.literal("scripture"),
  id: z.string(),
  /** Id of the show section this row belongs to; absent means no section. */
  sectionId: z.string().optional(),
  /** Normalized reference string, e.g. "John 3:16-18". */
  reference: z.string(),
  /** TranslationMeta.id from @overlaysys/scripture. */
  translation: z.string(),
  /**
   * TranslationMeta.abbreviation cached at save time (e.g. "KJV", "ESV").
   * Used by ScriptureTakeStrip so templates receive the human-readable
   * abbreviation rather than the provider-internal id. Optional for
   * backwards compatibility with rows saved before this field was added;
   * the strip falls back to `translation` when absent.
   */
  translationAbbreviation: z.string().optional(),
  /** Attribution captured at fetch time so the on-air state is reproducible. */
  attribution: z.string().optional(),
  /** Embedded slides — auto-split on import, operator-editable. */
  slides: z.array(ScriptureSlideSchema).min(1),
  templateId: z.string(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  /** Sermon notes set this row selects on the confidence monitor when taken. */
  sermonNotesId: z.string().optional(),
  /** Planned length in seconds (from PCO or set by the operator); drives the stage item countdown. */
  lengthSec: z.number().int().nonnegative().optional(),
  /** Operator-set length: PCO re-import leaves `lengthSec` alone. */
  lengthSecManual: z.boolean().optional(),
  sourceRef: RowSourceRefSchema.optional(),
  /**
   * Set for rows fetched from a licensed API (NIV via API.Bible). The server
   * refreshes such rows' text every 14 days and reports usage with the tokens.
   */
  source: z
    .object({
      provider: z.literal("api.bible"),
      bibleId: z.string(),
      fetchedAt: z.string(),
      usageTokens: z.array(z.string()).default([]),
    })
    .optional(),
  /** Intro template override; falls back to ScriptureSettings.introTemplateId. */
  introTemplateId: z.string().optional(),
  /** templateFieldKey -> scripture field key (reference, book, translation, translationName, attribution). */
  introFieldMap: z.record(z.string(), z.string()).optional(),
  /** templateFieldKey -> literal with {key} tokens; wins over introFieldMap. */
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
  /** Operator opted this row out of an intro. */
  skipIntro: z.boolean().optional(),
});
export type ScriptureRow = z.infer<typeof ScriptureRowObject>;
export const ScriptureRowSchema = ScriptureRowObject.passthrough();

/**
 * Full-frame video played in the channel's media slot (beneath graphics).
 * `durationSec` is display-only, captured when the row is saved.
 */
const VideoRowObject = z.object({
  kind: z.literal("video"),
  id: z.string(),
  /** Id of the show section this row belongs to; absent means no section. */
  sectionId: z.string().optional(),
  assetUrl: z.string(),
  label: z.string().optional(),
  durationSec: z.number().optional(),
  volume: z.number().min(0).max(1).default(1),
  endAction: MediaEndActionSchema.default("clear"),
  transitionIn: MediaTransitionSchema.default(DEFAULT_MEDIA_TRANSITION),
  transitionOut: MediaTransitionSchema.default(DEFAULT_MEDIA_TRANSITION),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  /** Sermon notes set this row selects on the confidence monitor when taken. */
  sermonNotesId: z.string().optional(),
  /** Planned length in seconds (from PCO or set by the operator); drives the stage item countdown. */
  lengthSec: z.number().int().nonnegative().optional(),
  /** Operator-set length: PCO re-import leaves `lengthSec` alone. */
  lengthSecManual: z.boolean().optional(),
  sourceRef: RowSourceRefSchema.optional(),
});
export type VideoRow = z.infer<typeof VideoRowObject>;
export const VideoRowSchema = VideoRowObject.passthrough();

const ShowSectionObject = z.object({ id: z.string().min(1), name: z.string() });
export type ShowSection = z.infer<typeof ShowSectionObject>;
export const ShowSectionSchema = ShowSectionObject.passthrough();

/**
 * Show JSON files predating the row union have rows without a `kind` field.
 * Default missing `kind` to `"graphic"` on read; writes always include `kind`.
 */
export const RundownRowSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("kind" in (raw as Record<string, unknown>))
    ) {
      return { kind: "graphic", ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.discriminatedUnion("kind", [GraphicRowSchema, SongRowSchema, ScriptureRowSchema, VideoRowSchema]),
);
export type RundownRow = GraphicRow | SongRow | ScriptureRow | VideoRow;

/**
 * Shows pre-dating the Project concept have no `projectId`. Default missing
 * values to the seeded default project on read.
 *
 * Shows pre-dating song sub-takes have no `songs` array. Default missing
 * `songs` to `[]` on read; writes always include the field. Mirrors the
 * row-kind backfill pattern above.
 */
const ShowObject = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  // Runtime schemas pass unknown keys through; the casts keep the inferred types free of index signatures.
  rows: z.array(RundownRowSchema as unknown as z.ZodType<RundownRow, z.ZodTypeDef, unknown>),
  songs: z.array(ShowSongSchema as unknown as z.ZodType<ShowSong, z.ZodTypeDef, unknown>),
  /**
   * ISO timestamp of the last write. Set by writers on every save; consumed
   * by the sync engine for last-writer-wins. Optional for backwards
   * compatibility with pre-sync JSON; new writes always set it.
   *
   * Note: a Show is synced as one document, so a single `updatedAt` bump
   * covers every row + ShowSong override inside. The SyncEngine logs when
   * it overwrites a show with newer-but-superset content so a future
   * field-level merge has a paper trail (see plan §Workstream 1).
   */
  updatedAt: z.string().optional(),
  /**
   * Optional service date, date-only ISO `YYYY-MM-DD`. Drives "next show"
   * selection on control surfaces. Optional/backfill-free: shows saved before
   * this field simply have no value and fall back to name-parsed dates.
   */
  scheduledFor: z.string().optional(),
  /** Sermon notes for this show; rows link to one via `sermonNotesId`. */
  sermonNotes: z.array(SermonNotesSchema).optional(),
  /** Soft-delete tombstone; see hotcard.ts for the rationale. */
  deletedAt: z.string().optional(),
  /** Named groups of rows; rows reference one via `sectionId`. */
  sections: z.array(ShowSectionSchema as unknown as z.ZodType<ShowSection, z.ZodTypeDef, unknown>).optional(),
});

export const ShowSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw)
    ) {
      const obj = raw as Record<string, unknown>;
      const needsProjectId = !("projectId" in obj);
      const needsSongs = !("songs" in obj);
      if (!needsProjectId && !needsSongs) return raw;
      // `...obj` must come last so any explicit values in raw input override the defaults above.
      return {
        ...(needsProjectId ? { projectId: DEFAULT_PROJECT_ID } : {}),
        ...(needsSongs ? { songs: [] } : {}),
        ...obj,
      };
    }
    return raw;
  },
  ShowObject.passthrough(),
);
export type Show = z.infer<typeof ShowObject>;
