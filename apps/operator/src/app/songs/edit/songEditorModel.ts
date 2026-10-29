import { slugifyTitle, type ChannelConfig, type Song } from "@overlaysys/core";
import { linesFromText } from "./songDraftOps";

// Pure helpers behind the song editor's frame layout (page, SongDetails, main pane).

/** Muted line under the title: "Song" or "Song · CCLI n". */
export function songSubtitle(song: Pick<Song, "ccliNumber">): string {
  const ccli = song.ccliNumber?.trim();
  return ccli ? `Song · CCLI ${ccli}` : "Song";
}

/** Default-output choices: program-type channels, and stage displays in their own group. Mirrors and Preview are never a target. */
export function outputChannelGroups<C extends Pick<ChannelConfig, "id" | "name" | "mirrorOf"> & { kind?: ChannelConfig["kind"] }>(
  channels: C[],
): { program: C[]; stage: C[] } {
  const usable = channels.filter((c) => !c.mirrorOf && c.id !== "preview");
  return {
    program: usable.filter((c) => c.kind !== "stage"),
    stage: usable.filter((c) => c.kind === "stage"),
  };
}

/** Key for a new custom field, derived from its label. */
export function customFieldKey(label: string, takenKeys: string[]): { key: string } | { error: string } {
  if (!label.trim()) return { error: "Enter a label" };
  // snake_case, to match existing schema keys such as `hymn_number`.
  const key = slugifyTitle(label).replace(/-/g, "_");
  const norm = (k: string) => k.toLowerCase().replace(/-/g, "_");
  if (takenKeys.some((k) => norm(k) === key)) {
    return { error: "A field with this name already exists" };
  }
  return { key };
}

/**
 * What the slide textarea shows. `linesFromText` drops trailing blank lines, so
 * echoing the stored lines back would eat a just-typed Enter: keep the local
 * text while it still maps to the stored lines, otherwise (undo, revert, a
 * paste) show the stored lines.
 */
export function slideEditorText(local: string | null, lines: string[]): string {
  if (local !== null) {
    const mapped = linesFromText(local);
    if (mapped.length === lines.length && mapped.every((l, i) => l === lines[i])) return local;
  }
  return lines.join("\n");
}

function move<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function moveSongSection(song: Song, from: number, to: number): Song {
  return { ...song, sections: move(song.sections, from, to) };
}

export function moveSlideWithin(song: Song, sectionId: string, from: number, to: number): Song {
  return {
    ...song,
    sections: song.sections.map((s) => (s.id === sectionId ? { ...s, slides: move(s.slides, from, to) } : s)),
  };
}

/** The server's reply to get_song for an id it doesn't have. */
export function isSongNotFound(msg: { type: string; code?: string; message?: string }, id: string): boolean {
  return msg.type === "error" && msg.code === "not_found" && msg.message === id;
}
