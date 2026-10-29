import type { Template } from "@overlaysys/core";
import { httpBase } from "../../../lib/pcoClient";

/** Mirrors server/src/templateDrafts.ts. */
const DRAFT_PREFIX = "__draft__";

/** Draft edits re-post at most this often while previewing. */
export const DRAFT_PREVIEW_THROTTLE_MS = 300;

export function draftIdFor(sourceId: string): string {
  return `${DRAFT_PREFIX}${sourceId}`;
}

/**
 * "start" when preview is empty or already shows this template's draft;
 * otherwise the operator confirms before the draft replaces what's cued.
 */
export function draftPreviewDecision(i: {
  previewTemplateId: string | null;
  previewName: string | null;
  sourceId: string;
}): "start" | "confirm-replace" {
  if (!i.previewTemplateId || i.previewTemplateId === draftIdFor(i.sourceId)) return "start";
  return "confirm-replace";
}

/** Cue the draft on preview (the server hard-codes the channel). Throws with the server's reason. */
export async function postDraftPreview(template: Template, data: Record<string, string>): Promise<string> {
  const res = await fetch(`${httpBase()}/api/templates/draft-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template, data }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; draftId?: string; error?: string } | null;
  if (!res.ok || !body?.ok || !body.draftId) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.draftId;
}

/** Take the draft off preview (only if it is still what preview shows) and forget it. Never throws. */
export function stopDraftPreview(sourceId: string): void {
  // keepalive: also runs from unmount / pagehide, where the page may be going away.
  void fetch(`${httpBase()}/api/templates/draft-preview/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});
}
