"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { Show } from "@overlaysys/core";
import { colors, isContextMenuKey } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { rowView, type RowView, type RowViewCtx } from "@/lib/rowView";
import { liveGroups } from "@/lib/liveNext";
import type { AirState } from "@/lib/rowAirState";
import { cumulativeStarts, formatRowLength } from "@/lib/rowLength";
import { dropTarget, type DropPos } from "@/app/shows/edit/showEditOps";
import { RundownRow, rowDomId } from "./RundownRow";
import { SectionDivider } from "./SectionDivider";
import { dropHalf, headerLine, liveRowState, liveRowSurface, nudgeTarget } from "./rundownModel";

export type RundownListProps = {
  show: Show;
  mode: "live" | "edit";
  selectedRowId: string | null;
  onSelect(rowId: string): void;
  air?: Record<string, AirState>; // live only
  nextRowId?: string | null; // live only
  onTake?(rowId: string): void; // live: Take on the next row
  onCue?(rowId: string): void; // live: Cue on the selected row
  onDoubleClick?(rowId: string): void; // live: D4 behaviour chosen by the page
  warnRowIds?: Set<string>; // text-overflow rows (Task 13)
  /** Live: rows that have a Cue (video has none). Default: every row when onCue is set. */
  canCue?(rowId: string): boolean;
  /** Live: why Take/Cue are unavailable right now (e.g. "Not connected"); null/undefined = available. */
  actionBlocked?: string | null;
  /** Live: graphic rows edited for this session (pencil mark). */
  editedRowIds?: Set<string>;
  // edit only
  onMoveRow?(rowId: string, target: { toSectionId: string | null; toIndex: number }): void;
  onSectionMenu?(sectionId: string, e: React.MouseEvent | HTMLElement): void;
  onRenameSection?(sectionId: string, name: string): void;
  onRowMenu?(rowId: string, e: React.MouseEvent | HTMLElement): void;
  footer?: ReactNode; // edit: "+ Add item · + Section" (also the empty state's add buttons)
  // [P2a.17] Edit: open this section's inline rename.
  renameSectionId?: string | null;
  // [/P2a.17]
};

type DropAt = { rowId: string; half: "before" | "after" } | { sectionId: string };

