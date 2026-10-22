"use client";

import { useMemo, useState } from "react";
import { BookOpen, Film, Music, RotateCcw, Type } from "lucide-react";
import { resolveSongChannel, type ChannelConfig, type ChannelState, type GraphicRow, type VideoRow } from "@overlaysys/core";
import { Button, IconButton, PanelHeader, colors, radius, space } from "@overlaysys/ui";
import { FieldInput } from "@/lib/FieldInput";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { formatClock, onAirMediaFor, videoRowTakeMessage } from "@/lib/mediaTake";
import { editedFieldKeys, effectiveRowData, graphicRowMessage, upNextRows } from "@/lib/rowData";
import { shortcutHint, stageModeFor, type StageMode } from "@/lib/stageMode";
import { SongModePanel } from "./SongModePanel";
import { SongTakeStrip } from "./SongTakeStrip";
import { ScriptureTakeStrip } from "./ScriptureTakeStrip";
import { TakePanel } from "./TakePanel";
import { ChannelPreview } from "./ChannelPreview";

/**
 * Centre-bottom of the Live console: controls for whatever is selected.
 * Content changes with the mode; the region itself never moves.
 */
export function StageArea() {
  const selectedRowId = useStore((s) => s.selectedRowId);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const show = useStore((s) => s.show);
  const songSessions = useStore((s) => s.songSessions);
  const [quickTake, setQuickTake] = useState(false);

  const mode = stageModeFor({ show, selectedRowId, selectedHotcardId, songSessions, quickTake });
  // In song mode, the selected row keeps its controls below the song panel,
  // unless it's the live song itself.
  const extra =
    mode.kind === "song-live" &&
    mode.selection.kind !== "empty" &&
    !(mode.selection.kind === "song" && mode.selection.row.songId === mode.session.songId)
      ? mode.selection
      : null;

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
        {mode.kind === "song-live" ? (
          <>
            <SongModePanel channel={mode.channel} session={mode.session} />
            {extra && (
              <section style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textDim, marginBottom: 8 }}>
                  Selected: <SelectionTitle mode={extra} />
                </div>
                <SelectionControls mode={extra} compact />
              </section>
            )}
          </>
        ) : (
          <>
            <SelectionControls mode={mode} />
            {(mode.kind === "graphic" || mode.kind === "video" || mode.kind === "song" || mode.kind === "scripture") && (
              <UpNext selectedRowId={mode.row.id} />
            )}
          </>
        )}
      </div>
      <div style={{ padding: "6px 12px", fontSize: 11, color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}>
        {shortcutHint(mode)}
      </div>
    </div>
  );
}

/**
 * Controls for a non-song-live stage mode. Shared by the main stage and the
 * song-mode "Selected" section; `compact` (song mode) drops previews so
 * Cue/Take sit directly under the "Selected" header.
 */
