import type { DeckLicensing, Song } from "@overlaysys/core";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Toast text after a successful convert. */
export function convertResultMessage(m: { deckName: string; rows: number; shows: number }): string {
  const head = `Converted to deck "${m.deckName}"`;
  if (m.rows === 0) return head;
  return `${head} · switched ${count(m.rows, "row")} in ${count(m.shows, "show")}`;
}

/** One warn-toast line for the server's warnings, or null when there are none. */
export function convertWarningsMessage(warnings: readonly string[]): string | null {
  return warnings.length === 0 ? null : warnings.join(" · ");
}

/** Licensing prefilled in the dialog: CCLI when the song carries a number, else public domain. Matches deckFromSong. */
export function derivedLicensing(song: Pick<Song, "ccliNumber">): DeckLicensing {
  return song.ccliNumber ? { kind: "ccli", ccliNumber: song.ccliNumber } : { kind: "public-domain" };
}

/** Why the title-slide checkbox is unavailable, or null when the song has an intro design. */
export function titleSlideBlocker(song: Pick<Song, "defaultIntroTemplateId">): string | null {
  return song.defaultIntroTemplateId ? null : "This song has no intro design";
}
