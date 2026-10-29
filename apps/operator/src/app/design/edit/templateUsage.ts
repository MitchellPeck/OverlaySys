import { httpBase } from "../../../lib/pcoClient";

/** Mirrors server/src/templateUsage.ts (GET /api/templates/:id/usage). */
export type TemplateUsage = {
  shows: { id: string; name: string }[];
  hotcards: { id: string; name: string }[];
  songs: { id: string; title: string }[];
  decks?: { id: string; name: string }[];
  scriptureDefault: boolean;
  protected: boolean;
};

/** Null in cloud mode (no local server), when the route is missing, or on any failure. */
export async function fetchTemplateUsage(id: string): Promise<TemplateUsage | null> {
  try {
    const res = await fetch(`${httpBase()}/api/templates/${encodeURIComponent(id)}/usage`);
    if (!res.ok) return null;
    return (await res.json()) as TemplateUsage;
  } catch {
    return null;
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "A, B, C and 1 more": the first 3 names, then a count. */
function nameList(names: string[]): string {
  const head = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${head} and ${names.length - 3} more` : head;
}

/** Ids the server refuses to delete (shared core list), so a failed usage fetch can't unlock them. */
export { PROTECTED_TEMPLATE_IDS } from "@overlaysys/core";

export function templateDeleteConfirm(
  name: string,
  u: TemplateUsage | null,
): { blocked: boolean; title: string; message: string; confirmLabel: string } {
  if (u?.protected) {
    return {
      blocked: true,
      title: `Can't delete "${name}"`,
      message: "This is the built-in lyric template. Duplicate it to make your own version.",
      confirmLabel: "OK",
    };
  }
  const tail = "This can't be undone.";
  const parts: string[] = [];
  if (u) {
    if (u.shows.length) parts.push(`${plural(u.shows.length, "show")} (${nameList(u.shows.map((s) => s.name))})`);
    if (u.hotcards.length) parts.push(plural(u.hotcards.length, "hotcard"));
    if (u.songs.length) parts.push(plural(u.songs.length, "song default"));
    if (u.decks?.length) parts.push(`${plural(u.decks.length, "deck")} (${nameList(u.decks.map((d) => d.name))})`);
    if (u.scriptureDefault) parts.push("the scripture defaults");
  }
  if (parts.length === 0) return { blocked: false, title: `Delete "${name}"?`, message: tail, confirmLabel: "Delete" };
  const used = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]!;
  return {
    blocked: false,
    title: `Delete "${name}"?`,
    message: `Used in ${used}. Those items will show "missing template". ${tail}`,
    confirmLabel: "Delete",
  };
}