function SelectionControls({ mode, compact = false }: { mode: StageMode; compact?: boolean }) {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const songSessions = useStore((s) => s.songSessions);
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const hotcards = useStore((s) => s.hotcards);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const channelStates = useStore((s) => s.channelStates);

  function fireHotcard(id: string, target: "preview" | "program") {
    const h = hotcardCache[id];
    if (!h) {
      send({ type: "get_hotcard", hotcardId: id });
      return;
    }
    send({ type: target === "preview" ? "cue" : "take", channel: h.channelHint ?? target, templateId: h.templateId, data: h.data });
  }

  switch (mode.kind) {
    case "song-live":
      return null;
    case "quick-take":
      return <TakePanel />;
    case "song": {
      if (!show) return null;
      const cachedSong = songCache[mode.row.songId];
      const showSong = show.songs.find((s) => s.songId === mode.row.songId);
      const channel = cachedSong
        ? resolveSongChannel(mode.row, showSong, cachedSong, templateCache[mode.row.lyricTemplateId]) ?? "program"
        : "program";
      return <SongTakeStrip show={show} row={mode.row} channel={channel} liveSession={songSessions[channel] ?? null} />;
    }
    case "scripture":
      if (!show) return null;
      return <ScriptureTakeStrip show={show} row={mode.row} channel={mode.row.channelHint ?? "program"} />;
    case "graphic":
      return <GraphicStage key={mode.row.id} row={mode.row} compact={compact} />;
    case "video":
      return (
        <>
          {onAirMediaFor(mode.row, channelStates) ? (
            <p style={{ color: colors.textDim, margin: 0 }}>On air. Use the transport in the bottom bar.</p>
          ) : (
            <TakeButtons onTake={() => send(videoRowTakeMessage(mode.row))} />
          )}
          <VideoDetails key={mode.row.id} row={mode.row} />
        </>
      );
    case "hotcard": {
      const h = hotcardCache[mode.hotcardId];
      const fields = h ? templateCache[h.templateId]?.fields : undefined;
      const entries: [string, string][] = h
        ? fields
          ? fields.filter((f) => h.data[f.key] !== undefined).map((f) => [f.label, h.data[f.key]!])
          : Object.entries(h.data)
        : [];
      return (
        <>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {hotcards.find((h) => h.id === mode.hotcardId)?.name ?? "Hotcard"}
          </div>
          <div key={mode.hotcardId} style={stageColumns}>
            <div style={previewColumn}>
              {h && !compact && <StagePreview rowId={`hotcard:${h.id}`} templateId={h.templateId} data={h.data} />}
              <TakeButtons onCue={() => fireHotcard(mode.hotcardId, "preview")} onTake={() => fireHotcard(mode.hotcardId, "program")} />
            </div>
            {entries.length > 0 && (
              <dl style={{ ...fieldsColumn, margin: 0, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 12px", alignContent: "start", fontSize: 12 }}>
                {entries.map(([label, value], i) => (
                  <div key={i} style={{ display: "contents" }}>
                    <dt style={{ color: colors.textDim }}>{label}</dt>
                    <dd style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </>
      );
    }
    case "empty":
      return <p style={{ color: colors.textDim, margin: 0 }}>Select a rundown item, or use Quick take.</p>;
  }
}

// Preview left (260–360px), fields right; wraps to one column below ~640px of container width.
const stageColumns: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: space[4], alignItems: "flex-start" };
const previewColumn: React.CSSProperties = {
  flex: "1 1 300px",
  minWidth: 260,
  maxWidth: 360,
  display: "flex",
  flexDirection: "column",
  gap: space[3],
};
const fieldsColumn: React.CSSProperties = { flex: "999 1 320px", minWidth: 0 };

/**
 * Selected graphic row: preview + Cue/Take on the left, session-only field
 * edits on the right. Compact (song mode) shows Cue/Take first, then fields,
 * with no preview.
 */
function GraphicStage({ row, compact }: { row: GraphicRow; compact: boolean }) {
  const { send } = useWs();
  const templateCache = useStore((s) => s.templateCache);
  const rowOverrides = useStore((s) => s.rowDataOverrides[row.id]);
  const setRowFieldOverride = useStore((s) => s.setRowFieldOverride);
  const clearRowOverrides = useStore((s) => s.clearRowOverrides);
  // Only this row's edits, so other rows' edits don't re-render the preview.
  const own = useMemo(() => (rowOverrides ? { [row.id]: rowOverrides } : {}), [row.id, rowOverrides]);
  const data = useMemo(() => effectiveRowData(row, own), [row, own]);
  const edited = editedFieldKeys(row, own);
  const fields = templateCache[row.templateId]?.fields;

  const takeButtons = (
    <TakeButtons
      onCue={() => send(graphicRowMessage(row, "cue", useStore.getState().rowDataOverrides))}
      onTake={() => send(graphicRowMessage(row, "take", useStore.getState().rowDataOverrides))}
    />
  );

  return (
    <div style={compact ? { display: "flex", flexDirection: "column", gap: space[3] } : stageColumns}>
      {compact ? (
        takeButtons
      ) : (
        <div style={previewColumn}>
          <StagePreview rowId={row.id} templateId={row.templateId} data={data} />
          {takeButtons}
        </div>
      )}
      <div style={compact ? { minWidth: 0 } : fieldsColumn}>
        {!fields ? (
          <p style={{ fontSize: 12, color: colors.textDim, margin: 0 }}>Loading fields…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {fields.map((f) => {
              const isEdited = edited.includes(f.key);
              return (
                <div key={f.key} style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr) 24px", gap: space[2], alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.label}>
                    {f.label}
                  </label>
                  <div style={{ borderLeft: `2px solid ${isEdited ? colors.warn : "transparent"}`, paddingLeft: 6, minWidth: 0 }}>
                    <FieldInput
                      field={f}
                      value={data[f.key]}
                      onChange={(v) => setRowFieldOverride(row.id, f.key, v, row.data[f.key])}
                    />
                  </div>
                  {isEdited ? (
                    <IconButton
                      size={24}
                      title="Reset to saved value"
                      aria-label={`Reset ${f.label} to saved value`}
                      onClick={() => setRowFieldOverride(row.id, f.key, row.data[f.key] ?? "", row.data[f.key] ?? "")}
                    >
                      <RotateCcw size={12} />
                    </IconButton>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginTop: space[3], minHeight: 28 }}>
          <span style={{ fontSize: 12, color: colors.textDim }}>→ {row.channelHint ?? "program"}</span>
          {edited.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => clearRowOverrides(row.id)} style={{ marginLeft: "auto" }}>
              Reset edits
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoDetails({ row }: { row: VideoRow }) {
  const items: [string, string][] = [
    ["Label", row.label || "Video"],
    ...(row.durationSec ? ([["Duration", formatClock(row.durationSec)]] as [string, string][]) : []),
    ["At end", row.endAction === "clear" ? "clears at end" : "holds at end"],
  ];
  return (
    <dl style={{ margin: `${space[3]}px 0 0`, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 12px", fontSize: 12 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: colors.textDim }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const STAGE_PREVIEW_CONFIG: ChannelConfig = {
  id: "__stage-preview",
  name: "Selected",
  kind: "graphics",
  renderMode: "normal",
  background: "transparent",
};

/**
 * Display-only render of the selected item, via the sidebar's ChannelPreview
 * fed a synthetic channel. `takenAt` is fixed per row so field edits update
 * the mount in place; selecting another row replays the in animation.
 */
function StagePreview({ rowId, templateId, data }: { rowId: string; templateId: string; data: Record<string, string> }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const takenAt = useMemo(() => Date.now(), [rowId]);
  const state = useMemo<ChannelState>(
    () => ({ channel: STAGE_PREVIEW_CONFIG.id, active: { templateId, data, phase: "on", takenAt } }),
    [templateId, data, takenAt],
  );
  return (
    <div style={{ width: "100%", maxWidth: 360 }}>
      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Selected</div>
      <ChannelPreview config={STAGE_PREVIEW_CONFIG} state={state} />
    </div>
  );
}

/**
 * The next few rundown rows after the selection, each with its own quick
 * controls. Cards aren't click targets: the list shifts when the selection
 * moves, so only explicit buttons act.
 */
function UpNext({ selectedRowId }: { selectedRowId: string }) {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const templates = useStore((s) => s.templates);
  const songs = useStore((s) => s.songs);
  const overrides = useStore((s) => s.rowDataOverrides);
  const channelStates = useStore((s) => s.channelStates);
  const setSelectedRow = useStore((s) => s.setSelectedRow);
  const disconnected = useStore((s) => s.conn) !== "open";
  const rows = upNextRows(show, selectedRowId, 3);
  if (!show || rows.length === 0) return null;

  const btn = { disabled: disconnected, title: disconnected ? "Disconnected from server" : undefined };
  // Blur after clicking so a later Space/Enter goes to the global shortcuts, not this button.
  const act = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    fn();
    e.currentTarget.blur();
  };
  // Cue/Take also select the row (as Rundown double-click does), so Space follows what was sent.
  const select = (id: string) => (
    <Button size="sm" variant="ghost" onClick={act(() => setSelectedRow(id))}>
      Select
    </Button>
  );

  return (
    <section style={{ marginTop: space[4], paddingTop: space[3], borderTop: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.textDim, marginBottom: space[2] }}>Up next</div>
      <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
        {rows.map((row) => {
          const index = show.rows.indexOf(row) + 1;
          let icon: React.ReactNode;
          let title: string;
          let actions: React.ReactNode;
          switch (row.kind) {
            case "graphic": {
              const name = templates.find((t) => t.id === row.templateId)?.name ?? row.templateId;
              const t = effectiveRowData(row, overrides).title;
              icon = <Type size={14} />;
              title = t ? `${name} · ${t}` : name;
              actions = (
                <>
                  {select(row.id)}
                  <Button
                    size="sm"
                    {...btn}
                    onClick={act(() => {
                      setSelectedRow(row.id);
                      send(graphicRowMessage(row, "cue", useStore.getState().rowDataOverrides));
                    })}
                  >
                    Cue
                  </Button>
                  <Button
                    size="sm"
                    variant="onair"
                    {...btn}
                    onClick={act(() => {
                      setSelectedRow(row.id);
                      send(graphicRowMessage(row, "take", useStore.getState().rowDataOverrides));
                    })}
                  >
                    Take
                  </Button>
                </>
              );
              break;
            }
            case "video": {
              const onAir = !!onAirMediaFor(row, channelStates);
              icon = <Film size={14} />;
              title = row.label || "Video";
              actions = (
                <>
                  {select(row.id)}
                  <Button
                    size="sm"
                    variant="onair"
                    disabled={disconnected || onAir}
                    title={disconnected ? "Disconnected from server" : onAir ? "Already on air" : undefined}
                    onClick={act(() => {
                      setSelectedRow(row.id);
                      if (onAirMediaFor(row, useStore.getState().channelStates)) return;
                      send(videoRowTakeMessage(row));
                    })}
                  >
                    Take
                  </Button>
                </>
              );
              break;
            }
            case "song":
              icon = <Music size={14} />;
              title = songs.find((s) => s.id === row.songId)?.title ?? row.songId;
              actions = select(row.id);
              break;
            case "scripture":
              icon = <BookOpen size={14} />;
              title = row.reference || "Scripture";
              actions = select(row.id);
              break;
          }
          return (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: space[2],
                padding: "4px 8px",
                borderRadius: radius.sm,
                background: colors.surface,
                minWidth: 0,
              }}
            >
              <span style={{ width: 18, textAlign: "right", color: colors.textMuted, fontSize: 11 }}>{index}</span>
              <span style={{ color: colors.textDim, display: "inline-flex" }}>{icon}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }} title={title}>
                {title}
              </span>
              <span style={{ display: "flex", gap: space[1], flexShrink: 0 }}>{actions}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Short title for the selection shown under song mode: the row's title, else its kind. */
function SelectionTitle({ mode }: { mode: StageMode }) {
  const songs = useStore((s) => s.songs);
  const templates = useStore((s) => s.templates);
  const hotcards = useStore((s) => s.hotcards);
  switch (mode.kind) {
    case "song":
      return <>{songs.find((s) => s.id === mode.row.songId)?.title ?? "Song"}</>;
    case "scripture":
      return <>{mode.row.reference || "Scripture"}</>;
    case "graphic":
      return <>{templates.find((t) => t.id === mode.row.templateId)?.name ?? "Graphic"}</>;
    case "video":
      return <>{mode.row.label || "Video"}</>;
    case "hotcard":
      return <>{hotcards.find((h) => h.id === mode.hotcardId)?.name ?? "Hotcard"}</>;
    default:
      return <>{headingFor(mode)}</>;
  }
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
  const disconnected = useStore((s) => s.conn) !== "open";
  const title = disconnected ? "Disconnected from server" : undefined;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {onCue && (
        <Button size="lg" onClick={onCue} disabled={disconnected} title={title}>
          Cue → PVW
        </Button>
      )}
      <Button size="lg" variant="onair" onClick={onTake} disabled={disconnected} title={title} style={{ minWidth: 140 }}>
        Take
      </Button>
    </div>
  );
}
