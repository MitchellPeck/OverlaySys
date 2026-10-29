"use client";

import type { CSSProperties } from "react";
import { Select } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import type { TemplateUse } from "@/lib/templateRoles";
import { templateGroups } from "./forms/itemFormModel";

/**
 * Template picker grouped by use: "Suggested" (recent first, then by name)
 * and "Other templates". Nothing is hidden; a value naming no known template
 * stays selectable as "Missing template".
 */
export function TemplateSelect({
  value,
  use,
  onChange,
  label,
  recentIds,
  emptyLabel,
  style,
}: {
  value: string;
  use: TemplateUse;
  onChange(id: string): void;
  label: string;
  recentIds?: string[];
  /** When set, an empty first option with this label (onChange("") picks it). */
  emptyLabel?: string;
  style?: CSSProperties;
}) {
  const metas = useStore((s) => s.templates);
  const { suggested, others, missing } = templateGroups(metas, use, value, recentIds);
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 320, ...style }}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {missing && <option value={value}>Missing template</option>}
      {suggested.length > 0 && (
        <optgroup label="Suggested">
          {suggested.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Other templates">
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
