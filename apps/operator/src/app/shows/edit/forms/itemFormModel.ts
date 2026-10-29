import type { ScriptureRow, Show, ShowSong, Song, SongRow, TemplateMeta, VideoRow } from "@overlaysys/core";
import { lengthEcho, parseRowLength } from "../../../../lib/rowLength";
import { templatesFor, type TemplateUse } from "../../../../lib/templateRoles";

/** Pure helpers behind the show editor's item forms (P2a.18). */

const KIND_LABEL: Record<string, string> = {
  graphic: "Graphic",
  song: "Song",
  scripture: "Scripture",
  video: "Video",
  slides: "Slides",
};

/** Form header: "<Kind> · <name>" ("Item" for unknown kinds). */
export function itemHeading(kind: string, name: string): string {
  const k = KIND_LABEL[kind];
  if (!k) return "Item";
  return name ? `${k} · ${name}` : k;
}

/** A copy of `row` with `patch` applied; an `undefined` value removes the key. Unknown keys survive. */
export function patchRow<R extends object>(row: R, patch: Record<string, unknown>): R {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as R;
}

/** Cue note textarea height: one row per line, 1–4. */
export function cueNoteRows(text: string): number {
  const lines = text.split("\n").length;
  return Math.min(4, Math.max(1, lines));
}

/** Hint under the Length field: the live echo, or "Use M:SS" when the text doesn't parse. */
export function lengthFieldHint(text: string): { invalid: boolean; hint: string | null } {
  if (!parseRowLength(text).ok) return { invalid: true, hint: "Use M:SS" };
  return { invalid: false, hint: lengthEcho(text) };
}

/** Output select options: "Program (auto)" for unset, a kept missing value, then the channels. */
export function outputOptions(
  channels: { id: string; name: string }[],
  value: string | undefined,
): { value: string; label: string }[] {
  const out = [{ value: "", label: "Program (auto)" }];
  if (value && !channels.some((c) => c.id === value)) out.push({ value, label: `${value} (missing)` });
  for (const c of channels) out.push({ value: c.id, label: c.name || c.id });
  return out;
}

