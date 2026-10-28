// Cloud columns and tables the apps-portal project may not have yet.
//
// OverlaySys migrations are written to docs/ and applied in apps-portal by
// hand, so a client can meet a cloud that lags behind it. A missing column
// or table is not a sync error: the caller drops it, retries once, and logs
// one `console.info` per process. See docs/cloud-slides-sync-migration.md.

import { HotkeySchema, type Hotcard, type Show } from "@overlaysys/core";

/** The optional cloud columns this client knows how to live without. */
export type OptionalColumn = "shows.extra" | "hotcards.hotkey";

function errFields(err: unknown): { code?: unknown; message?: unknown } | null {
  return typeof err === "object" && err !== null ? (err as { code?: unknown; message?: unknown }) : null;
}

/**
 * Postgres 42P01 / PostgREST PGRST205, or their messages. syncEngine.ts
 * keeps its own copy because core can't import this package.
 */
export function isMissingTableError(err: unknown): boolean {
  const e = errFields(err);
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  return typeof e.message === "string" && /relation .* does not exist|could not find the table/i.test(e.message);
}

/** Postgres 42703 / PostgREST PGRST204 whose message names `column`. */
export function isMissingColumnError(err: unknown, column: string): boolean {
  const e = errFields(err);
  if (!e || (e.code !== "42703" && e.code !== "PGRST204")) return false;
  if (typeof e.message !== "string") return false;
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word boundaries so `extra` doesn't match `extra_old`.
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(e.message);
}

/** Show fields stored in their own columns; everything else rides in `extra`. */
const SHOW_COLUMNED_KEYS = new Set(["id", "name", "projectId", "rows", "updatedAt", "deletedAt"]);

/** The show minus id, name, projectId, rows, updatedAt and deletedAt. */
export function showExtra(show: Show): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(show)) {
    if (!SHOW_COLUMNED_KEYS.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** "F1".."F12" → same; null (deliberately none) → "none"; undefined → null. */
export function hotkeyToColumn(h: Hotcard["hotkey"]): string | null {
  if (h === undefined) return null;
  return h === null ? "none" : h;
}

/** "none" → null; null → undefined (absent); anything invalid → undefined. */
export function hotkeyFromColumn(v: string | null): Hotcard["hotkey"] | undefined {
  if (v === null) return undefined;
  if (v === "none") return null;
  const parsed = HotkeySchema.safeParse(v);
  return parsed.success ? parsed.data : undefined;
}

const loggedColumns = new Set<OptionalColumn>();

export function _resetOptionalColumnsForTest(): void {
  loggedColumns.clear();
}

function columnName(col: OptionalColumn): string {
  return col.slice(col.indexOf(".") + 1);
}

/**
 * Run a query that names `col` when the cloud has it. If the cloud reports
 * the column missing, remember that in `missing` (so later calls skip it
 * up front), log once per process, and retry once without it.
 */
export async function withOptionalColumn<R extends { error: unknown }>(
  missing: Set<OptionalColumn>,
  col: OptionalColumn,
  run: (include: boolean) => PromiseLike<R>,
): Promise<R> {
  if (missing.has(col)) return run(false);
  const first = await run(true);
  if (!first.error || !isMissingColumnError(first.error, columnName(col))) return first;
  missing.add(col);
  if (!loggedColumns.has(col)) {
    loggedColumns.add(col);
    console.info(
      `[sync] cloud ${col} column unavailable; syncing without it until the apps-portal migration is applied (docs/cloud-slides-sync-migration.md)`,
    );
  }
  return run(false);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Raw input for `ShowSchema` from a cloud row: `extra` spread under the
 * columned fields. A null or absent `extra` reads as a show from before the
 * column (songs []). Returns a second, extra-free candidate to fall back on
 * if `extra` holds something the schema rejects.
 */
export function showInputsFromRow(row: {
  id: string;
  name: string;
  project_id: string;
  rows: unknown;
  extra?: unknown;
}): Record<string, unknown>[] {
  const columned = { id: row.id, name: row.name, projectId: row.project_id, rows: row.rows };
  const plain = { ...columned, songs: [] };
  if (!isPlainObject(row.extra)) return [plain];
  const extra = row.extra;
  return [{ ...extra, ...columned, songs: extra["songs"] ?? [] }, plain];
}
