import type { ChannelState, GraphicRow, ScriptureRow, Show, SlidesRow, SongRow, SongSessionSummary, VideoRow } from "@overlaysys/core";

export type StageMode =
  | { kind: "song-live"; channel: "program" | "preview"; session: SongSessionSummary; selection: StageMode }
  | { kind: "quick-take" }
  | { kind: "song"; row: SongRow }
  | { kind: "scripture-live"; selection: StageMode }
  | { kind: "scripture"; row: ScriptureRow }
  | { kind: "graphic"; row: GraphicRow }
  | { kind: "video"; row: VideoRow }
  | { kind: "slides"; row: SlidesRow } // [P3.8]
  | { kind: "hotcard"; hotcardId: string }
  | { kind: "empty" };

type StageInput = {
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  songSessions: Record<string, SongSessionSummary | null>;
  quickTake: boolean;
  /** A scripture session is live on program (selects the scripture key hint). */
  scriptureLive?: boolean;
};

/**
 * What the console's stage area shows. Precedence: a live song session
 * (program before preview) > quick take > selected row > selected hotcard >
 * empty. A live song session carries the underlying selection: the item
 * region shows the selected row (or Quick take), and the live song's own row
 * only when nothing is selected (see `regionRowId`).
 */
export function stageModeFor(input: StageInput): StageMode {
  for (const channel of ["program", "preview"] as const) {
    const session = input.songSessions[channel];
    if (session) return { kind: "song-live", channel, session, selection: selectionModeFor(input) };
  }
  if (input.scriptureLive) return { kind: "scripture-live", selection: selectionModeFor(input) };
  return selectionModeFor(input);
}

/** The stage mode ignoring song sessions. */
function selectionModeFor(input: StageInput): StageMode {
  const { show, selectedRowId, selectedHotcardId, quickTake } = input;
  if (quickTake) return { kind: "quick-take" };
  const row = selectedRowId && show ? show.rows.find((r) => r.id === selectedRowId) : undefined;
  if (row) {
    switch (row.kind) {
      case "song":
        return { kind: "song", row };
      case "scripture":
        return { kind: "scripture", row };
      case "graphic":
        return { kind: "graphic", row };
      case "video":
        return { kind: "video", row };
      case "slides": // [P3.8]
        return { kind: "slides", row };
    }
  }
  if (selectedHotcardId) return { kind: "hotcard", hotcardId: selectedHotcardId };
  return { kind: "empty" };
}

/** The selection a live mode carries, or the mode itself. */
export function selectionOf(mode: StageMode): StageMode {
  return mode.kind === "song-live" || mode.kind === "scripture-live" ? mode.selection : mode;
}

type RowSource = { showId: string; rowId: string } | undefined;

/** The show row a live song session belongs to: the channel's liveRow when it is this song's, else the first row of that song. */
export function liveSongRowId(show: Show | null, session: SongSessionSummary, liveRow?: RowSource): string | null {
  if (!show) return null;
  if (liveRow && liveRow.showId === show.id) {
    const r = show.rows.find((x) => x.id === liveRow.rowId);
    if (r && r.kind === "song" && r.songId === session.songId) return r.id;
  }
  return show.rows.find((r) => r.kind === "song" && r.songId === session.songId)?.id ?? null;
}

/**
 * The row whose thumbnails the item region shows: the selected row; with no
 * row selected under a live song, the live song's row. Null for quick take,
 * a hotcard or nothing.
 */
export function regionRowId(mode: StageMode, show: Show | null, liveRow?: RowSource): string | null {
  const sel = selectionOf(mode);
  if ("row" in sel) return sel.row.id;
  if (mode.kind === "song-live" && sel.kind === "empty") return liveSongRowId(show, mode.session, liveRow);
  return null;
}

/**
 * The row on program right now (media, song, scripture or slides session),
 * when it belongs to this show. Media first: a video over lyrics is what the
 * audience sees.
 */
export function programRowId(show: Show | null, program: ChannelState | undefined): string | null {
  if (!show || !program) return null;
  const inShow = (id: string | undefined) => (id && show.rows.some((r) => r.id === id) ? id : null);
  if (program.media) return inShow(program.media.rowId);
  if (program.songSession) return liveSongRowId(show, program.songSession, program.liveRow);
  if (program.scriptureSession) return inShow(program.scriptureSession.rowId);
  if (program.slidesSession) return inShow(program.slidesSession.rowId);
  return null;
}

/** The program row to pin above the strip: live, and not the row the region already shows. */
export function pinnedRowId(show: Show | null, program: ChannelState | undefined, shownRowId: string | null): string | null {
  const id = programRowId(show, program);
  return id && id !== shownRowId ? id : null;
}

/** One-line keyboard hint for the stage area. Text only; bindings live in useGlobalShortcuts. */
export function shortcutHint(mode: StageMode): string {
  switch (mode.kind) {
    case "song-live":
      // Song keys only drive a program session; with the song merely cued on
      // preview, keys act on the rundown selection.
      if (mode.channel !== "program") return `Song cued on PVW (keys act on the selection) · ${shortcutHint(mode.selection)}`;
      return "Space next · Shift+Space previous · C/B/T chorus/bridge/tag · 1–9, 0 verse · . blank · Esc Esc end song";
    case "quick-take":
      return "Keys act on the rundown selection · use the buttons above for Quick take";
    case "scripture-live":
      return "Space next · Shift+Space previous · Enter cue selection · ⌘Enter take PVW · Esc Esc clear program";
    default: {
      const space = mode.kind === "video" ? "Space take / play-pause" : "Space take";
      return `↑/↓ select · Enter cue · ${space} · ⌘Enter take PVW · Esc Esc clear program`;
    }
  }
}
