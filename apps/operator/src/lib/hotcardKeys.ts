import { hotkeyConflicts, type HotcardMeta, type Hotkey } from "@overlaysys/core";

/**
 * For the hotcard editor's F-key select: which other card in the project
 * holds each key, by name. The card being edited is left out, so its own key
 * doesn't show as taken.
 */
export function hotkeyOwners(
  metas: readonly HotcardMeta[],
  projectId: string,
  selfId: string,
): Partial<Record<Hotkey, string[]>> {
  const out: Partial<Record<Hotkey, string[]>> = {};
  for (const m of metas) {
    if (m.id === selfId || m.projectId !== projectId || !m.hotkey) continue;
    (out[m.hotkey] ??= []).push(m.name || m.id);
  }
  return out;
}

/**
 * The warning for a draft whose key another card in its project already
 * uses, or null. Computed from the saved list with the draft swapped in, so
 * it reflects the unsaved choice.
 */
export function hotkeyConflictWarning(
  metas: readonly HotcardMeta[],
  draft: Pick<HotcardMeta, "id" | "name" | "projectId" | "hotkey">,
): string | null {
  if (!draft.hotkey) return null;
  const others = metas.filter((m) => m.id !== draft.id);
  const conflicts = hotkeyConflicts([...others, { ...draft, templateId: "" }], draft.projectId);
  const ids = conflicts[draft.hotkey];
  if (!ids) return null;
  const names = others.filter((m) => ids.includes(m.id)).map((m) => `"${m.name || m.id}"`);
  return `${draft.hotkey} is also assigned to ${names.join(", ")} in this project. Only one of them fires; pick another key or clear the other card's.`;
}
