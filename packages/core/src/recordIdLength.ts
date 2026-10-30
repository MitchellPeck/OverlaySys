/**
 * Longest record id the server accepts. Ids become filenames
 * (`<dir>/<id>.json`); the cap matches STAGE_LAYOUT_ID_PATTERN and keeps far
 * below filesystem name limits, so an over-long id is a clean 400 instead of
 * an ENAMETOOLONG.
 */
export const RECORD_ID_MAX_LENGTH = 64;

/**
 * `base` + `suffix` (e.g. "-2"), with `base` cut so the whole id fits
 * RECORD_ID_MAX_LENGTH. A dash left dangling at the cut is dropped.
 */
export function fitRecordId(base: string, suffix = ""): string {
  const room = RECORD_ID_MAX_LENGTH - suffix.length;
  const cut = base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
  return cut + suffix;
}
