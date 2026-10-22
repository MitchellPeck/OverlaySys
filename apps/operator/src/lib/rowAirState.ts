import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";

export type AirState = "program" | "preview" | null;

type Row = Show["rows"][number];

const CHANNELS = ["program", "preview"] as const;

function sameData(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function onChannel(
  row: Row,
  ch: (typeof CHANNELS)[number],
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
): boolean {
  const st = channelStates[ch];
  switch (row.kind) {
    case "graphic": {
      const a = st?.active;
      return !!a && a.phase !== "out" && a.templateId === row.templateId && sameData(a.data, row.data);
    }
    case "song":
      return (
        songSessions[ch]?.songId === row.songId ||
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
): AirState {
  for (const ch of CHANNELS) {
    if (onChannel(row, ch, channelStates, songSessions)) return ch;
  }
  return null;
}
