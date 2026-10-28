"use client";

import Papa from "papaparse";
import { v4 as uuid } from "uuid";
import type { Field, GraphicRow, TemplateMeta } from "@overlaysys/core";

/**
 * CSV → graphic rundown rows.
 *
 * Convention:
 *   - A `template` column names the template for that row — by id, or by
 *     template name (case-insensitive).
 *   - Every other column maps to a template field: by field key, else by
 *     field label (case-insensitive) when the template's fields are known,
 *     else the header is used as the key verbatim.
 *   - An optional `notes` column is preserved.
 *
 * CSV import only produces `graphic` rows; song rows are authored in the
 * show editor against a song library.
 */

export interface CsvSkippedRow {
  /** 1-based data row number (the header is row 0), as a spreadsheet user sees it minus one. */
  line: number;
  reason: string;
}

export interface CsvImportPreview {
  rows: GraphicRow[];
  skipped: CsvSkippedRow[];
  /** Per template id: CSV columns that matched none of its fields (kept as raw keys). */
  unmatchedColumns: Record<string, string[]>;
}

const RESERVED = new Set(["template", "notes"]);

function headerKey(h: string): string {
  return h.trim().toLowerCase();
}

/** Resolve a `template` cell to a template id: exact id, else case-insensitive id or name. */
export function resolveTemplate(cell: string, templates: readonly TemplateMeta[]): TemplateMeta | null {
  const v = cell.trim();
  if (!v) return null;
  const exact = templates.find((t) => t.id === v);
  if (exact) return exact;
  const lower = v.toLowerCase();
  return (
    templates.find((t) => t.id.toLowerCase() === lower) ??
    templates.find((t) => t.name.trim().toLowerCase() === lower) ??
    null
  );
}

/**
 * Pure conversion of parsed CSV records into rows. `fieldsFor` returns the
 * template's fields when known (enables label matching), else undefined.
 */
export function recordsToRows(
  records: readonly Record<string, unknown>[],
  templates: readonly TemplateMeta[],
  fieldsFor: (templateId: string) => readonly Field[] | undefined = () => undefined,
  makeId: () => string = uuid,
): CsvImportPreview {
  const rows: GraphicRow[] = [];
  const skipped: CsvSkippedRow[] = [];
  const unmatched: Record<string, Set<string>> = {};

  records.forEach((rec, i) => {
    const line = i + 1;
    if (!rec || typeof rec !== "object") {
      skipped.push({ line, reason: "unreadable row" });
      return;
    }
    const entries = Object.entries(rec).map(([k, v]) => [k, v == null ? "" : String(v)] as const);
    const templateCell = entries.find(([k]) => headerKey(k) === "template")?.[1] ?? "";
    if (!templateCell.trim()) {
      skipped.push({ line, reason: "no template" });
      return;
    }
    const tpl = resolveTemplate(templateCell, templates);
    if (!tpl) {
      skipped.push({ line, reason: `unknown template "${templateCell.trim()}"` });
      return;
    }
    const fields = fieldsFor(tpl.id);
    const data: Record<string, string> = {};
    let notes: string | undefined;
    for (const [k, v] of entries) {
      const hk = headerKey(k);
      if (hk === "template") continue;
      if (hk === "notes") {
        if (v.trim()) notes = v;
        continue;
      }
      if (RESERVED.has(hk) || v === "") continue;
      let key = k.trim();
      if (fields) {
        const f =
          fields.find((x) => x.key === key) ??
          fields.find((x) => x.key.toLowerCase() === hk) ??
          fields.find((x) => x.label.trim().toLowerCase() === hk);
        if (f) key = f.key;
        else (unmatched[tpl.id] ??= new Set()).add(k.trim());
      }
      data[key] = v;
    }
    rows.push({ kind: "graphic", id: makeId(), templateId: tpl.id, data, ...(notes ? { notes } : {}) });
  });

  const unmatchedColumns: Record<string, string[]> = {};
  for (const [id, set] of Object.entries(unmatched)) unmatchedColumns[id] = [...set];
  return { rows, skipped, unmatchedColumns };
}

/** Parse CSV text into header-keyed records. */
export function parseCsvText(text: string): { records: Record<string, string>[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return {
    records: result.data,
    errors: result.errors.map((e) => (e.row !== undefined ? `row ${e.row + 1}: ${e.message}` : e.message)),
  };
}

/** Back-compat: parse a file with the id-only template convention. */
export async function csvToRows(file: File): Promise<GraphicRow[]> {
  const { records } = parseCsvText(await file.text());
  const ids = new Set<string>();
  for (const r of records) {
    const t = (r["template"] ?? "").trim();
    if (t) ids.add(t);
  }
  const metas = [...ids].map((id) => ({ id, name: id }) as TemplateMeta);
  return recordsToRows(records, metas).rows;
}
