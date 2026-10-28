import { resolveSongChannel, type Show, type Song, type SongRow, type Template } from "@overlaysys/core";

type Caches = {
  songCache: Record<string, Song>;
  templateCache: Record<string, Template>;
};

/**
 * The channel a song row is routed to, by the same cascade the take buttons
 * and the server use (row → show song → song → lyric template). Keyboard,
 * double-click and buttons all go through this so they never disagree.
 * Before the song body is cached, the row and show-song levels still apply.
 */
export function songRowChannel(row: SongRow, show: Show | null, caches: Caches): string | undefined {
  const showSong = show?.songs.find((s) => s.songId === row.songId);
  const song = caches.songCache[row.songId];
  if (song) return resolveSongChannel(row, showSong, song, caches.templateCache[row.lyricTemplateId]);
  return row.channelHint ?? showSong?.channelOverride;
}

/** Channel a song take goes to: the routed channel, else program. */
export function songTakeChannel(row: SongRow, show: Show | null, caches: Caches): string {
  return songRowChannel(row, show, caches) ?? "program";
}

/**
 * Channel a song cue goes to. A song routed to program cues on preview (a cue
 * must never go live); one routed to another output cues there, as before.
 */
export function songCueChannel(row: SongRow, show: Show | null, caches: Caches): string {
  const ch = songRowChannel(row, show, caches);
  return ch && ch !== "program" ? ch : "preview";
}
