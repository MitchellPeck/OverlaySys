import { DRAFT_TEMPLATE_PREFIX, isDraftTemplateId, type Template } from "@overlaysys/core";

/**
 * Unsaved designer drafts shown on PVW ("Preview on PVW", P2b.11). In memory
 * only: never saved, never listed, never synced. channels.ts refuses a draft
 * id on any channel but "preview", so a draft can never reach program.
 */
export const DRAFT_PREFIX = DRAFT_TEMPLATE_PREFIX;
export { isDraftTemplateId };
const MAX_DRAFTS = 10;

// Insertion order = age; a re-set moves the draft to the newest slot.
const drafts = new Map<string, Template>();

export function draftTemplateId(id: string): string {
  return isDraftTemplateId(id) ? id : `${DRAFT_PREFIX}${id}`;
}

export function setDraftTemplate(t: Template): Template {
  const draft: Template = { ...t, id: draftTemplateId(t.id) };
  drafts.delete(draft.id);
  drafts.set(draft.id, draft);
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
  return draft;
}

export function getDraftTemplate(id: string): Template | null {
  return drafts.get(id) ?? null;
}

export function dropDraftTemplate(sourceId: string): void {
  drafts.delete(draftTemplateId(sourceId));
}
