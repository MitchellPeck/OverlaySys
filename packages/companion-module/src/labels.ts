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
  if (row.notes && row.notes.trim().length > 0) return row.notes;
  const tpl = state.templates.find((t) => t.id === row.templateId);
  return tpl?.name ?? row.templateId;
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
