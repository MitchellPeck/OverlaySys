import type { GraphicRow, ScriptureRow, Show, SongRow, SongSessionSummary, VideoRow } from "@overlaysys/core";

export type StageMode =
  | { kind: "song-live"; channel: "program" | "preview"; session: SongSessionSummary; selection: StageMode }
  | { kind: "quick-take" }
  | { kind: "song"; row: SongRow }
  | { kind: "scripture"; row: ScriptureRow }
  | { kind: "graphic"; row: GraphicRow }
  | { kind: "video"; row: VideoRow }
  | { kind: "hotcard"; hotcardId: string }
  | { kind: "empty" };

type StageInput = {
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  songSessions: Record<string, SongSessionSummary | null>;
  quickTake: boolean;
};

/**
 * What the console's stage area shows. Precedence: a live song session
 * (program before preview) > quick take > selected row > selected hotcard >
 * empty. A live song session still carries the underlying selection so the
 * selected row's controls stay reachable below the song panel (as the old
 * Rundown kept them while song mode replaced only the take column).
 */
export function stageModeFor(input: StageInput): StageMode {
  for (const channel of ["program", "preview"] as const) {
    const session = input.songSessions[channel];
    // The Quick take toggle is hidden in song mode, so the selection ignores it.
    if (session) return { kind: "song-live", channel, session, selection: selectionModeFor({ ...input, quickTake: false }) };
  }
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
    }
  }
  if (selectedHotcardId) return { kind: "hotcard", hotcardId: selectedHotcardId };
  return { kind: "empty" };
}

/** One-line keyboard hint for the stage area. Text only; bindings live in useGlobalShortcuts. */
export function shortcutHint(mode: StageMode): string {
  switch (mode.kind) {
    case "song-live":
      return "Space next · Shift+Space previous · C/B/T chorus/bridge/tag · 1–9, 0 verse · . blank · Esc end song";
    case "quick-take":
      return "Keys act on the rundown selection · use the buttons above for Quick take";
    case "scripture":
      return "↑/↓ select · Use the slide strip to take · ⌘Enter PVW → PGM · Esc clear program";
    default: {
      const space = mode.kind === "video" ? "Space take / play-pause" : "Space take";
      return `↑/↓ select · Enter cue · ${space} · ⌘Enter PVW → PGM · Esc clear program`;
    }
  }
}
