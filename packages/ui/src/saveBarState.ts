export type SaveBarStatus = "unsaved" | "saving" | "saved" | "clean";

export type SaveBarInput = {
  dirty: boolean;
  saving: boolean;
  disabledReason?: string;
  justSaved: boolean;
};

export type SaveBarState = {
  status: SaveBarStatus;
  statusText: string;
  saveEnabled: boolean;
  revertEnabled: boolean;
  saveTitle: string;
};

export function saveBarState(i: SaveBarInput): SaveBarState {
  const status: SaveBarStatus = i.saving ? "saving" : i.dirty ? "unsaved" : i.justSaved ? "saved" : "clean";
  const statusText = { unsaved: "Unsaved changes", saving: "Saving…", saved: "Saved", clean: "" }[status];
  const saveEnabled = i.dirty && !i.saving && !i.disabledReason;
  const revertEnabled = i.dirty && !i.saving;
  const saveTitle = i.disabledReason ? i.disabledReason : !i.dirty ? "No changes to save" : "Save (⌘S)";
  return { status, statusText, saveEnabled, revertEnabled, saveTitle };
}
