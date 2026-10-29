"use client";

import type { Template } from "@overlaysys/core";
import { colors } from "@overlaysys/ui";
import { FieldInput } from "@/lib/FieldInput";
import { SlideTextEditor, slideFieldsFor } from "@/app/songs/edit/slides";

/**
 * Multi-field editor for one deck slide: the template's text fields in
 * SlideTextEditor, then FieldInput for every other field (image, colour, video).
 */
export function DeckSlideFields({
  template,
  data,
  onChange,
  slideNumber,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange(next: Record<string, string>): void;
  /** 1-based, for the heading "Edit slide n". */
  slideNumber?: number;
}) {
  const textFields = slideFieldsFor(template);
  const textKeys = new Set(textFields.map((f) => f.key));
  const others = (template?.fields ?? []).filter((f) => !textKeys.has(f.key));
  return (
    <div>
      <SlideTextEditor
        heading={slideNumber ? `Edit slide ${slideNumber}` : "Edit slide"}
        fields={textFields}
        value={data}
        onChange={onChange}
      />
      {others.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 12px 12px" }}>
          {others.map((f) => (
            <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: colors.textDim }}>{f.label}</span>
              <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange({ ...data, [f.key]: v })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
