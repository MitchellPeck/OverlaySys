import type { GraphicRow, Show } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

type Row = Show["rows"][number];

/** Session-only field edits: rowId → fieldKey → value. Never saved to the show. */
export type RowDataOverrides = Record<string, Record<string, string>>;

/** The data a graphic row would go to air with: its saved data plus this session's edits. */
export function effectiveRowData(row: GraphicRow, overrides: RowDataOverrides): Record<string, string> {
  return { ...row.data, ...overrides[row.id] };
}

/** Keys whose session edit differs from the row's saved value. */
export function editedFieldKeys(row: GraphicRow, overrides: RowDataOverrides): string[] {
  const o = overrides[row.id];
  if (!o) return [];
  return Object.keys(o).filter((k) => o[k] !== row.data[k]);
}

/** A graphic row with its effective data; other rows unchanged. Use wherever a whole row is passed along. */
export function withEffectiveData<R extends Row>(row: R, overrides: RowDataOverrides): R {
  if (row.kind !== "graphic") return row;
  return { ...row, data: effectiveRowData(row, overrides) };
}

/**
 * The cue/take message for a graphic row, with effective data. With a show
 * id it carries the rundown source so stage monitors know the live row.
 */
export function graphicRowMessage(
  row: GraphicRow,
  type: "cue" | "take",
  overrides: RowDataOverrides,
  showId?: string,
): ClientMessage {
  return {
    type,
    channel: row.channelHint ?? (type === "cue" ? "preview" : "program"),
    templateId: row.templateId,
    data: effectiveRowData(row, overrides),
    ...(showId ? { source: { showId, rowId: row.id } } : {}),
  };
}

/** Up to n rows after the selected one; empty with no show, no or missing selection, or the last row selected. */
export function upNextRows(show: Show | null, selectedRowId: string | null, n = 3): Show["rows"] {
  if (!show || !selectedRowId) return [];
  const idx = show.rows.findIndex((r) => r.id === selectedRowId);
  if (idx < 0) return [];
  return show.rows.slice(idx + 1, idx + 1 + n);
}
