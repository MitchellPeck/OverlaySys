// Turns an Electron open-dialog result into the chosen folder. Kept free of
// Electron imports so it can be unit-tested.

/** The first chosen path, or null when the dialog was canceled or empty. */
export function folderFromDialogResult(r: {
  canceled: boolean;
  filePaths: string[];
}): string | null {
  if (r.canceled) return null;
  return r.filePaths[0] ?? null;
}
