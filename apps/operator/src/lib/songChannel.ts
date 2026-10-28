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

/** Channel a song cue goes to: always preview. A cue never goes live, whatever the routing. */
export function songCueChannel(_row: SongRow, _show: Show | null, _caches: Caches): string {
  return "preview";
}
