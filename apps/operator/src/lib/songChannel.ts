import {
  resolveSongChannel,
  type ChannelState,
  type Show,
  type Song,
  type SongRow,
  type SongSessionSummary,
  type Template,
} from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { sessionPlaysRow, songRowIsUnique } from "./rowAirState";

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

/**
 * The Lyrics segment's message for a song row on `channel`. It advances the
 * channel's session only when that session is this exact row's: the
 * channel's liveRow names this row, or (with no usable liveRow, e.g. a video
 * taken over the lyrics) the song has only this one row in the show. A
 * reprise row that isn't live, or a session from another show, takes the row
 * afresh instead of moving what's on air.
 */
export function songLyricsMessage(
  row: SongRow,
  show: Show,
  channel: string,
  channelStates: Record<string, ChannelState>,
  session: SongSessionSummary | null | undefined,
): ClientMessage {
  const take: ClientMessage = { type: "song_take", channel, showId: show.id, songRowId: row.id };
  const advance: ClientMessage = { type: "song_advance", channel, delta: 1 };
  if (!session || session.songId !== row.songId) return take;
  const named = sessionPlaysRow(session, row.id, show.id);
  if (named !== undefined) return named ? advance : take;
  const lr = channelStates[channel]?.liveRow;
  if (lr && lr.showId !== show.id) return take;
  if (lr) {
    const taken = show.rows.find((r) => r.id === lr.rowId);
    if (taken?.kind === "song" && taken.songId === row.songId) return taken.id === row.id ? advance : take;
  }
  return songRowIsUnique(show.rows, row.songId) ? advance : take;
}
