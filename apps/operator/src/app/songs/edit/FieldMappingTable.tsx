"use client";

import { Pill, Select, colors } from "@overlaysys/ui";
import type {
  FieldDescriptor,
  SuggestedFieldMatch,
  TemplateFieldLike,
} from "@overlaysys/core";

export interface FieldMappingTableProps {
  templateFields: TemplateFieldLike[];
  songFields: FieldDescriptor[];
  /** Current map: templateFieldKey -> songFieldKey. Missing key = unmapped. */
  value: Record<string, string>;
  /** Output of `suggestFieldMap(templateFields, songFields)`. */
  suggestions: Record<string, SuggestedFieldMatch>;
  onChange(next: Record<string, string>): void;
  /**
   * Template-field keys the user has explicitly touched. Suggested matches for
   * keys NOT in this set render as a "suggested" pill; once a row is confirmed
   * (either by clicking the pill or picking a value), the pill disappears.
   *
   * Owned by the parent so it can be cleared when the template changes.
   */
  confirmedKeys: Set<string>;
  onConfirm(templateFieldKey: string): void;
}

/**
 * Reusable table for mapping a template's fields to a song's fields. Pure
 * props in / events out — no store access, no fetching. Used by the Song
 * editor (default intro/outro maps) and later by the Show editor / row editor
 * (override maps).
 *
 * Rendering rules per row:
 *  - Suggested match, not yet confirmed → show "suggested" Pill the user can
 *    click to confirm. The pill click does NOT change the value (the suggested
 *    value is already in `value`); it just acknowledges the suggestion.
 *  - Exact match (suggestion `kind: "exact"`) → show a ✓ indicator.
 *  - Confirmed (key in `confirmedKeys`) → no pill; treat as a normal mapping.
 *  - Picking a different value from the Select implicitly confirms the row.
 */
export function FieldMappingTable({
  templateFields,
  songFields,
  value,
  suggestions,
  onChange,
  confirmedKeys,
  onConfirm,
}: FieldMappingTableProps) {
  function setMapping(templateFieldKey: string, songFieldKey: string) {
    const next = { ...value };
    if (songFieldKey) {
      next[templateFieldKey] = songFieldKey;
    } else {
      delete next[templateFieldKey];
    }
    onChange(next);
    // Explicit edits always confirm the row — clears any "suggested" pill.
    onConfirm(templateFieldKey);
  }

  if (templateFields.length === 0) {
    return (
      <p style={{ fontSize: 12, color: colors.textDim, fontStyle: "italic", margin: 0 }}>
        This template has no fields to map.
      </p>
    );
  }

  return (
    <div
      role="table"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) auto minmax(180px, 1.4fr) auto",
        gap: 6,
        alignItems: "center",
        fontSize: 12,
      }}
    >
      {templateFields.map((tf) => {
        const suggestion = suggestions[tf.key] ?? { kind: "none" as const };
        const current = value[tf.key] ?? "";
        const isConfirmed = confirmedKeys.has(tf.key);
        const showSuggestedPill =
          suggestion.kind === "suggested" && !isConfirmed && current === suggestion.songFieldKey;
        const showExactCheck =
          suggestion.kind === "exact" && current === suggestion.songFieldKey;
        return (
          <div key={tf.key} style={{ display: "contents" }}>
            <div
              role="cell"
              title={tf.key}
              style={{
                fontWeight: 600,
                color: colors.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tf.label || tf.key}
              <span
                style={{
                  marginLeft: 6,
                  color: colors.textDim,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 10,
                  fontWeight: 400,
                }}
              >
                {tf.key}
              </span>
            </div>
            <div role="cell" aria-hidden style={{ color: colors.textDim }}>
              ←
            </div>
            <div role="cell">
              <Select
                value={current}
                onChange={(e) => setMapping(tf.key, e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">(none)</option>
                {/* Preserve out-of-list values rather than silently drop them
                    if the song's customFields list changed after the map was
                    saved. */}
                {current && !songFields.some((sf) => sf.key === current) && (
                  <option value={current}>{current} (missing)</option>
                )}
                {songFields.map((sf) => (
                  <option key={sf.key} value={sf.key}>
                    {sf.label}
                  </option>
                ))}
              </Select>
            </div>
            <div role="cell" style={{ minWidth: 90 }}>
              {showExactCheck && (
                <span
                  title="Exact key match"
                  style={{ color: colors.green, fontWeight: 700 }}
                >
                  ✓
                </span>
              )}
              {showSuggestedPill && (
                <button
                  type="button"
                  onClick={() => onConfirm(tf.key)}
                  title="Click to confirm this suggestion"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <Pill tone="warn" uppercase>
                    suggested
                  </Pill>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
