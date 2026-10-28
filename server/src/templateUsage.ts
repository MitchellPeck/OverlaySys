import type { Hotcard, ScriptureSettings, Show, Song } from "@overlaysys/core";

/** Built-in templates that can't be deleted (the lyric fallback every song relies on). */
export const PROTECTED_TEMPLATE_IDS: readonly string[] = ["lyric-default"];

export type TemplateUsage = {
  shows: { id: string; name: string }[];
  hotcards: { id: string; name: string }[];
  songs: { id: string; title: string }[];
  scriptureDefault: boolean;
  protected: boolean;
};

export type TemplateUsageInput = {
  shows: readonly Pick<Show, "id" | "name" | "rows" | "songs" | "deletedAt">[];
  hotcards: readonly Pick<Hotcard, "id" | "name" | "templateId" | "deletedAt">[];
  songs: readonly Pick<
    Song,
    "id" | "title" | "defaultLyricTemplateId" | "defaultIntroTemplateId" | "defaultOutroTemplateId" | "deletedAt"
  >[];
  scripture: Pick<ScriptureSettings, "defaultTemplateId" | "introTemplateId">;
};

/** Where a template is referenced: show rows and overrides, hotcards, song defaults and scripture defaults. Tombstoned records are ignored. */
export function templateUsage(id: string, input: TemplateUsageInput): TemplateUsage {
  const shows = input.shows.filter((s) => !s.deletedAt && showUses(s, id)).map((s) => ({ id: s.id, name: s.name }));
  const hotcards = input.hotcards
    .filter((h) => !h.deletedAt && h.templateId === id)
    .map((h) => ({ id: h.id, name: h.name }));
  const songs = input.songs
    .filter(
      (s) =>
        !s.deletedAt &&
        (s.defaultLyricTemplateId === id || s.defaultIntroTemplateId === id || s.defaultOutroTemplateId === id),
    )
    .map((s) => ({ id: s.id, title: s.title }));
  return {
    shows,
    hotcards,
    songs,
    scriptureDefault: input.scripture.defaultTemplateId === id || input.scripture.introTemplateId === id,
    protected: PROTECTED_TEMPLATE_IDS.includes(id),
  };
}

function showUses(show: Pick<Show, "rows" | "songs">, id: string): boolean {
  for (const row of show.rows) {
    switch (row.kind) {
      case "graphic":
      case "slides":
        if (row.templateId === id) return true;
        break;
      case "song":
        if (row.lyricTemplateId === id || row.introTemplateId === id || row.outroTemplateId === id) return true;
        break;
      case "scripture":
        if (row.templateId === id || row.introTemplateId === id) return true;
        break;
      default:
        break;
    }
  }
  return (show.songs ?? []).some(
    (s) => s.lyricTemplateId === id || s.introTemplateId === id || s.outroTemplateId === id,
  );
}
