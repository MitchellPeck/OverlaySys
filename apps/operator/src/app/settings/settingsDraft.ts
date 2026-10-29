import { deepEqual } from "../../lib/diffEntity";

export type DraftState<T> = { saved: T | null; draft: T | null; saving: boolean; error: string | null; changedElsewhere?: boolean };

export type DraftAction<T> =
  | { type: "loaded"; value: T }
  | { type: "edit"; value: T }
  | { type: "update"; fn: (p: T) => T }
  | { type: "saveStart" }
  | { type: "saveOk"; value: T }
  | { type: "saveFail"; error: string }
  | { type: "revert" };

export function draftReducer<T>(s: DraftState<T>, a: DraftAction<T>): DraftState<T> {
  switch (a.type) {
    case "loaded": {
      // Dirty draft: take the new baseline but keep the operator's edits.
      if (s.saved !== null && s.draft !== null && !deepEqual(s.saved, s.draft)) {
        return { ...s, saved: a.value, changedElsewhere: !deepEqual(a.value, s.draft) };
      }
      return { saved: a.value, draft: a.value, saving: false, error: null };
    }
    case "edit":
      return { ...s, draft: a.value };
    case "update":
      return s.draft === null ? s : { ...s, draft: a.fn(s.draft) };
    case "saveStart":
      return { ...s, saving: true, error: null };
    case "saveOk":
      return { saved: a.value, draft: a.value, saving: false, error: null };
    case "saveFail":
      return { ...s, saving: false, error: a.error };
    case "revert":
      return { ...s, draft: s.saved, error: null };
  }
}

export function isDirty<T>(s: DraftState<T>, equal: (a: T, b: T) => boolean = deepEqual): boolean {
  if (s.saved === null || s.draft === null) return false;
  return !equal(s.saved, s.draft);
}

export function saveBarProps<T>(
  s: DraftState<T>,
  o: { connected: boolean; equal?: (a: T, b: T) => boolean; invalidReason?: string | null },
): { dirty: boolean; saving: boolean; disabledReason?: string } {
  const dirty = isDirty(s, o.equal);
  const disabledReason = !o.connected ? "Reconnect to save" : o.invalidReason || undefined;
  return { dirty, saving: s.saving, ...(disabledReason ? { disabledReason } : {}) };
}
