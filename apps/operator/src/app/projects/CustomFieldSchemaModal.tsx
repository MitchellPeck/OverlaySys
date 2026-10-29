"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  IconButton,
  Inline,
  Input,
  Select,
  Stack,
  colors,
} from "@overlaysys/ui";
import type { Project } from "@overlaysys/core";
import { deriveFieldKey } from "./fieldKey";

type FieldRow = {
  key: string;
  label: string;
  type: "text" | "number";
  /** The key follows the label until the operator edits it (existing fields start manual). */
  keyManual: boolean;
  /** Validation shows only after the row has been blurred. */
  touched: boolean;
};

type SchemaEntry = NonNullable<Project["songCustomFieldSchema"]>[number];

interface Props {
  project: Project;
  onSave: (schema: SchemaEntry[] | undefined) => void;
  onCancel: () => void;
}

const GRID = "minmax(0, 1.2fr) minmax(0, 1fr) 100px 96px";

/**
 * Dialog body for editing a project's `songCustomFieldSchema`. Edits a local
 * working copy of rows; only on Save does the parent receive the new schema
 * array (or `undefined` if the list is empty, which keeps the optional field
 * absent rather than persisting `[]`).
 *
 * The label comes first and the key is derived from it (shown muted; "Edit
 * key" makes it editable). Validation shows on blur:
 *  - every row needs a non-empty `key` and `label`
 *  - keys must be unique case-insensitively
 *  - Save is disabled while validation errors exist
 */
