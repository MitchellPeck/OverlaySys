"use client";

import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import type { Show } from "@overlaysys/core";
import { IconButton, Input, SaveBar, colors, fontSize, useConfirm, useContextMenu } from "@overlaysys/ui";
import { itemSummary } from "./showEditorModel";

export type ShowHeaderProps = {
  draft: Show;
  onChange(next: Show): void;
  dirty: boolean;
  saving: boolean;
  onSave(): void;
  onRevert(): void;
  onDelete(): void;
  onDuplicate(): void;
  /** Why Save is unavailable (null = available). */
  canSaveReason: string | null;
  /** Why Duplicate is unavailable (null = available). */
  duplicateReason?: string | null;
};

/** Show editor header: name, service date, item count and total, save bar and the show menu. */
export function ShowHeader({
  draft,
  onChange,
  dirty,
  saving,
  onSave,
  onRevert,
  onDelete,
  onDuplicate,
  canSaveReason,
  duplicateReason,
}: ShowHeaderProps) {
  const confirm = useConfirm();
  const menu = useContextMenu();

  const askDelete = async () => {
    const ok = await confirm({
      title: "Delete show?",
      message: `Delete "${draft.name.trim() || "Untitled show"}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) onDelete();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      <Input
        aria-label="Show name"
        placeholder="Untitled show"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        style={{ flex: 1, minWidth: 280, fontSize: 15, fontWeight: 600 }}
      />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fontSize.sm, color: colors.textDim }}>
        Service date
        <Input
          type="date"
          aria-label="Service date"
          title="Service date (used by Companion 'select next show')"
          value={draft.scheduledFor ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onChange({ ...draft, scheduledFor: v });
            else {
              const { scheduledFor: _drop, ...rest } = draft;
              onChange(rest as Show);
            }
          }}
          style={{ width: 150 }}
        />
      </label>
      <span style={{ color: colors.textMuted, fontSize: fontSize.sm, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {itemSummary(draft)}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={onSave}
          onRevert={onRevert}
          disabledReason={canSaveReason ?? undefined}
          revertTitle="Discard unsaved changes to this show?"
        />
        <IconButton
          aria-label="Show options"
          title="Show options"
          onClick={(e) =>
            menu.open(e.currentTarget, [
              {
                id: "duplicate",
                label: "Duplicate",
                icon: <Copy size={14} />,
                disabled: duplicateReason ?? false,
                onSelect: onDuplicate,
              },
              { separator: true },
              {
                id: "delete",
                label: "Delete show",
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () => void askDelete(),
              },
            ])
          }
        >
          <MoreHorizontal size={16} aria-hidden />
        </IconButton>
      </div>
      {menu.menu}
    </div>
  );
}
