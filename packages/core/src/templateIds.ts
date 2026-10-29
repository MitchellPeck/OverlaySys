// Template ids with special meaning, shared by the server, the operator and
// the cloud data layer so the rules can't drift.

/** The built-in lyric design: every song relies on it, and slides fall back to it. */
export const FALLBACK_TEMPLATE_ID = "lyric-default";

/** Built-in templates that can't be deleted (locally or in the cloud). */
export const PROTECTED_TEMPLATE_IDS: readonly string[] = [FALLBACK_TEMPLATE_ID];

export function isProtectedTemplateId(id: string): boolean {
  return PROTECTED_TEMPLATE_IDS.includes(id);
}

/**
 * Prefix of unsaved designer drafts cued on preview ("Preview on PVW"). A draft
 * id is never saved, listed or synced; the server refuses to save one.
 */
export const DRAFT_TEMPLATE_PREFIX = "__draft__";

export function isDraftTemplateId(id: string): boolean {
  return id.startsWith(DRAFT_TEMPLATE_PREFIX);
}
