"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Redo2, Undo2 } from "lucide-react";
import { IconButton, Menu, SaveBar, Tooltip, colors, fontSize, radius, type MenuItem } from "@overlaysys/ui";
import { HelpPopover } from "./HelpPopover";

type Props = {
  name: string;
  size: { w: number; h: number };
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onRevert(): void;
  onRename(name: string): void;
  /** "Preview on PVW" (Task 11); null until then. */
  previewSlot: ReactNode;
  onDelete(): void;
  /** Why Save is off (e.g. "Reconnect to save"). */
  saveDisabledReason?: string;
  onDuplicate?(): void;
  onExport?(): void;
  /** true/false, or a reason string shown as the menu item's tooltip. */
  duplicateDisabled?: boolean | string;
  exportDisabled?: boolean | string;
  deleteDisabled?: boolean | string;
};

/**
 * The designer's 40 px header row: inline-editable name, canvas size, undo /
 * redo, help, preview, save bar and the "⋯" menu. The template id is never shown.
 */
export function DesignerHeader(p: Props) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const items: MenuItem[] = [
    { id: "duplicate", label: "Duplicate", disabled: p.duplicateDisabled ?? !p.onDuplicate, onSelect: () => p.onDuplicate?.() },
    { id: "export", label: "Export", disabled: p.exportDisabled ?? !p.onExport, onSelect: () => p.onExport?.() },
    { separator: true },
    { id: "delete", label: "Delete", danger: true, disabled: p.deleteDisabled ?? false, onSelect: p.onDelete },
  ];

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 8px 0 4px",
        minWidth: 0,
        whiteSpace: "nowrap",
        background: colors.surface,
      }}
    >
      <NameInput name={p.name} onRename={p.onRename} />
      <span style={{ color: colors.textMuted, fontSize: fontSize.xs, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {p.size.w}×{p.size.h}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <Tooltip content="Undo (⌘Z)">
          <IconButton aria-label="Undo (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo}>
            <Undo2 size={16} aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content="Redo (⇧⌘Z)">
          <IconButton aria-label="Redo (⇧⌘Z)" disabled={!p.canRedo} onClick={p.onRedo}>
            <Redo2 size={16} aria-hidden />
          </IconButton>
        </Tooltip>
        <HelpPopover />
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {p.previewSlot}
        <SaveBar
          dirty={p.dirty}
          saving={p.saving}
          onSave={p.onSave}
          onRevert={p.onRevert}
          disabledReason={p.saveDisabledReason}
          revertMessage="Discard unsaved changes to this template?"
        />
        <IconButton aria-label={`More actions for ${p.name}`} aria-haspopup="menu" onClick={(e) => setMenuAnchor(e.currentTarget)}>
          <MoreHorizontal size={16} aria-hidden />
        </IconButton>
      </div>
      {menuAnchor && <Menu items={items} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </div>
  );
}

/** The title: looks like text, shows a border on hover / focus. Enter or blur renames, Escape reverts. */
function NameInput({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [text, setText] = useState(name);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const skipRef = useRef(false);
  useEffect(() => setText(name), [name]);

  function commit() {
    setFocus(false);
    if (skipRef.current) {
      // Escape: blur fires with the typed (stale) text; discard it.
      skipRef.current = false;
      setText(name);
      return;
    }
    const next = text.trim();
    // Never leave the template nameless.
    if (!next || next === name) {
      setText(name);
      return;
    }
    onRename(next);
  }

  return (
    <input
      value={text}
      aria-label="Template name"
      title="Template name"
      onChange={(e) => setText(e.target.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          skipRef.current = true;
          e.currentTarget.blur();
        }
      }}
      style={{
        // Grows with the name, within limits.
        width: `${Math.min(40, Math.max(8, text.length + 2))}ch`,
        minWidth: 80,
        flex: "0 1 auto",
        height: 28,
        boxSizing: "border-box",
        padding: "0 6px",
        background: focus ? colors.surface2 : "transparent",
        border: `1px solid ${focus ? colors.brand : hover ? colors.border : "transparent"}`,
        borderRadius: radius.md,
        color: colors.text,
        fontSize: fontSize.base,
        fontWeight: 600,
        textOverflow: "ellipsis",
        outline: "none",
      }}
    />
  );
}
