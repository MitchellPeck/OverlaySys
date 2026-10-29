import type { Deck, DeckLicensing, DeckMeta, TemplateMeta } from "@overlaysys/core";
import type { Column, FilterSpec, MenuItem, SortSpec } from "@overlaysys/ui";
import { formatRelative } from "../../lib/listFormat";
import { templatesFor } from "../../lib/templateRoles";

export const DECK_LIST_STORAGE_KEY = "slides";
export const DEFAULT_DECK_SORT = "name-asc";

export const licensingLabel: Record<DeckMeta["licensing"], string> = {
  ccli: "CCLI",
  "public-domain": "Public domain",
  own: "Own",
};

const edited = (d: DeckMeta) => d.updatedAt ?? d.createdAt;

export const deckSorts: SortSpec<DeckMeta>[] = [
  { id: "name-asc", label: "Name", compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) },
  { id: "edited-desc", label: "Recently edited", compare: (a, b) => edited(b).localeCompare(edited(a)) },
  { id: "added-desc", label: "Recently added", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
];

/** Licensing filter, plus a tag filter when any deck has tags. Labels read as "All <label>". */
export function deckFilters(decks: DeckMeta[]): FilterSpec<DeckMeta>[] {
  const out: FilterSpec<DeckMeta>[] = [
    {
      id: "licensing",
      label: "licences",
      options: (["ccli", "public-domain", "own"] as const).map((k) => ({ value: k, label: licensingLabel[k] })),
      test: (d, v) => d.licensing === v,
    },
  ];
  const tags = [...new Set(decks.flatMap((d) => d.tags))].sort((x, y) => x.localeCompare(y));
  if (tags.length > 0) {
    out.push({
      id: "tag",
      label: "tags",
      options: tags.map((t) => ({ value: t, label: t })),
      test: (d, v) => d.tags.includes(v),
    });
  }
  return out;
}

export const deckColumns: Column<DeckMeta>[] = [
  { id: "slides", label: "Slides", width: "64px", align: "right", render: (d) => d.slideCount },
  { id: "licensing", label: "Licensing", width: "110px", render: (d) => licensingLabel[d.licensing] },
  { id: "tags", label: "Tags", width: "180px", render: (d) => d.tags.join(", ") },
  { id: "edited", label: "Edited", width: "120px", render: (d) => formatRelative(edited(d), new Date()) },
];

export type DeckActions = {
  open(d: DeckMeta): void;
  duplicate(d: DeckMeta): void;
  rename(d: DeckMeta): void;
  delete(d: DeckMeta): void;
};

/** `offlineReason` disables the actions that need the server (shown as the tooltip). */
export function deckMenuItems(meta: DeckMeta, actions: DeckActions, offlineReason?: string): MenuItem[] {
  const off = offlineReason ? { disabled: offlineReason } : {};
  return [
    { id: "open", label: "Open", onSelect: () => actions.open(meta) },
    { id: "duplicate", label: "Duplicate", ...off, onSelect: () => actions.duplicate(meta) },
    { id: "rename", label: "Rename…", ...off, onSelect: () => actions.rename(meta) },
    { separator: true },
    { id: "delete", label: "Delete…", danger: true, ...off, onSelect: () => actions.delete(meta) },
  ];
}

/** Confirm copy when the deck is used in shows; null = delete straight away (Undo is in the toast). */
export function deckDeleteConfirm(
  meta: DeckMeta,
): { title: string; message: string; confirmLabel: string; danger: true } | null {
  if (meta.usedBy <= 0) return null;
  return {
    title: "Delete deck?",
    message: `"${meta.name}" is used in ${meta.usedBy} show(s). Those rows will show "Missing deck" until you restore it.`,
    confirmLabel: "Delete",
    danger: true,
  };
}

/** Why Create is disabled, or null when the dialog can create. Licensing has no default (Q8). */
export function newDeckBlocker(name: string, licensing: DeckLicensing | null): string | null {
  if (!name.trim()) return "Name the deck";
  if (!licensing) return "Choose the licensing";
  return null;
}

/** First suggested lyric template, else the first template by name. */
export function defaultDeckTemplateId(metas: Pick<TemplateMeta, "id" | "name" | "role">[]): string | undefined {
  const { suggested, others } = templatesFor(metas, "lyric");
  return (suggested[0] ?? others[0])?.id;
}

export function buildNewDeck(i: {
  name: string;
  licensing: DeckLicensing;
  templateId: string;
  deckId: string;
  slideId: string;
  now: string;
}): Deck {
  let licensing: DeckLicensing = i.licensing;
  if (licensing.kind === "ccli") {
    const n = licensing.ccliNumber?.trim();
    licensing = n ? { kind: "ccli", ccliNumber: n } : { kind: "ccli" };
  }
  return {
    id: i.deckId,
    name: i.name.trim(),
    tags: [],
    defaultTemplateId: i.templateId,
    licensing,
    slides: [{ id: i.slideId, data: {} }],
    createdAt: i.now,
  };
}
