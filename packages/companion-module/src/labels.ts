import type { RundownRow, Song } from "@overlaysys/core";
import type { CompanionState } from "./types";

export function rowDisplayLabel(
  state: CompanionState,
  row: RundownRow,
): string {
  if (row.kind === "song") {
    const meta = state.songs.find((s) => s.id === row.songId);
    return meta?.title ?? row.songId;
  }
  if (row.kind === "scripture") return row.reference;
  if (row.kind === "video") return row.label || "Video";
  if (row.kind === "media") return row.label || "Photo";
  if (row.kind === "slides") {
    const deck = row.deckId ? state.decks.find((d) => d.id === row.deckId) : undefined;
    return deck?.name || row.notes?.trim() || "Slides";
  }
  if (row.notes && row.notes.trim().length > 0) return row.notes;
  const tpl = state.templates.find((t) => t.id === row.templateId);
  return tpl?.name ?? row.templateId;
}

/** Button text: a graphic's `title` field when it has one, else the row's display label. */
export function rowButtonLabel(state: CompanionState, row: RundownRow): string {
  if (row.kind === "graphic") {
    const title = row.data.title?.trim();
    if (title) return title;
  }
  return rowDisplayLabel(state, row);
}

export function sectionDisplayLabel(
  song: Song,
  arrangement: string[],
  sectionIdx: number,
): string {
  const sectionId = arrangement[sectionIdx];
  if (!sectionId) return "";
  const section = song.sections.find((s) => s.id === sectionId);
  return section?.label ?? "";
}

export function songTitleForChannel(
  state: CompanionState,
  channel: string,
): string {
  const ch = state.channelStates.get(channel);
  if (!ch?.songSession) return "";
  const meta = state.songs.find((s) => s.id === ch.songSession!.songId);
  return meta?.title ?? "";
}

export const DEFAULT_CHANNEL_CHOICE = {
  id: "",
  label: "Default (row / song channel)",
};

/** Dropdown choices for the rows of the loaded show, labelled readably. */
export function rowChoices(
  state: CompanionState,
): { id: string; label: string }[] {
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  if (!show) return [];
  return show.rows.map((r, i) => ({
    id: r.id,
    label: `${i + 1}. ${rowDisplayLabel(state, r)}`,
  }));
}
