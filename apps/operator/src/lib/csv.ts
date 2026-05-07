"use client";

import Papa from "papaparse";
import { v4 as uuid } from "uuid";
import type { GraphicRow } from "@overlaysys/core";

/**
 * Parse a CSV file into graphic rundown rows.
 *
 * Convention:
 *   - The first column header is `template` (the templateId for that row).
 *   - Every other column header maps directly to a template fieldKey.
 *   - An optional `notes` column is preserved.
 *
 * CSV import only produces `graphic` rows; song rows are authored in the
 * show editor against a song library.
 */
export async function csvToRows(file: File): Promise<GraphicRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows: GraphicRow[] = [];
        for (const rec of result.data) {
          if (!rec || typeof rec !== "object") continue;
          const templateId = (rec["template"] ?? "").trim();
          if (!templateId) continue;
          const data: Record<string, string> = {};
          let notes: string | undefined;
          for (const [k, v] of Object.entries(rec)) {
            if (k === "template") continue;
            if (k === "notes") {
              notes = v;
              continue;
            }
            if (v != null && v !== "") data[k] = String(v);
          }
          rows.push({
            kind: "graphic",
            id: uuid(),
            templateId,
            data,
            ...(notes ? { notes } : {}),
          });
        }
        resolve(rows);
      },
      error: reject,
    });
  });
}
