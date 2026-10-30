"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { GripVertical, Pencil, TriangleAlert } from "lucide-react";
import { Button, KindBar, Tooltip, colors } from "@overlaysys/ui";
import type { RowView } from "@/lib/rowView";
import type { LiveRowState } from "./rundownModel";

export const rowDomId = (rowId: string) => `rundown-row-${rowId}`;

/** Fixed row height: two lines (16 + 2 + 14) plus 4 px padding top and bottom. */
export const ROW_HEIGHT = 40;

type Props = {
  rowId: string;
  view: RowView;
  mode: "live" | "edit";
  /** 1-based position in the flat rundown (Live shows it before the title). */
  number: number;
  selected: boolean;
  /** "M:SS" or "". */
  length: string;
  /** Edit: cumulative start "M:SS" (or ""). */
  start?: string;
  live?: LiveRowState;
  surface?: { boxShadow: string; background: string };
  /** Why Take/Cue can't be used right now (e.g. not connected); null = usable. */
  actionBlocked?: string | null;
  edited?: boolean;
  overflowWarn?: boolean;
  /** Live: a short note before the state chip (a slides deck's "auto · loops · 5s"). */
  note?: ReactNode;
  dropLine?: "before" | "after" | null;
  onClick(): void;
  onDoubleClick?(): void;
  onTake?(): void;
  onCue?(): void;
  onContextMenu?(e: React.MouseEvent): void;
  onKeyDown?(e: React.KeyboardEvent): void;
  drag?: {
    onDragStart(e: React.DragEvent): void;
    onDragEnd(e: React.DragEvent): void;
    onDragOver(e: React.DragEvent): void;
    onDrop(e: React.DragEvent): void;
  };
};

const chipStyle: CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  lineHeight: "14px",
  padding: "0 5px",
  borderRadius: 3,
  background: colors.surface3,
  color: colors.textDim,
};

const stateChip = (bg: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  lineHeight: "16px",
  padding: "0 6px",
  borderRadius: 3,
  background: bg,
  color: "#fff",
  letterSpacing: ".04em",
  flexShrink: 0,
  whiteSpace: "nowrap",
});

/** Stops a row action's click from selecting / double-clicking the row and hands the keyboard back. */
function act(fn?: () => void) {
  return (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    fn?.();
    e.currentTarget.blur();
  };
}

function SecondLine({ view }: { view: RowView }): ReactNode {
  if (view.warning) {
    // Keep the detail ("1 of 3 slides") before the warning: both matter.
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        {view.detail && <span style={{ flexShrink: 0 }}>{view.detail} ·</span>}
        <span style={{ color: colors.warn, display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <TriangleAlert size={12} aria-hidden style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{view.warning}</span>
        </span>
      </span>
    );
  }
  if (view.chips.length > 0) {
    return (
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        {view.chips.map((c, i) => (
          <span key={`${c}-${i}`} style={chipStyle}>
            {c}
          </span>
        ))}
        {view.moreChips > 0 && <span>+{view.moreChips}</span>}
      </span>
    );
  }
  return view.detail ?? null;
}

/** One rundown row: kind bar, two lines (content first), length, and its state and actions. */
export function RundownRow(p: Props) {
  const { view, live, mode } = p;
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (p.selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.selected]);

  const muted = !!live?.otherShow || !view.supported;
  const dropShadow =
    p.dropLine === "before" ? "inset 0 2px 0 var(--ok)" : p.dropLine === "after" ? "inset 0 -2px 0 var(--ok)" : null;
  const surface = p.surface ?? {
    boxShadow: "none",
    background: p.selected ? "var(--control)" : "transparent",
  };
  const boxShadow = [dropShadow, surface.boxShadow !== "none" ? surface.boxShadow : null].filter(Boolean).join(", ");

  const titleText = (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {view.title}
    </span>
  );

  return (
    <div
      ref={ref}
      id={rowDomId(p.rowId)}
      role="option"
      aria-selected={p.selected}
      tabIndex={-1}
      title={live?.tooltip ?? undefined}
      draggable={mode === "edit" ? true : undefined}
      onDragStart={p.drag?.onDragStart}
      onDragEnd={p.drag?.onDragEnd}
      onDragOver={p.drag?.onDragOver}
      onDrop={p.drag?.onDrop}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={p.onContextMenu}
      onKeyDown={p.onKeyDown}
      data-row-id={p.rowId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: ROW_HEIGHT,
        padding: "4px 8px 4px 6px",
        boxSizing: "border-box",
        cursor: "pointer",
        background: surface.background,
        boxShadow: boxShadow || "none",
        color: muted ? colors.textMuted : colors.text,
        userSelect: "none",
      }}
    >
      <KindBar kind={view.kind} />
      {mode === "edit" ? (
        <GripVertical size={14} aria-hidden style={{ color: colors.textMuted, flexShrink: 0, cursor: "grab" }} />
      ) : (
        <span
          style={{
            width: 16,
            textAlign: "right",
            fontSize: 11,
            color: colors.textMuted,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {p.number}
        </span>
      )}
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: "16px",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {view.tag && view.kind === "graphic" ? <Tooltip content={view.tag}>{titleText}</Tooltip> : titleText}
          {p.edited && (
            <span title="Edited for this session" style={{ display: "inline-flex", flexShrink: 0 }}>
              <Pencil size={12} color={colors.warn} aria-label="Edited for this session" />
            </span>
          )}
          {p.overflowWarn && (
            <span title="Text may not fit the template" style={{ display: "inline-flex", flexShrink: 0 }}>
              <TriangleAlert size={12} color={colors.warn} aria-label="Text may not fit the template" />
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            lineHeight: "14px",
            color: colors.textMuted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            display: "flex",
          }}
        >
          <SecondLine view={view} />
        </div>
      </div>
      {p.note}
      {live?.chip === "onair" && <span style={stateChip(colors.onairFill)}>ON AIR</span>}
      {live?.chip === "cued" && <span style={stateChip(colors.okFill)}>CUED</span>}
      {live?.otherShow && (
        <span
          style={{
            ...stateChip("transparent"),
            color: colors.textMuted,
            border: `1px solid ${colors.border}`,
            fontWeight: 600,
          }}
        >
          OTHER SHOW
        </span>
      )}
      {(live?.showCue || live?.showTake) && (
        <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {live.showCue && p.onCue && (
            <Button
              size="sm"
              variant="ghost"
              tabIndex={-1}
              disabled={!!p.actionBlocked}
              title={p.actionBlocked ?? undefined}
              onClick={act(p.onCue)}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              Cue
            </Button>
          )}
          {live.showTake && p.onTake && (
            <Button
              size="sm"
              variant="onair"
              tabIndex={-1}
              disabled={!!p.actionBlocked}
              title={p.actionBlocked ?? undefined}
              onClick={act(p.onTake)}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              Take
            </Button>
          )}
        </span>
      )}
      {(p.length || p.start) && (
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            fontSize: 11,
            lineHeight: "14px",
            color: colors.textMuted,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            minWidth: 30,
          }}
        >
          <span>{p.length}</span>
          {mode === "edit" && p.start ? <span title="Starts at">{p.start}</span> : null}
        </span>
      )}
    </div>
  );
}
