"use client";

import { useMemo, useState } from "react";
import {
  Button,
  IconButton,
  Inline,
  Input,
  Modal,
  Select,
  Stack,
  colors,
} from "@overlaysys/ui";
import type { Project } from "@overlaysys/core";

type FieldRow = {
  key: string;
  label: string;
  type: "text" | "number";
};

type SchemaEntry = NonNullable<Project["songCustomFieldSchema"]>[number];

interface Props {
  project: Project;
  onSave: (schema: SchemaEntry[] | undefined) => void;
  onCancel: () => void;
}

/**
 * Dialog body for editing a project's `songCustomFieldSchema`. Edits a local
 * working copy of rows; only on Save does the parent receive the new schema
 * array (or `undefined` if the list is empty — keeps the optional field
 * absent rather than persisting `[]`).
 *
 * Validation:
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
    })),
  );

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

  function updateRow(i: number, patch: Partial<FieldRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: "", label: "", type: "text" }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveRow(i: number, dir: -1 | 1) {
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
      // Persist `type` only when non-default — keeps the JSON tidy and matches
      // the schema's "default text" convention.
      if (r.type !== "text") entry.type = r.type;
      return entry;
    });
    onSave(cleaned.length === 0 ? undefined : cleaned);
  }

  return (
    <Modal
      open
      size="md"
      onClose={onCancel}
      onCancel={onCancel}
      // No onConfirm: Enter while typing a key/label shouldn't submit, since
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
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: colors.textDim,
              fontStyle: "italic",
            }}
          >
            No custom fields yet. Click "+ Add field" to define one.
          </p>
        ) : (
          <Stack gap={2}>
            {rows.map((row, i) => {
              const keyInvalid =
                !row.key.trim() || duplicateIndexes.has(i);
              const labelInvalid = !row.label.trim();
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) 92px auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <Input
                    value={row.key}
                    placeholder="key (e.g. hymn_number)"
                    invalid={keyInvalid}
                    onChange={(e) =>
                      updateRow(i, {
                        // Soft-normalise: lowercase + strip whitespace. We
                        // intentionally don't strip other chars here — the
                        // placeholder hints the convention; strict validation
                        // is at save time only.
                        key: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                      })
                    }
                  />
                  <Input
                    value={row.label}
                    placeholder="Label (e.g. Hymn number)"
                    invalid={labelInvalid}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                  />
                  <Select
                    value={row.type}
                    onChange={(e) =>
                      updateRow(i, {
                        type: e.target.value as FieldRow["type"],
                      })
                    }
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                  </Select>
                  <Inline gap={1}>
                    <IconButton
                      onClick={() => moveRow(i, -1)}
                      disabled={i === 0}
                      title="Move up"
                      size={28}
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      onClick={() => moveRow(i, 1)}
                      disabled={i === rows.length - 1}
                      title="Move down"
                      size={28}
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      onClick={() => removeRow(i)}
                      title="Delete field"
                      size={28}
                      style={{ color: colors.red }}
                    >
                      ×
                    </IconButton>
                  </Inline>
                </div>
              );
            })}
          </Stack>
        )}

        {(hasEmptyKey || hasEmptyLabel || hasDuplicates) && (
          <div style={{ fontSize: 11, color: colors.errorText }}>
            {hasEmptyKey && <div>• Every row needs a key.</div>}
            {hasEmptyLabel && <div>• Every row needs a label.</div>}
            {hasDuplicates && (
              <div>• Keys must be unique (case-insensitive).</div>
            )}
          </div>
        )}

        <div>
          <Button onClick={addRow} size="sm">
            + Add field
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
