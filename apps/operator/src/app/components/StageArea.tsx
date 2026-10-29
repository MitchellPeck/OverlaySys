"use client";

import { useEffect, useState } from "react";
import { Button, colors, radius, space } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { hotcardFireMessage } from "@/lib/shortcutGuards";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { rowView } from "@/lib/rowView";
import { thumbsFor, type ThumbCtx } from "@/lib/thumbClick";
import type { RowLike } from "@/lib/rowLike";
import { pinnedRowId, regionRowId, selectionOf, shortcutHint, stageModeFor } from "@/lib/stageMode";
import { slidesRowViewFor, slidesStripNotice, useDeckFor } from "@/lib/slidesRowView";
import { SongLiveBar } from "./SongModePanel";
import { TakePanel } from "./TakePanel";
import { ItemBar } from "./live/ItemBar";
import { ThumbStrip } from "./live/ThumbStrip";
import { useThumbCtx } from "./live/useThumbCtx";

/** Mouse clicks must not leave focus on a control: Space is the global advance key. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/**
 * Centre-bottom of the Live console: the selected item as a 36 px item bar
 * over its slide thumbnails. With nothing selected under a live song, the
 * live song's thumbnails. The region itself never moves.
 */
export function StageArea() {
  const selectedRowId = useStore((s) => s.selectedRowId);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const show = useStore((s) => s.show);
  const songSessions = useStore((s) => s.songSessions);
  const channelStates = useStore((s) => s.channelStates);
  const ctx = useThumbCtx();
  const [quickTake, setQuickTake] = useState(false);

  const mode = stageModeFor({ show, selectedRowId, selectedHotcardId, songSessions, quickTake });
  const sel = selectionOf(mode);
  const liveRow = mode.kind === "song-live" ? channelStates[mode.channel]?.liveRow : undefined;
  const rowId = regionRowId(mode, show, liveRow);
  const row = (rowId && show ? show.rows.find((r) => r.id === rowId) : undefined) as RowLike | undefined;
  const pinned = pinnedRowId(show, channelStates.program, rowId);
  // The live song's own controls (Blank, End song, Auto-advance) sit over its thumbnails.
  const songBar =
    mode.kind === "song-live" && row?.kind === "song" && (row as { songId: string }).songId === mode.session.songId;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        margin: "0 12px 12px",
        background: colors.surface2,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <ItemBar
        key={quickTake ? "quick-take" : (row?.id ?? sel.kind)}
        row={row ?? null}
        hotcardId={sel.kind === "hotcard" ? sel.hotcardId : null}
        quickTake={quickTake}
        onQuickTakeChange={setQuickTake}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
        {pinned && ctx && <PinnedBar rowId={pinned} ctx={ctx} onShow={() => setQuickTake(false)} />}
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: space[3] }}>
          {mode.kind === "song-live" && (
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}>
              {mode.channel === "program" ? "Song mode · PGM" : "Song mode · PVW (cued)"}
            </div>
          )}
          {songBar && mode.kind === "song-live" && <SongLiveBar channel={mode.channel} session={mode.session} />}
          {quickTake ? (
            <TakePanel />
          ) : row && ctx ? (
            <>
              <SlidesNotice row={row} ctx={ctx} />
              <ThumbStrip row={row} ctx={ctx} />
            </>
          ) : sel.kind === "hotcard" ? (
            <HotcardPreview key={sel.hotcardId} hotcardId={sel.hotcardId} />
          ) : null}
        </div>
      </div>
      <div style={{ padding: "6px 12px", fontSize: 11, color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}>
        {shortcutHint(mode)}
      </div>
    </div>
  );
}

/**
 * Sticky reminder of what's on program while another item is selected:
 * "On air: <title> · <slide label>", and Show to select that row.
 */
function PinnedBar({ rowId, ctx, onShow }: { rowId: string; ctx: ThumbCtx; onShow(): void }) {
  const setSelectedRow = useStore((s) => s.setSelectedRow);
  const row = ctx.show.rows.find((r) => r.id === rowId) as RowLike | undefined;
  if (!row) return null;
  const title = rowView(row, ctx).title;
  const slide = thumbsFor(row, ctx).find((t) => t.state === "live")?.label;
  const text = `On air: ${title}${slide ? ` · ${slide}` : ""}`;
  return (
    <div
      role="status"
      aria-label={text}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        height: 28,
        display: "flex",
        alignItems: "center",
        gap: space[2],
        padding: "0 8px 0 12px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: `inset 3px 0 0 ${colors.onair}`,
        fontSize: 12,
      }}
    >
      <span title={text} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: colors.textDim }}>
        <span style={{ color: colors.onair, fontWeight: 600 }}>On air:</span> {title}
        {slide ? ` · ${slide}` : ""}
      </span>
      <Button size="sm" variant="ghost" onMouseDown={keepFocus} onClick={() => {
          onShow();
          setSelectedRow(rowId);
        }}>
        Show
      </Button>
    </div>
  );
}

/** One notice line above a slides row's strip (end of deck, missing deck, skipped slides). */
function SlidesNotice({ row, ctx }: { row: RowLike; ctx: ThumbCtx }) {
  // Called for every row so the selected slides row's deck is fetched; null for other kinds.
  const deck = useDeckFor(row);
  if (row.kind !== "slides") return null;
  const view = slidesRowViewFor(row, deck);
  const notice = view ? slidesStripNotice(row, view, ctx.channelStates) : null;
  if (!notice) return null;
  return (
    <div role="status" style={{ fontSize: 12, color: colors.warn }}>
      {notice}
    </div>
  );
}

const HOTCARD_CARD_W = 300;

/**
 * The selected hotcard as one thumbnail with its field values. A click cues
 * it to preview (never program, whatever the card's hint: D7a).
 */
function HotcardPreview({ hotcardId }: { hotcardId: string }) {
  const { send } = useWs();
  const h = useStore((s) => s.hotcardCache[hotcardId]);
  const fields = useStore((s) => (h ? s.templateCache[h.templateId]?.fields : undefined));
  const disconnected = useStore((s) => s.conn) !== "open";
  useEffect(() => {
    if (!h && !disconnected) send({ type: "get_hotcard", hotcardId });
  }, [h, disconnected, hotcardId, send]);
  if (!h) return <p style={{ fontSize: 12, color: colors.textDim, margin: 0 }}>Loading hotcard…</p>;
  const entries: [string, string][] = fields
    ? fields.filter((f) => h.data[f.key] !== undefined).map((f) => [f.label, h.data[f.key]!])
    : Object.entries(h.data);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[4], alignItems: "flex-start" }}>
      <button
        type="button"
        aria-label={`${h.name}, cue to preview`}
        title={disconnected ? "Reconnect to take" : "Cue to preview"}
        disabled={disconnected}
        onMouseDown={keepFocus}
        onClick={() => send(hotcardFireMessage(h, "cue"))}
        style={{
          padding: 0,
          border: `2px solid ${colors.border}`,
          borderRadius: radius.md,
          background: colors.bg,
          overflow: "hidden",
          cursor: disconnected ? "not-allowed" : "pointer",
          opacity: disconnected ? 0.6 : undefined,
          flexShrink: 0,
        }}
      >
        <TemplateThumbnail templateId={h.templateId} data={h.data} width={HOTCARD_CARD_W} label={`${h.name} preview`} />
      </button>
      {entries.length > 0 && (
        <dl style={{ flex: "1 1 240px", minWidth: 0, margin: 0, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 12px", alignContent: "start", fontSize: 12 }}>
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
  );
}