/** Template ids this show uses for `use`, most recently placed (lowest in the list) first. */
export function recentTemplateIds(show: Show, use: TemplateUse): string[] {
  const out: string[] = [];
  for (let i = show.rows.length - 1; i >= 0; i--) {
    const r = show.rows[i] as { kind: string; templateId?: string; lyricTemplateId?: string };
    let id: string | undefined;
    if (use === "graphic" && r.kind === "graphic") id = r.templateId;
    else if (use === "lyric" && r.kind === "song") id = r.lyricTemplateId;
    else if (use === "scripture" && r.kind === "scripture") id = r.templateId;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Grouped options for a template select; `missing` when `value` names no known template. */
export function templateGroups<T extends Pick<TemplateMeta, "id" | "name" | "role">>(
  metas: T[],
  use: TemplateUse,
  value: string,
  recentIds: string[] = [],
): { suggested: T[]; others: T[]; missing: boolean } {
  const { suggested, others } = templatesFor(metas, use, recentIds);
  return { suggested, others, missing: !!value && !metas.some((m) => m.id === value) };
}

/** Template for a new graphic item: the show's last used one, else the first suggested graphic template. */
export function lastUsedGraphicTemplate<T extends Pick<TemplateMeta, "id" | "name" | "role">>(
  show: Show,
  metas: T[],
): T | undefined {
  for (const id of recentTemplateIds(show, "graphic")) {
    const m = metas.find((x) => x.id === id);
    if (m) return m;
  }
  return templatesFor(metas, "graphic").suggested[0] ?? metas[0];
}

// --- Song picker -----------------------------------------------------------

export function toggleSongPick(picked: string[], id: string): string[] {
  return picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
}

/** Shift-click: pick every id from `anchor` to `to` (inclusive, walking from the anchor); earlier picks stay first. */
export function pickRange(picked: string[], list: string[], anchor: number, to: number): string[] {
  const out = [...picked];
  const step = to >= anchor ? 1 : -1;
  for (let i = anchor; step > 0 ? i <= to : i >= to; i += step) {
    const id = list[i];
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

export function addSongsLabel(n: number): string {
  if (n <= 0) return "Add songs";
  return n === 1 ? "Add 1 song" : `Add ${n} songs`;
}

/** Song ids used in this show, the last one in the list first. */
export function recentSongIds(show: Show): string[] {
  const out: string[] = [];
  for (let i = show.rows.length - 1; i >= 0; i--) {
    const r = show.rows[i] as { kind: string; songId?: string };
    if (r.kind === "song" && r.songId && !out.includes(r.songId)) out.push(r.songId);
  }
  return out;
}

/** Lyric template for a song in this show: show default → song default → first lyric template. */
export function lyricTemplateFor(
  songId: string,
  show: Show,
  songCache: Record<string, Song>,
  metas: Pick<TemplateMeta, "id" | "name" | "role">[],
): string {
  return (
    show.songs.find((e) => e.songId === songId)?.lyricTemplateId ??
    songCache[songId]?.defaultLyricTemplateId ??
    templatesFor(metas, "lyric", recentTemplateIds(show, "lyric")).suggested[0]?.id ??
    metas[0]?.id ??
    ""
  );
}

/** One new song row per picked song, in the picked order. */
export function newSongRows(
  songIds: string[],
  show: Show,
  songCache: Record<string, Song>,
  metas: Pick<TemplateMeta, "id" | "name" | "role">[],
  newId: () => string,
): SongRow[] {
  return songIds.map((songId) => ({
    kind: "song" as const,
    id: newId(),
    songId,
    lyricTemplateId: lyricTemplateFor(songId, show, songCache, metas),
  }));
}

/** Register songs in the show-wide defaults (bare entries) so overrides have a home. */
export function withSongDefaults(show: Show, songIds: string[]): Show {
  let songs = show.songs;
  for (const songId of songIds) {
    if (!songs.some((e) => e.songId === songId)) songs = [...songs, { songId }];
  }
  return songs === show.songs ? show : { ...show, songs };
}

// --- Arrangement chips -----------------------------------------------------

export function arrangementMove(arr: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= arr.length) return arr;
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, x!);
  return next;
}

export function arrangementRemove(arr: string[], index: number): string[] {
  return arr.filter((_, i) => i !== index);
}

export function arrangementAppend(arr: string[], id: string): string[] {
  return [...arr, id];
}

// --- Intro / outro ---------------------------------------------------------

type IntroOutroRow = Pick<SongRow, "introTemplateId" | "outroTemplateId" | "skipIntro" | "skipOutro">;

/** Resolved value chip, e.g. "Intro: Song Intro (song)". */
export function songIntroOutroChip(
  which: "intro" | "outro",
  row: Partial<IntroOutroRow>,
  showSong: ShowSong | undefined,
  song: Pick<Song, "defaultIntroTemplateId" | "defaultOutroTemplateId"> | undefined,
  metas: Pick<TemplateMeta, "id" | "name">[],
): string {
  const label = which === "intro" ? "Intro" : "Outro";
  const skip = which === "intro" ? row.skipIntro : row.skipOutro;
  if (skip) return `${label}: skipped (item)`;
  const levels: [string | undefined, string][] = [
    [which === "intro" ? row.introTemplateId : row.outroTemplateId, "item"],
    [which === "intro" ? showSong?.introTemplateId : showSong?.outroTemplateId, "show"],
    [which === "intro" ? song?.defaultIntroTemplateId : song?.defaultOutroTemplateId, "song"],
  ];
  for (const [id, level] of levels) {
    if (id === undefined) continue;
    if (!id) return `${label}: none (${level})`;
    const name = metas.find((m) => m.id === id)?.name ?? "Missing template";
    return `${label}: ${name} (${level})`;
  }
  return `${label}: none`;
}

// --- Video -----------------------------------------------------------------

/** Fill Length from the probed duration when the item has none. */
export function withVideoLengthPrefill(row: VideoRow): VideoRow {
  if (row.lengthSec !== undefined || typeof row.durationSec !== "number" || !(row.durationSec > 0)) return row;
  return { ...row, lengthSec: Math.round(row.durationSec) };
}

// --- Scripture -------------------------------------------------------------

export type PassageArgs = {
  reference: string;
  translation: string;
  translationAbbreviation: string | undefined;
  attribution: string;
  /** Licensed-API provenance of the new passage; undefined drops the old row's. */
  source: ScriptureRow["source"] | undefined;
  slides: { id: string; verses: ScriptureRow["slides"][number]["verses"] }[];
  templateId: string;
  intro: { introTemplateId?: string; introFieldMap?: Record<string, string>; introFieldLiterals?: Record<string, string>; skipIntro?: boolean };
};

/** The row with a new passage; id, section, length, notes link and unknown keys are kept. */
export function applyPassage(row: ScriptureRow, a: PassageArgs): ScriptureRow {
  return patchRow(row, {
    reference: a.reference,
    translation: a.translation,
    translationAbbreviation: a.translationAbbreviation,
    attribution: a.attribution,
    source: a.source,
    slides: a.slides.map((s) => ({ id: s.id, verses: s.verses })),
    templateId: a.templateId,
    introTemplateId: a.intro.introTemplateId,
    introFieldMap: a.intro.introFieldMap,
    introFieldLiterals: a.intro.introFieldLiterals,
    skipIntro: a.intro.skipIntro || undefined,
  });
}
