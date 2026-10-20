"use client";

import { useState } from "react";
import { resolveSongChannel } from "@overlaysys/core";
import { Button, PanelHeader, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { onAirMediaFor, videoRowTakeMessage } from "@/lib/mediaTake";
import { shortcutHint, stageModeFor, type StageMode } from "@/lib/stageMode";
import { SongModePanel } from "./SongModePanel";
import { SongTakeStrip } from "./SongTakeStrip";
import { ScriptureTakeStrip } from "./ScriptureTakeStrip";
import { TakePanel } from "./TakePanel";

/**
 * Centre-bottom of the Live console: controls for whatever is selected.
 * Content changes with the mode; the region itself never moves.
 */
export function StageArea() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const selectedRowId = useStore((s) => s.selectedRowId);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const songSessions = useStore((s) => s.songSessions);
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const hotcards = useStore((s) => s.hotcards);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const channelStates = useStore((s) => s.channelStates);
  const [quickTake, setQuickTake] = useState(false);

  const mode = stageModeFor({ show, selectedRowId, selectedHotcardId, songSessions, quickTake });

  function fireHotcard(id: string, target: "preview" | "program") {
    const h = hotcardCache[id];
    if (!h) {
      send({ type: "get_hotcard", hotcardId: id });
      return;
    }
    send({ type: target === "preview" ? "cue" : "take", channel: h.channelHint ?? target, templateId: h.templateId, data: h.data });
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "0 12px 12px", background: colors.surface2, borderRadius: 8 }}>
      <PanelHeader
        title={headingFor(mode)}
        right={
          mode.kind !== "song-live" && (
            <Button size="sm" variant={quickTake ? "primary" : "ghost"} onClick={() => setQuickTake((v) => !v)}>
              Quick take
            </Button>
          )
        }
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
        {mode.kind === "song-live" && <SongModePanel channel={mode.channel} session={mode.session} />}
        {mode.kind === "quick-take" && <TakePanel />}
        {mode.kind === "song" && show && (() => {
          const cachedSong = songCache[mode.row.songId];
          const showSong = show.songs.find((s) => s.songId === mode.row.songId);
          const channel = cachedSong
            ? resolveSongChannel(mode.row, showSong, cachedSong, templateCache[mode.row.lyricTemplateId]) ?? "program"
            : "program";
          return <SongTakeStrip show={show} row={mode.row} channel={channel} liveSession={songSessions[channel] ?? null} />;
        })()}
        {mode.kind === "scripture" && (
          <ScriptureTakeStrip row={mode.row} channel={mode.row.channelHint ?? "program"} />
        )}
        {mode.kind === "graphic" && (
          <TakeButtons
            onCue={() =>
              send({ type: "cue", channel: mode.row.channelHint ?? "preview", templateId: mode.row.templateId, data: mode.row.data })
            }
            onTake={() =>
              send({ type: "take", channel: mode.row.channelHint ?? "program", templateId: mode.row.templateId, data: mode.row.data })
            }
          />
        )}
        {mode.kind === "video" && (
          onAirMediaFor(mode.row, channelStates) ? (
            <p style={{ color: colors.textDim, margin: 0 }}>On air. Use the transport in the bottom bar.</p>
          ) : (
            <TakeButtons onTake={() => send(videoRowTakeMessage(mode.row))} />
          )
        )}
        {mode.kind === "hotcard" && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {hotcards.find((h) => h.id === mode.hotcardId)?.name ?? "Hotcard"}
            </div>
            <TakeButtons onCue={() => fireHotcard(mode.hotcardId, "preview")} onTake={() => fireHotcard(mode.hotcardId, "program")} />
          </>
        )}
        {mode.kind === "empty" && (
          <p style={{ color: colors.textDim, margin: 0 }}>Select a rundown item, or use Quick take.</p>
        )}
      </div>
      <div style={{ padding: "6px 12px", fontSize: 11, color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}>
        {shortcutHint(mode)}
      </div>
    </div>
  );
}

function headingFor(mode: StageMode): string {
  switch (mode.kind) {
    case "song-live":
      return mode.channel === "program" ? "Song mode · PGM" : "Song mode · PVW (cued)";
    case "quick-take":
      return "Quick take";
    case "song":
      return "Song";
    case "scripture":
      return "Scripture";
    case "graphic":
      return "Graphic";
    case "video":
      return "Video";
    case "hotcard":
      return "Hotcard";
    case "empty":
      return "Stage";
  }
}

function TakeButtons({ onCue, onTake }: { onCue?: () => void; onTake: () => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {onCue && (
        <Button size="lg" onClick={onCue}>
          Cue → PVW
        </Button>
      )}
      <Button size="lg" variant="onair" onClick={onTake} style={{ minWidth: 140 }}>
        Take
      </Button>
    </div>
  );
}
