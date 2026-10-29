/** Pure helpers for the designer's inline template-name field. */

/** The name to commit for the typed text, or null (unchanged or blank: a template is never nameless). */
export function nameToCommit(text: string, name: string): string | null {
  const next = text.trim();
  return next && next !== name ? next : null;
}

type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** ⌘S / Ctrl+S, the same chord SaveBar listens for. */
export function isSaveShortcut(e: KeyLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s";
}
