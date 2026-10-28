import type { ChannelState, Hotcard, Show, SongSessionSummary } from "@overlaysys/core";

export type AirState = "program" | "preview" | null;

type Row = Show["rows"][number];

/**
 * Extra context for song rows. `songChannel` is where the row is routed (a
 * song on a lyrics-only output still lights). `showId` + `rows` let two rows
 * of the same song tell apart which one was taken, via the channel's liveRow.
 */
export type AirContext = {
  showId?: string;
  rows?: Row[];
  songChannel?: string;
};

function sameData(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * When the channel's liveRow is another row of the same song in this show,
 * only that row is the one on air. Without a liveRow to go on (an older
 * server, or a session started elsewhere), every matching row lights.
 */
function isTakenSongRow(row: Row & { kind: "song" }, st: ChannelState | undefined, ctx: AirContext | undefined): boolean {
  const lr = st?.liveRow;
  if (!lr || !ctx?.rows || lr.showId !== ctx.showId) return true;
  const taken = ctx.rows.find((r) => r.id === lr.rowId);
  if (!taken || taken.kind !== "song" || taken.songId !== row.songId) return true;
  return taken.id === row.id;
}

function onChannel(
  row: Row,
  ch: string,
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
  ctx?: AirContext,
): boolean {
  const st = channelStates[ch];
  switch (row.kind) {
    case "graphic": {
      const a = st?.active;
      return !!a && a.phase !== "out" && a.templateId === row.templateId && sameData(a.data, row.data);
    }
    case "song":
      return (
        (songSessions[ch]?.songId === row.songId && isTakenSongRow(row, st, ctx)) ||
        st?.active?.subTakeContext?.songRowId === row.id
      );
    case "video": {
      const m = st?.media;
      return !!m && m.rowId === row.id && m.playback.status !== "ended" && m.playback.status !== "error";
    }
    case "scripture":
      return st?.scriptureSession?.rowId === row.id || st?.active?.scriptureContext?.rowId === row.id;
  }
}

/**
 * Whether a rundown row is currently on program or cued on preview, derived
 * only from state the operator already receives. Program wins over preview.
 * Scripture rows light from scriptureSession / scriptureContext.
 */
export function rowAirState(
  row: Row,
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
  ctx?: AirContext,
): AirState {
  if (onChannel(row, "program", channelStates, songSessions, ctx)) return "program";
  // A song routed to another output is on air there; show it as program.
  const extra = row.kind === "song" ? ctx?.songChannel : undefined;
  if (extra && extra !== "program" && extra !== "preview" && onChannel(row, extra, channelStates, songSessions, ctx)) {
    return "program";
  }
  if (onChannel(row, "preview", channelStates, songSessions, ctx)) return "preview";
  return null;
}

/**
 * Whether a hotcard is what a channel is showing: same template and data on
 * program (or preview). Only uses state the store already has.
 */
export function hotcardAirState(
  hotcard: Pick<Hotcard, "templateId" | "data"> | undefined,
  channelStates: Record<string, ChannelState>,
): AirState {
  if (!hotcard) return null;
  for (const ch of ["program", "preview"] as const) {
    const a = channelStates[ch]?.active;
    if (a && a.phase !== "out" && a.templateId === hotcard.templateId && sameData(a.data, hotcard.data)) return ch;
  }
  return null;
}
