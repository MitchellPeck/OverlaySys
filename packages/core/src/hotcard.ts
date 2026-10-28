import { z } from "zod";
import { DEFAULT_PROJECT_ID } from "./project";

/**
 * A Hotcard is a saved graphic take that lives outside any show — titles,
 * lower-thirds, transition cards, anything you want to keep at hand across
 * services. Triggering one fires the templateId + data on a channel just
 * like a graphic rundown row, but hotcards are not part of any rundown.
 *
 * Hotcards belong to a Project. Legacy hotcards predating the Project concept
 * are read with `projectId` backfilled to the default project.
 */
export const HOTKEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"] as const;
export const HotkeySchema = z.enum(HOTKEYS);
export type Hotkey = z.infer<typeof HotkeySchema>;

export const HotcardSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("projectId" in (raw as Record<string, unknown>))
    ) {
      return { projectId: DEFAULT_PROJECT_ID, ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.object({
    id: z.string(),
    name: z.string(),
    projectId: z.string(),
    templateId: z.string(),
    data: z.record(z.string(), z.string()),
    channelHint: z.string().optional(),
    /**
     * The F-key that fires this card on Live, scoped to its project. `null`
     * means "deliberately no key"; absent means the card predates hotkeys
     * (the server's one-time migration assigns those, see
     * `initialHotkeyAssignments`). F-keys never come from list position.
     */
    hotkey: HotkeySchema.nullable().optional(),
    notes: z.string().optional(),
    /**
     * ISO timestamp of the last write. Set by writers (server, cloud helper)
     * on every save; consumed by the sync engine for last-writer-wins. Optional
     * for backwards compatibility with pre-sync JSON; new writes always set it.
     */
    updatedAt: z.string().optional(),
    /**
     * Soft-delete tombstone. When set, the hotcard is hidden from UIs but the
     * record persists so the deletion can propagate via sync before a future
     * GC pass hard-deletes it.
     */
    deletedAt: z.string().optional(),
  }),
);
export type Hotcard = z.infer<typeof HotcardSchema>;

export type HotcardMeta = Pick<Hotcard, "id" | "name" | "templateId" | "projectId" | "hotkey">;

type Keyed = Pick<HotcardMeta, "id" | "projectId" | "hotkey">;

/**
 * The card in `projectId` whose hotkey is `code` (a KeyboardEvent.code such
 * as "F4"), or null. Never derived from list position, so list order,
 * restarts and other projects' cards can't change what a key fires. If two
 * cards share a key (a conflict the editor warns about), the lowest id wins
 * so the choice is still stable.
 */
export function hotcardForKey<T extends Keyed>(metas: readonly T[], code: string, projectId: string): T | null {
  let best: T | null = null;
  for (const m of metas) {
    if (m.projectId !== projectId || !m.hotkey || m.hotkey !== code) continue;
    if (!best || m.id < best.id) best = m;
  }
  return best;
}

/** Hotkeys used by more than one card in `projectId`, with those cards' ids. */
export function hotkeyConflicts<T extends Keyed>(metas: readonly T[], projectId: string): Partial<Record<Hotkey, string[]>> {
  const byKey: Partial<Record<Hotkey, string[]>> = {};
  for (const m of metas) {
    if (m.projectId !== projectId || !m.hotkey) continue;
    (byKey[m.hotkey] ??= []).push(m.id);
  }
  const out: Partial<Record<Hotkey, string[]>> = {};
  for (const k of HOTKEYS) {
    const ids = byKey[k];
    if (ids && ids.length > 1) out[k] = ids;
  }
  return out;
}

/**
 * One-time migration from position-based F-keys (Default D6a). For each
 * project where no card has a `hotkey` field yet, the first twelve cards in
 * the given order (the order the hotcard list showed them) get F1–F12 and the
 * rest get `null`, so every card in the project is then decided. Projects
 * with any card already decided are left alone, which makes this idempotent
 * and means clearing every key by hand isn't undone on restart.
 * Returns the hotkey to write for each card that needs one.
 */
export function initialHotkeyAssignments<T extends Keyed>(cards: readonly T[]): Map<string, Hotkey | null> {
  const byProject = new Map<string, T[]>();
  for (const c of cards) {
    const list = byProject.get(c.projectId);
    if (list) list.push(c);
    else byProject.set(c.projectId, [c]);
  }
  const out = new Map<string, Hotkey | null>();
  for (const list of byProject.values()) {
    if (list.some((c) => c.hotkey !== undefined)) continue;
    list.forEach((c, i) => out.set(c.id, HOTKEYS[i] ?? null));
  }
  return out;
}

/**
 * Which channel a hotcard fires on (Default D7a). The card's hint is the
 * default output for Take only; Cue always goes to Preview, so a card can
 * never reach air from Cue/Shift+F. A hint of Program or Preview (from
 * before this rule) or none means Take goes to Program.
 */
export function hotcardRoute(hint: string | undefined, action: "cue" | "take"): string {
  if (action === "cue") return "preview";
  if (!hint || hint === "preview" || hint === "program") return "program";
  return hint;
}
