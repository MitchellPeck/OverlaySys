import type { GraphicRow, ScriptureRow, Show, SongRow, SongSessionSummary, VideoRow } from "@overlaysys/core";

export type StageMode =
  | { kind: "song-live"; channel: "program" | "preview"; session: SongSessionSummary }
  | { kind: "quick-take" }
  | { kind: "song"; row: SongRow }
  | { kind: "scripture"; row: ScriptureRow }
  | { kind: "graphic"; row: GraphicRow }
  | { kind: "video"; row: VideoRow }
  | { kind: "hotcard"; hotcardId: string }
  | { kind: "empty" };

/**
 * What the console's stage area shows. Precedence: a live song session
 * (program before preview) > quick take > selected row > selected hotcard >
 * empty. Mirrors the old Show page, where song mode replaced the take column.
 */
export function stageModeFor(input: {
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  songSessions: Record<string, SongSessionSummary | null>;
  quickTake: boolean;
}): StageMode {
  const { show, selectedRowId, selectedHotcardId, songSessions, quickTake } = input;
  for (const channel of ["program", "preview"] as const) {
    const session = songSessions[channel];
    if (session) return { kind: "song-live", channel, session };
  }
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
  if (mode.kind === "song-live") {
    return "Space next · Shift+Space previous · C/B/T chorus/bridge/tag · 1–9 verse · . blank · Esc end song";
  }
  const space = mode.kind === "video" ? "Space take / play-pause" : "Space take";
  return `↑/↓ select · Enter cue · ${space} · ⌘Enter PVW → PGM · Esc clear program`;
}
