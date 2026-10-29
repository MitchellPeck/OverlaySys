"use client";

import { useState, type CSSProperties } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ShowSection } from "@overlaysys/core";
import { IconButton, Input, colors } from "@overlaysys/ui";
import { formatRowLength } from "@/lib/rowLength";

type Props = {
  section: ShowSection;
  lengthSec: number | null;
  mode: "live" | "edit";
  /** Edit: drop line before this section's first row. */
  dropActive?: boolean;
  onRename?(name: string): void;
  onMenu?(e: React.MouseEvent | HTMLElement): void;
  onDragOver?(e: React.DragEvent): void;
  onDrop?(e: React.DragEvent): void;
};

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 28,
  padding: "6px 8px 4px",
  background: colors.bg,
  color: colors.textMuted,
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  lineHeight: "16px",
  boxSizing: "border-box",
};

/** A section header in the rundown. Never aired; in Live it isn't interactive. */
export function SectionDivider({ section, lengthSec, mode, dropActive, onRename, onMenu, onDragOver, onDrop }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const edit = mode === "edit";
  const commit = () => {
    const name = draft?.trim();
    setDraft(null);
    if (name && name !== section.name) onRename?.(name);
  };
  return (
    <div
      role="presentation"
      data-section-id={section.id}
      onDragOver={edit ? onDragOver : undefined}
      onDrop={edit ? onDrop : undefined}
      style={{ ...bar, boxShadow: dropActive ? "inset 0 -2px 0 var(--ok)" : undefined }}
    >
      {edit && draft !== null ? (
        <Input
          autoFocus
          aria-label={`Section name for ${section.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setDraft(null);
          }}
          style={{ flex: 1, minWidth: 0, textTransform: "none", letterSpacing: "normal" }}
        />
      ) : (
        <span
          onDoubleClick={edit ? () => setDraft(section.name) : undefined}
          title={edit ? "Double-click to rename" : undefined}
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {section.name}
        </span>
      )}
      {lengthSec !== null && <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatRowLength(lengthSec)}</span>}
      {edit && onMenu && (
        <IconButton
          aria-label={`Section options for ${section.name}`}
          onClick={(e) => onMenu(e.currentTarget)}
        >
          <MoreHorizontal size={14} aria-hidden />
        </IconButton>
      )}
    </div>
  );
}
