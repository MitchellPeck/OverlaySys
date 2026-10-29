"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { IconButton, Input, Menu, SaveBar, type MenuItem, type SaveBarProps } from "@overlaysys/ui";

type Props = {
  name: string;
  readOnly: boolean;
  onRename(name: string): void;
  bar: SaveBarProps;
  onDuplicate(): void;
  /** true/false, or a reason string shown as the menu item's tooltip. */
  duplicateDisabled: boolean | string;
  onDelete(): void;
  deleteDisabled: boolean | string;
};

/** Editable layout name (never the id), the save bar and the "⋯" menu. */
export function StageEditorHeader({ name, readOnly, onRename, bar, onDuplicate, duplicateDisabled, onDelete, deleteDisabled }: Props) {
  const [text, setText] = useState(name);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const skipRef = useRef(false);
  useEffect(() => setText(name), [name]);

  function commit() {
    if (skipRef.current) {
      // Escape: blur fires with the typed (stale) text; discard it.
      skipRef.current = false;
      setText(name);
      return;
    }
    const next = text.trim();
    if (!next || next === name) {
      setText(name);
      return;
    }
    onRename(next);
  }

  const items: MenuItem[] = [
    { id: "duplicate", label: "Duplicate", disabled: duplicateDisabled, onSelect: onDuplicate },
    { separator: true },
    { id: "delete", label: "Delete", danger: true, disabled: deleteDisabled, onSelect: onDelete },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <div style={{ flex: "1 1 auto", minWidth: 120, maxWidth: 360 }}>
        <Input
          size="md"
          value={text}
          disabled={readOnly}
          aria-label="Layout name"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              skipRef.current = true;
              setText(name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{ fontWeight: 600 }}
        />
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        <SaveBar {...bar} />
        <IconButton aria-label={`More actions for ${name}`} onClick={(e) => setMenuAnchor(e.currentTarget)}>
          <MoreHorizontal size={16} aria-hidden />
        </IconButton>
      </div>
      {menuAnchor && <Menu items={items} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </div>
  );
}
