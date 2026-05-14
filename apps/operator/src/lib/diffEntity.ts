/**
 * Shallow per-top-level-field diff between two entity payloads.
 *
 * Used by the Pull-from-Cloud review modal to surface what would
 * actually change for entities whose ids already exist locally. Goes
 * one level deep so the user can see "this template's `layers` would
 * change" without overwhelming them with nested layer-shape diffs.
 *
 * `deepEqual` is a hand-rolled minimal recursive equality check —
 * lodash.isequal would do the same but we don't otherwise need lodash.
 */

export interface FieldDiff {
  key: string;
  beforeSummary: string;
  afterSummary: string;
}

export function diffEntity(local: unknown, cloud: unknown): FieldDiff[] {
  if (typeof local !== "object" || local === null) return [];
  if (typeof cloud !== "object" || cloud === null) return [];
  const a = local as Record<string, unknown>;
  const b = cloud as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs: FieldDiff[] = [];
  for (const k of keys) {
    if (!deepEqual(a[k], b[k])) {
      diffs.push({
        key: k,
        beforeSummary: summarize(a[k]),
        afterSummary: summarize(b[k]),
      });
    }
  }
  return diffs;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Short string representation of a value for the diff row display.
 * Strings are quoted and truncated; arrays show a count; nested objects
 * show a key count. Primitives stringify directly. Designed to be one
 * line and ~60 chars max so it fits in the modal layout without scroll.
 */
function summarize(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.length > 60 ? `"${value.slice(0, 57)}…"` : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `{${keys.length} key${keys.length === 1 ? "" : "s"}}`;
  }
  return String(value);
}
