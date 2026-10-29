"use client";

import { useMemo, useRef } from "react";
import type { GraphicRow, Show, Template } from "@overlaysys/core";
import { Input, colors, fontSize } from "@overlaysys/ui";
import { FieldInput } from "@/lib/FieldInput";
import { isCloudMode } from "@/lib/mode";
import { useStore } from "@/lib/store";
import { TemplateSelect } from "../TemplateSelect";
import { FormRow, ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import { patchRow, recentTemplateIds } from "./itemFormModel";

export type ItemFormProps<R> = { row: R; show: Show; onChange(next: R): void };

export function GraphicItemForm({ row, show, onChange }: ItemFormProps<GraphicRow>) {
  const metas = useStore((s) => s.templates);
  const template = useStore((s) => s.templateCache[row.templateId] ?? null);
  const recent = useMemo(() => recentTemplateIds(show, "graphic"), [show]);
  const name = metas.find((t) => t.id === row.templateId)?.name ?? template?.name ?? "Missing template";
  // Async field edits (image uploads) land on the latest row, not the one they started from.
  const rowRef = useRef(row);
  rowRef.current = row;
  const patch = (p: Record<string, unknown>) => onChange(patchRow(rowRef.current, p));
  return (
    <ItemFormFrame row={row} show={show} name={name}>
      <FormRow label="Template">
        <TemplateSelect
          label="Template"
          use="graphic"
          value={row.templateId}
          recentIds={recent}
          onChange={(id) =>
            // Prefill the output from the new template only when the item has none yet.
            patch({ templateId: id, channelHint: row.channelHint ?? metas.find((t) => t.id === id)?.defaultChannel ?? undefined })
          }
        />
      </FormRow>
      <FormRow label="Fields">
        <FieldsEditor template={template} data={row.data} onChange={(key, value) => patch({ data: { ...rowRef.current.data, [key]: value } })} />
      </FormRow>
      <ItemCommonFields
        row={row}
        onChange={(p) => patch(p)}
        showSermonNotes
        sets={isCloudMode() ? [] : show.sermonNotes ?? []}
      />
    </ItemFormFrame>
  );
}

function FieldsEditor({
  template,
  data,
  onChange,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!template) return <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>Loading template…</span>;
  const declared = new Set(template.fields.map((f) => f.key));
  const orphanKeys = Object.keys(data).filter((k) => !declared.has(k));
  if (template.fields.length === 0 && orphanKeys.length === 0) {
    return <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>This template has no fields.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {template.fields.map((f) => (
        <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 110, fontSize: fontSize.xs, color: colors.textDim, flexShrink: 0 }}>{f.label}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        </label>
      ))}
      {orphanKeys.map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.7 }}>
          <span
            style={{ width: 110, fontSize: fontSize.xs, color: colors.warn, flexShrink: 0 }}
            title="Not declared by the template. Still sent on Take; declare it in the template's Fields panel."
          >
            {k}*
          </span>
          <Input aria-label={k} value={data[k] ?? ""} onChange={(e) => onChange(k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