export function CustomFieldSchemaModal({ project, onSave, onCancel }: Props) {
  const [rows, setRows] = useState<FieldRow[]>(() =>
    (project.songCustomFieldSchema ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type ?? "text",
      keyManual: true,
      touched: true,
    })),
  );
  const [editingKey, setEditingKey] = useState<number | null>(null);

  // Track duplicate-key indexes so we can highlight every row in a duplicate
  // group, not just the second occurrence.
  const duplicateIndexes = useMemo(() => {
    const seen = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const k = r.key.trim().toLowerCase();
      if (!k) return;
      const list = seen.get(k) ?? [];
      list.push(i);
      seen.set(k, list);
    });
    const dups = new Set<number>();
    for (const list of seen.values()) {
      if (list.length > 1) for (const i of list) dups.add(i);
    }
    return dups;
  }, [rows]);

  const hasEmptyKey = rows.some((r) => !r.key.trim());
  const hasEmptyLabel = rows.some((r) => !r.label.trim());
  const hasDuplicates = duplicateIndexes.size > 0;
  const canSave = !hasEmptyKey && !hasEmptyLabel && !hasDuplicates;
  const showErrors = rows.some((r) => r.touched);

  function updateRow(i: number, patch: Partial<FieldRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  /** Label edit: re-derive the key (against the other rows) unless it was set by hand. */
  function updateLabel(i: number, label: string) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        if (r.keyManual) return { ...r, label };
        const others = prev.filter((_, j) => j !== i).map((o) => o.key);
        return { ...r, label, key: label.trim() ? deriveFieldKey(label, others) : "" };
      }),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { key: "", label: "", type: "text", keyManual: false, touched: false }]);
  }

  function removeRow(i: number) {
    setEditingKey(null);
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveRow(i: number, dir: -1 | 1) {
    setEditingKey(null);
    setRows((prev) => {
      const target = i + dir;
      if (target < 0 || target >= prev.length) return prev;
      const a = prev[i];
      const b = prev[target];
      if (!a || !b) return prev; // satisfies noUncheckedIndexedAccess
      const next = prev.slice();
      next[i] = b;
      next[target] = a;
      return next;
    });
  }

  function save() {
    if (!canSave) return;
    const cleaned = rows.map<SchemaEntry>((r) => {
      const entry: SchemaEntry = {
        key: r.key.trim(),
        label: r.label.trim(),
      };
      // Persist `type` only when non-default: keeps the JSON tidy and matches
      // the schema's "default text" convention.
      if (r.type !== "text") entry.type = r.type;
      return entry;
    });
    onSave(cleaned.length === 0 ? undefined : cleaned);
  }

  return (
    <Dialog
      open
      size="md"
      onClose={onCancel}
      onCancel={onCancel}
      // No onConfirm: Enter while typing a label shouldn't submit, since
      // the user is likely mid-edit. Save is an explicit button click.
      title={`Song custom fields for ${project.name}`}
      footer={
        <>
          <Button onClick={onCancel} variant="ghost" size="sm">
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!canSave}
            variant="primary"
            size="sm"
          >
            Save
          </Button>
        </>
      }
    >
      <Stack gap={3}>
        <p style={{ margin: 0, fontSize: 12, color: colors.textDim }}>
          Songs in this project will have these fields available by default.
        </p>

        {rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: colors.textDim }}>
            No custom fields yet. Use “Add field” to define one.
          </p>
        ) : (
          <Stack gap={2}>
            <div
              aria-hidden
              style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, fontSize: 11, color: colors.textMuted }}
            >
              <span>Label</span>
              <span>Key</span>
              <span>Type</span>
              <span />
            </div>
            {rows.map((row, i) => {
              const labelInvalid = row.touched && !row.label.trim();
              const keyInvalid = row.touched && (!row.key.trim() || duplicateIndexes.has(i));
              const name = row.label.trim() || `field ${i + 1}`;
              return (
                <div
                  key={i}
                  style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center" }}
                >
                  <Input
                    value={row.label}
                    placeholder="e.g. Hymn number"
                    aria-label={`Label for ${name}`}
                    invalid={labelInvalid}
                    onChange={(e) => updateLabel(i, e.target.value)}
                    onBlur={() => updateRow(i, { touched: true })}
                  />
                  {editingKey === i ? (
                    <Input
                      autoFocus
                      value={row.key}
                      aria-label={`Key for ${name}`}
                      invalid={keyInvalid}
                      onChange={(e) =>
                        updateRow(i, {
                          key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
                          keyManual: true,
                        })
                      }
                      onBlur={() => {
                        updateRow(i, { touched: true });
                        setEditingKey(null);
                      }}
                    />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <code
                        title={row.key}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                          color: keyInvalid ? colors.errorText : colors.textMuted,
                        }}
                      >
                        {row.key || "—"}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit key for ${name}`}
                        onClick={() => setEditingKey(i)}
                      >
                        Edit key
                      </Button>
                    </div>
                  )}
                  <Select
                    value={row.type}
                    aria-label={`Type for ${name}`}
                    onChange={(e) => updateRow(i, { type: e.target.value as FieldRow["type"] })}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                  </Select>
                  <Inline gap={1}>
                    <IconButton
                      onClick={() => moveRow(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${name} up`}
                      title="Move up"
                      size={28}
                    >
                      <ArrowUp size={14} aria-hidden />
                    </IconButton>
                    <IconButton
                      onClick={() => moveRow(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${name} down`}
                      title="Move down"
                      size={28}
                    >
                      <ArrowDown size={14} aria-hidden />
                    </IconButton>
                    <IconButton
                      onClick={() => removeRow(i)}
                      aria-label={`Delete ${name}`}
                      title="Delete field"
                      size={28}
                      style={{ color: colors.danger }}
                    >
                      <Trash2 size={14} aria-hidden />
                    </IconButton>
                  </Inline>
                </div>
              );
            })}
          </Stack>
        )}

        {showErrors && (hasEmptyKey || hasEmptyLabel || hasDuplicates) && (
          <div style={{ fontSize: 11, color: colors.errorText }}>
            {hasEmptyLabel && <div>Every field needs a label.</div>}
            {hasEmptyKey && !hasEmptyLabel && <div>Every field needs a key.</div>}
            {hasDuplicates && <div>Keys must be unique (case-insensitive).</div>}
          </div>
        )}

        <div>
          <Button onClick={addRow} size="sm">
            Add field
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}
