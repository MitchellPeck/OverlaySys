"use client";

import { IconButton, Input, Pill, Select, colors } from "@overlaysys/ui";
import type {
  FieldDescriptor,
  SuggestedFieldMatch,
  TemplateFieldLike,
} from "@overlaysys/core";

/** Sentinel value used in the song-field Select to indicate "use a literal". */
const LITERAL_SENTINEL = "__literal__";

export interface FieldMappingTableProps {
  templateFields: TemplateFieldLike[];
  songFields: FieldDescriptor[];
  /** Current map: templateFieldKey -> songFieldKey. Missing key = unmapped. */
  value: Record<string, string>;
  /**
   * Literal template strings keyed by template-field key. A present entry puts
   * the row in "literal mode" and wins over `value` at resolution time. The
   * string may contain `{songFieldKey}` tokens — see interpolateSongString.
   */
  literals: Record<string, string>;
  /** Output of `suggestFieldMap(templateFields, songFields)`. */
  suggestions: Record<string, SuggestedFieldMatch>;
  /** Called when the map changes (literal entries are unaffected by this). */
  onChange(next: Record<string, string>): void;
  /** Called when the literals record changes (map entries are unaffected). */
  onLiteralsChange(next: Record<string, string>): void;
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
 * Reusable table for binding a template's fields to song fields OR to literal
 * template strings. Pure props in / events out — no store access, no fetching.
 * Used by the Song editor (default intro/outro bindings), the Show-level
 * SongOverrideEditor, and the SongRow editor.
 *
 * Each row is in one of three states:
 *  - **Unmapped** — Select shows "(none)". Status cell may show a "suggested"
 *    pill if `suggestions[key]` carries an unconfirmed proposal.
 *  - **Mapped to song field** — Select shows the chosen song field. Status
 *    cell shows ✓ for exact-key matches.
 *  - **Literal** — Select shows "Literal value", a text input appears next to
 *    it for the literal template string, with a × to revert. Status cell is
 *    hidden in this mode (suggestions don't apply to literals).
 *
 * Bindings: literal entries take priority over map entries when both exist for
 * the same template field. Matches resolveIntroTake / resolveOutroTake.
 */
export function FieldMappingTable({
  templateFields,
  songFields,
  value,
  literals,
  suggestions,
  onChange,
  onLiteralsChange,
  confirmedKeys,
  onConfirm,
}: FieldMappingTableProps) {
  function setMapping(templateFieldKey: string, songFieldKey: string) {
    const nextMap = { ...value };
    if (songFieldKey) nextMap[templateFieldKey] = songFieldKey;
    else delete nextMap[templateFieldKey];
    onChange(nextMap);
    // Drop any literal — picking a song field replaces literal mode.
    if (literals[templateFieldKey] !== undefined) {
      const nextLiterals = { ...literals };
      delete nextLiterals[templateFieldKey];
      onLiteralsChange(nextLiterals);
    }
    onConfirm(templateFieldKey);
  }

  function enterLiteralMode(templateFieldKey: string) {
    // Drop the map entry (literal wins anyway, but keeping things clean) and
    // seed the literal as an empty string so the input renders immediately.
    if (value[templateFieldKey] !== undefined) {
      const nextMap = { ...value };
      delete nextMap[templateFieldKey];
      onChange(nextMap);
    }
    onLiteralsChange({ ...literals, [templateFieldKey]: literals[templateFieldKey] ?? "" });
    onConfirm(templateFieldKey);
  }

  function setLiteralValue(templateFieldKey: string, next: string) {
    onLiteralsChange({ ...literals, [templateFieldKey]: next });
  }

  function exitLiteralMode(templateFieldKey: string) {
    const nextLiterals = { ...literals };
    delete nextLiterals[templateFieldKey];
    onLiteralsChange(nextLiterals);
    onConfirm(templateFieldKey);
  }

  if (templateFields.length === 0) {
    return (
      <p style={{ fontSize: 12, color: colors.textDim, fontStyle: "italic", margin: 0 }}>
        This template has no fields to map.
      </p>
    );
  }

  const literalHint =
    "Use {key} to insert song fields (e.g. {title}, {author}, {hymnNumber}). " +
    "Write {{ for a literal { character.";

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
        const literal = literals[tf.key];
        const isLiteral = literal !== undefined;
        const isConfirmed = confirmedKeys.has(tf.key);
        const showSuggestedPill =
          !isLiteral &&
          suggestion.kind === "suggested" &&
          !isConfirmed &&
          current === suggestion.songFieldKey;
        const showExactCheck =
          !isLiteral && suggestion.kind === "exact" && current === suggestion.songFieldKey;
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
              {isLiteral ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span
                    style={{
                      color: colors.textDim,
                      fontSize: 11,
                      fontStyle: "italic",
                      flexShrink: 0,
                    }}
                  >
                    Literal:
                  </span>
                  <Input
                    value={literal}
                    onChange={(e) => setLiteralValue(tf.key, e.target.value)}
                    placeholder="(empty)"
                    title={literalHint}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <IconButton
                    onClick={() => exitLiteralMode(tf.key)}
                    title="Revert to song-field mapping"
                  >
                    ×
                  </IconButton>
                </div>
              ) : (
                <Select
                  value={current}
                  onChange={(e) => {
                    if (e.target.value === LITERAL_SENTINEL) {
                      enterLiteralMode(tf.key);
                    } else {
                      setMapping(tf.key, e.target.value);
                    }
                  }}
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
                  <option value={LITERAL_SENTINEL}>— Literal value…</option>
                </Select>
              )}
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
