import type { ChannelState, Hotcard, Show, SongSessionSummary } from "@overlaysys/core";
import { slidesAirState } from "./slidesRowView";

/** "other-show": the channel holds a song or scripture row taken from a different show. */
export type AirState = "program" | "preview" | "other-show" | null;

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

/** True when `songId` appears in at most one song row of `rows`. */
export function songRowIsUnique(rows: ReadonlyArray<{ kind: string; songId?: string }>, songId: string): boolean {
  return rows.filter((r) => r.kind === "song" && r.songId === songId).length <= 1;
}

/**
 * The song session's own verdict on whether it plays `rowId` of `showId`:
 * true / false when the summary names its row (servers since the exact-row
 * fix), undefined when it doesn't (fall back to liveRow). A session naming
 * another show's row is false for every row of this show.
 */
export function sessionPlaysRow(
  session: Pick<SongSessionSummary, "rowId" | "showId"> | null | undefined,
  rowId: string,
  showId: string | undefined,
): boolean | undefined {
  if (!session?.rowId || !showId) return undefined;
  if (session.showId && session.showId !== showId) return false;
  return session.rowId === rowId;
}

/**
 * When the session names its row, that decides. Otherwise:
 * when the channel's liveRow is a row of this song in this show, only that
 * row is the one on air. Otherwise (no liveRow, or a sticky liveRow pointing
 * at a video taken over the lyrics) the row lights only when it is the
 * song's only row in the show: with a reprise we can't tell which was taken.
 */
function isTakenSongRow(
  row: Row & { kind: "song" },
  st: ChannelState | undefined,
  ctx: AirContext | undefined,
  session: SongSessionSummary | null | undefined,
): boolean {
  if (!ctx?.rows) return true;
  const named = sessionPlaysRow(session, row.id, ctx.showId);
  if (named !== undefined) return named;
  const lr = st?.liveRow;
  if (lr && lr.showId === ctx.showId) {
    const taken = ctx.rows.find((r) => r.id === lr.rowId);
    if (taken && taken.kind === "song" && taken.songId === row.songId) return taken.id === row.id;
  }
  return songRowIsUnique(ctx.rows, row.songId);
}

function onChannel(
  row: Row,
  ch: string,
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
  ctx?: AirContext,
): boolean {
  const st = channelStates[ch];
  // A graphic playing out after Clear / Esc Esc keeps its context for a
  // moment; it is no longer on air.
  const live = st?.active && st.active.phase !== "out" ? st.active : undefined;
  switch (row.kind) {
    case "graphic": {
      const a = st?.active;
      return !!a && a.phase !== "out" && a.templateId === row.templateId && sameData(a.data, row.data);
    }
    case "song":
      return (
        (songSessions[ch]?.songId === row.songId && isTakenSongRow(row, st, ctx, songSessions[ch])) ||
        live?.subTakeContext?.songRowId === row.id
      );
    case "video": {
      const m = st?.media;
      return !!m && m.rowId === row.id && m.playback.status !== "ended" && m.playback.status !== "error";
    }
    case "scripture":
      return st?.scriptureSession?.rowId === row.id || live?.scriptureContext?.rowId === row.id;
    case "slides":
      return false; // routed through slidesAirState in rowAirState()
  }
}

/** True when the channel's session was taken from a different show than ctx's. */
function fromOtherShow(row: Row, st: ChannelState | undefined, ctx: AirContext | undefined): boolean {
  if (row.kind !== "song" && row.kind !== "scripture") return false;
  const lr = st?.liveRow;
  if (!lr || !ctx?.showId || lr.showId === ctx.showId) return false;
  return row.kind === "song" ? !!st?.songSession : !!st?.scriptureSession;
}

/**
 * Whether a rundown row is currently on program or cued on preview, derived
 * only from state the operator already receives. Program wins over preview.
 * Scripture rows light from scriptureSession / scriptureContext. A song or
 * scripture row whose channel session was taken from another show reads
 * "other-show" (unless the row is also properly on another channel).
 */
export function rowAirState(
  row: Row,
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
  ctx?: AirContext,
): AirState {
  if (row.kind === "slides") return slidesAirState(row, channelStates);
  let otherShow = false;
  const check = (ch: string): boolean => {
    if (!onChannel(row, ch, channelStates, songSessions, ctx)) return false;
    if (fromOtherShow(row, channelStates[ch], ctx)) {
      otherShow = true;
      return false;
    }
    return true;
  };
  if (check("program")) return "program";
  // A song routed to another output is on air there; show it as program.
  const extra = row.kind === "song" ? ctx?.songChannel : undefined;
  if (extra && extra !== "program" && extra !== "preview" && check(extra)) return "program";
  if (check("preview")) return "preview";
  return otherShow ? "other-show" : null;
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