/** The sectioned rundown shared by Live and the show editor. */
export function RundownList(p: RundownListProps) {
  const { show, mode } = p;
  const edit = mode === "edit";
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const storeOverrides = useStore((s) => s.rowDataOverrides);
  const deckCache = useStore((s) => s.deckCache);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);

  const groups = useMemo(() => liveGroups(show), [show]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const views = useMemo(() => {
    const ctx: RowViewCtx = {
      show,
      songs,
      songCache,
      templates,
      templateCache,
      overrides: edit ? {} : storeOverrides,
      deckCache,
    };
    const out: Record<string, RowView> = {};
    for (const r of flat) out[r.id] = rowView(r, ctx);
    return out;
  }, [show, flat, songs, songCache, templates, templateCache, storeOverrides, deckCache, edit]);
  const starts = useMemo(() => (edit ? cumulativeStarts(flat) : []), [edit, flat]);

  const drop = (pos: DropPos) => {
    const id = dragId;
    setDragId(null);
    setDropAt(null);
    if (!id || !p.onMoveRow) return;
    const target = dropTarget(show, pos, id);
    if (target) p.onMoveRow(id, target);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (!edit || !p.selectedRowId) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      e.stopPropagation();
      const target = nudgeTarget(show, p.selectedRowId, e.key === "ArrowUp" ? -1 : 1);
      if (target) p.onMoveRow?.(p.selectedRowId, target);
    } else if (isContextMenuKey(e) && p.onRowMenu) {
      const el = document.getElementById(rowDomId(p.selectedRowId));
      if (el) {
        e.preventDefault();
        p.onRowMenu(p.selectedRowId, el);
      }
    }
  };

  const empty = flat.length === 0 && (show.sections ?? []).length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "6px 8px",
          fontSize: 12,
          color: colors.textDim,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {headerLine(show)}
      </div>
      <div
        role="listbox"
        aria-label="Rundown"
        tabIndex={0}
        aria-activedescendant={p.selectedRowId ? rowDomId(p.selectedRowId) : undefined}
        onKeyDown={onListKey}
        style={{ display: "flex", flexDirection: "column", paddingBottom: 6, outlineOffset: -2 }}
      >
        {groups.map((g, gi) => {
          const rows = g.rows.map((r, i) => {
            const n = g.startIndex + i;
            const view = views[r.id]!;
            const selected = r.id === p.selectedRowId;
            const air = p.air?.[r.id] ?? null;
            const live = edit
              ? undefined
              : liveRowState({
                  air,
                  isNext: r.id === p.nextRowId,
                  selected,
                  canCue: !!p.onCue && (p.canCue ? p.canCue(r.id) : true),
                });
            const len = typeof r.lengthSec === "number" ? formatRowLength(r.lengthSec) : "";
            const start = edit && starts[n] != null && len ? formatRowLength(starts[n]!) : "";
            const line =
              dropAt && "rowId" in dropAt && dropAt.rowId === r.id && dragId !== r.id ? dropAt.half : null;
            return (
              <RundownRow
                key={r.id}
                rowId={r.id}
                view={view}
                mode={mode}
                number={n + 1}
                selected={selected}
                length={len}
                start={start}
                live={live}
                surface={live ? liveRowSurface({ air, next: live.next, selected }) : undefined}
                actionBlocked={p.actionBlocked ?? null}
                edited={p.editedRowIds?.has(r.id)}
                overflowWarn={p.warnRowIds?.has(r.id)}
                dropLine={line}
                onClick={() => p.onSelect(r.id)}
                onDoubleClick={p.onDoubleClick ? () => p.onDoubleClick!(r.id) : undefined}
                onTake={p.onTake ? () => p.onTake!(r.id) : undefined}
                onCue={p.onCue ? () => p.onCue!(r.id) : undefined}
                onContextMenu={
                  p.onRowMenu
                    ? (e) => {
                        e.preventDefault();
                        p.onSelect(r.id);
                        p.onRowMenu!(r.id, e);
                      }
                    : undefined
                }
                drag={
                  edit
                    ? {
                        onDragStart: (e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", r.id);
                          setDragId(r.id);
                        },
                        onDragEnd: () => {
                          setDragId(null);
                          setDropAt(null);
                        },
                        onDragOver: (e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const half = dropHalf(e.clientY - rect.top, rect.height);
                          if (!dropAt || !("rowId" in dropAt) || dropAt.rowId !== r.id || dropAt.half !== half) {
                            setDropAt({ rowId: r.id, half });
                          }
                        },
                        onDrop: (e) => {
                          e.preventDefault();
                          const half = dropAt && "rowId" in dropAt && dropAt.rowId === r.id ? dropAt.half : "after";
                          drop({ overRowId: r.id, half });
                        },
                      }
                    : undefined
                }
              />
            );
          });
          if (!g.section) return <Fragment key={`none-${gi}`}>{rows}</Fragment>;
          const section = g.section;
          return (
            <div key={section.id} role="group" aria-label={section.name}>
              <SectionDivider
                section={section}
                lengthSec={g.lengthSec}
                mode={mode}
                dropActive={!!dropAt && "sectionId" in dropAt && dropAt.sectionId === section.id}
                // [P2a.17]
                startRename={p.renameSectionId === section.id}
                // [/P2a.17]
                onRename={p.onRenameSection ? (name) => p.onRenameSection!(section.id, name) : undefined}
                onMenu={p.onSectionMenu ? (e) => p.onSectionMenu!(section.id, e) : undefined}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setDropAt({ sectionId: section.id });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop({ overSectionId: section.id, at: "start" });
                }}
              />
              {rows}
            </div>
          );
        })}
        {!edit && empty && (
          <p style={{ color: colors.textMuted, fontSize: 12, padding: "12px 8px", margin: 0 }}>This show has no items.</p>
        )}
      </div>
      {edit && p.footer ? <div style={{ padding: 8 }}>{p.footer}</div> : null}
    </div>
  );
}
