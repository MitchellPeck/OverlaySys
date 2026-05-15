import { z } from "zod";
import { DEFAULT_PROJECT_ID } from "./project";

export const GraphicRowSchema = z.object({
  kind: z.literal("graphic"),
  id: z.string(),
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type GraphicRow = z.infer<typeof GraphicRowSchema>;

export const SongRowSchema = z.object({
  kind: z.literal("song"),
  id: z.string(),
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()).optional(),
  trustMode: z.boolean().optional(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  /** Per-row override of the intro template; falls back to ShowSong / Song default. */
  introTemplateId: z.string().optional(),
  /** Per-row override of the intro field map (templateFieldKey -> songFieldKey). */
  introFieldMap: z.record(z.string(), z.string()).optional(),
  /** Per-row override of the outro template; falls back to ShowSong / Song default. */
  outroTemplateId: z.string().optional(),
  /** Per-row override of the outro field map (templateFieldKey -> songFieldKey). */
  outroFieldMap: z.record(z.string(), z.string()).optional(),
  /** When true, the operator has explicitly opted out of an intro sub-take for this row. */
  skipIntro: z.boolean().optional(),
  /** When true, the operator has explicitly opted out of an outro sub-take for this row. */
  skipOutro: z.boolean().optional(),
});
export type SongRow = z.infer<typeof SongRowSchema>;

/**
 * Per-show override layer for a Song. One entry per song that appears in the
 * show, keyed by `songId`. Lets the operator pin intro/outro templates, field
 * mappings, lyric template, channel, and customField values at the show level
 * without mutating the canonical Song in the library. Row-level overrides on
 * {@link SongRow} take precedence over these.
 */
export const ShowSongSchema = z.object({
  songId: z.string(),
  channelOverride: z.string().optional(),
  introTemplateId: z.string().optional(),
  introFieldMap: z.record(z.string(), z.string()).optional(),
  outroTemplateId: z.string().optional(),
  outroFieldMap: z.record(z.string(), z.string()).optional(),
  lyricTemplateId: z.string().optional(),
  customFieldOverrides: z.record(z.string(), z.string()).optional(),
});
export type ShowSong = z.infer<typeof ShowSongSchema>;

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
  z.discriminatedUnion("kind", [GraphicRowSchema, SongRowSchema]),
);
export type RundownRow = z.infer<typeof RundownRowSchema>;

/**
 * Shows pre-dating the Project concept have no `projectId`. Default missing
 * values to the seeded default project on read.
 *
 * Shows pre-dating song sub-takes have no `songs` array. Default missing
 * `songs` to `[]` on read; writes always include the field. Mirrors the
 * row-kind backfill pattern above.
 */
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
  z.object({
    id: z.string(),
    name: z.string(),
    projectId: z.string(),
    rows: z.array(RundownRowSchema),
    songs: z.array(ShowSongSchema),
  }),
);
export type Show = z.infer<typeof ShowSchema>;
