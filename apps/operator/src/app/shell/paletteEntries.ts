import type { HotcardMeta, SongMeta, StageLayoutMeta, TemplateMeta } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { ShowMeta } from "@/lib/store";
import type { PaletteCommand } from "@/lib/liveCommands";
import { fuzzyScorePrepared, prepareText, type PreparedText } from "./fuzzyMatch";

export const PALETTE_GROUPS = ["Go to", "Shows", "Songs", "Designs", "Hotcards", "On air", "App"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteEntry = {
  id: string;
  label: string;
  group: PaletteGroup;
  keywords?: string[];
  href?: string;
  run?(): void;
  /** Asked through `useConfirm` before `run`; set on every On air entry (D17c). */
  confirm?: { title: string; message: string; confirmLabel: string; danger?: boolean };
};

/** A whole query that also searches as these words. */
export const SYNONYMS: Record<string, string[]> = {
  stt: ["speech-to-text"],
  pvw: ["preview"],
  pgm: ["program"],
  lyrics: ["songs"],
  graphics: ["designs", "templates"],
};

export type PaletteDestination = { label: string; href: string; keywords?: string[] };

export type PaletteInputs = {
  destinations: PaletteDestination[];
  shows: ShowMeta[];
  songs: SongMeta[];
  templates: TemplateMeta[];
  stageLayouts: StageLayoutMeta[];
  hotcards: HotcardMeta[];
  projectId: string;
  cloud: boolean;
  extras: PaletteEntry[];
};

const q = (id: string) => encodeURIComponent(id);

/**
 * Everything the palette can find: destinations, the current project's shows
 * and hotcards, songs, designs (graphics templates and stage layouts), and the
 * caller's extras (area jumps, app actions, Live's on-air verbs). On air
 * entries are dropped in cloud mode whatever the caller passes.
 */
export function buildPaletteEntries(i: PaletteInputs): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const d of i.destinations) {
    out.push({ id: `go:${d.href}`, label: d.label, group: "Go to", href: d.href, ...(d.keywords ? { keywords: d.keywords } : {}) });
  }
  for (const s of i.shows) {
    if (s.projectId !== i.projectId) continue;
    out.push({ id: `show:${s.id}`, label: s.name, group: "Shows", href: `/shows/edit?id=${q(s.id)}` });
  }
  for (const s of i.songs) {
    const keywords = [s.author, s.ccliNumber].filter((k): k is string => !!k);
    out.push({ id: `song:${s.id}`, label: s.title, group: "Songs", href: `/songs/edit?id=${q(s.id)}`, ...(keywords.length ? { keywords } : {}) });
  }
  for (const t of i.templates) {
    out.push({ id: `template:${t.id}`, label: t.name, group: "Designs", keywords: ["graphic", "template"], href: `/design/edit?id=${q(t.id)}` });
  }
  for (const l of i.stageLayouts) {
    out.push({ id: `stage-layout:${l.id}`, label: l.name, group: "Designs", keywords: ["stage layout"], href: `/design/stage/edit?id=${q(l.id)}` });
  }
  for (const h of i.hotcards) {
    if (h.projectId !== i.projectId) continue;
    out.push({ id: `hotcard:${h.id}`, label: h.name, group: "Hotcards", href: `/hotcards/edit?id=${q(h.id)}` });
  }
  for (const x of i.extras) {
    if (i.cloud && x.group === "On air") continue;
    out.push(x);
  }
  return out;
}

/**
 * A Live verb (contracts §10) as a palette entry. `run` reads
 * `cmd.messages()` only when called, i.e. after the confirm, so the send
 * reflects the outputs at that moment.
 */
export function toPaletteEntry(
  cmd: PaletteCommand,
  send: (m: ClientMessage) => void,
  /** Called when, at send time, the verb has nothing to send (e.g. preview emptied meanwhile). */
  onEmpty?: (cmd: PaletteCommand) => void,
): PaletteEntry {
  return {
    id: cmd.id,
    label: cmd.label,
    group: "On air",
    keywords: cmd.keywords,
    confirm: cmd.confirm,
    run: () => {
      const msgs = cmd.messages();
      if (msgs.length === 0) onEmpty?.(cmd);
      msgs.forEach(send);
    },
  };
}

/**
 * What choosing an entry does: a link navigates; anything else asks its
 * confirm first (when it has one) and only then runs. A cancelled confirm
 * runs nothing, so an on-air verb neither reads nor sends its messages.
 */
export async function runPaletteEntry(
  entry: PaletteEntry,
  io: { confirm(c: NonNullable<PaletteEntry["confirm"]>): Promise<boolean>; navigate(href: string): void },
): Promise<"navigated" | "cancelled" | "ran"> {
  if (entry.href) {
    io.navigate(entry.href);
    return "navigated";
  }
  if (entry.confirm && !(await io.confirm(entry.confirm))) return "cancelled";
  entry.run?.();
  return "ran";
}

// Lowercased text + initials per entry, computed once per entry object (not per keystroke).
const prepared = new WeakMap<PaletteEntry, PreparedText[]>();
function textsOf(e: PaletteEntry): PreparedText[] {
  let t = prepared.get(e);
  if (!t) {
    t = [e.label, ...(e.keywords ?? [])].map(prepareText);
    prepared.set(e, t);
  }
  return t;
}

/** Best score of the query (and its synonyms) against the label and keywords. */
function scoreEntry(queries: string[], e: PaletteEntry): number {
  let best = 0;
  for (const qq of queries) for (const t of textsOf(e)) best = Math.max(best, fuzzyScorePrepared(qq, t));
  return best;
}

/** Library groups list by name; Go to, App and On air keep the order they were given (nav order). */
const SORTED_BY_LABEL: ReadonlySet<PaletteGroup> = new Set<PaletteGroup>(["Shows", "Songs", "Designs", "Hotcards"]);

/**
 * Matching entries: score desc, then group order, then label within library
 * groups (others keep their given order). At most `limit` results.
 */
export function rankEntries(query: string, entries: PaletteEntry[], limit = Infinity): PaletteEntry[] {
  const groupIdx = (g: PaletteGroup) => PALETTE_GROUPS.indexOf(g);
  const key = query.trim().toLowerCase();
  const queries = [key, ...(SYNONYMS[key] ?? [])];
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(queries, e) }))
    .filter((x) => x.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s ||
        groupIdx(a.e.group) - groupIdx(b.e.group) ||
        (SORTED_BY_LABEL.has(a.e.group) ? a.e.label.localeCompare(b.e.label) : 0) ||
        a.i - b.i,
    )
    .slice(0, limit)
    .map((x) => x.e);
}
