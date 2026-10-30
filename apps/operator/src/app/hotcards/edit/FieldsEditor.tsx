"use client";

import { useMemo } from "react";
import type { Template } from "@overlaysys/core";
import { Input, colors } from "@overlaysys/ui";
import { FieldInput } from "@/lib/FieldInput";

/** A template's fields as inputs; shared by the hotcard editor and the New hotcard step. */
export function FieldsEditor({
  template,
  data,
  onChange,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const declaredKeys = useMemo(
    () => template?.fields.map((f) => f.key) ?? [],
    [template],
  );
  const orphanKeys = Object.keys(data).filter((k) => !declaredKeys.includes(k));
  const fieldsToShow = template?.fields ?? [];

  if (!template) {
    return (
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Loading template…
      </span>
    );
  }

  if (fieldsToShow.length === 0 && orphanKeys.length === 0) {
    return (
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Template declares no fields.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {fieldsToShow.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 110, fontSize: 12, color: colors.textDim, flexShrink: 0 }}>
            {f.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        </div>
      ))}
      {orphanKeys.map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
          <span
            style={{ width: 110, fontSize: 12, color: colors.accent2, flexShrink: 0 }}
            title="Not declared by the template — will still be sent on take."
          >
            {k}*
          </span>
          <Input
            value={data[k] ?? ""}
            onChange={(e) => onChange(k, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
