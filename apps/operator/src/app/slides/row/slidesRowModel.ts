import type { Deck, DeckMeta, DeckSlide, SlidesRowFields } from "@overlaysys/core";
import { rowSlideIds } from "@overlaysys/core";

/** Pure helpers behind DeckPicker and SlidesRowInspector (P3.16). */

/** Decks matching `query` (name or tag), most recently edited first, then by name. */
export function deckPickerList(decks: DeckMeta[], query: string): DeckMeta[] {
  const q = query.trim().toLowerCase();
  const hit = (d: DeckMeta) => !q || [d.name, ...d.tags].some((s) => s.toLowerCase().includes(q));
  const edited = (d: DeckMeta) => d.updatedAt ?? d.createdAt;
  return decks
    .filter(hit)
    .sort((a, b) => (edited(a) < edited(b) ? 1 : edited(a) > edited(b) ? -1 : a.name.localeCompare(b.name)));
}

/** "n of m slides" for the inspector's deck line. */
export function slideCountText(n: number, m: number): string {
  return `${n} of ${m} slide${m === 1 ? "" : "s"}`;
}

export type SlideListEntry =
  /** In this week's list at `position`; `slide` null = no longer in the deck. */
  | { kind: "in"; position: number; slideId: string; slide: DeckSlide | null; repeat: boolean }
  /** A deck slide left out this week. */
  | { kind: "out"; slideId: string; slide: DeckSlide };

/**
 * The inspector's slide list: this week's slides in play order (repeats and
 * stale ids included), then the deck slides left out, in deck order.
 */
export function slideListEntries(row: SlidesRowFields, deck: Pick<Deck, "slides">): SlideListEntry[] {
  const byId = new Map(deck.slides.map((s) => [s.id, s] as const));
  const ids = rowSlideIds(row, deck);
  const seen = new Set<string>();
  const out: SlideListEntry[] = ids.map((slideId, position) => {
    const repeat = seen.has(slideId);
    seen.add(slideId);
    return { kind: "in", position, slideId, slide: byId.get(slideId) ?? null, repeat };
  });
  for (const s of deck.slides) if (!seen.has(s.id)) out.push({ kind: "out", slideId: s.id, slide: s });
  return out;
}

/** A short caption for a slide: its label, else its first non-empty text line, else "Slide n". */
export function slideCaption(slide: Pick<DeckSlide, "label" | "data"> | null, index: number): string {
  if (!slide) return "Slide no longer in the deck";
  if (slide.label?.trim()) return slide.label.trim();
  for (const v of Object.values(slide.data)) {
    const line = v.split("\n").find((l) => l.trim() !== "");
    if (line) return line.trim();
  }
  return `Slide ${index + 1}`;
}

/** "Deck default (<name>)" option label for the design select. */
export function deckDefaultLabel(templateName: string | undefined): string {
  return `Deck default (${templateName ?? "Missing template"})`;
}

/** The "Detach to this show" confirm. */
export function detachConfirm(deckName: string): { title: string; message: string; confirmLabel: string } {
  return {
    title: "Detach from deck?",
    message: `This show gets its own copy of the slides. Later edits to "${deckName}" won't change it.`,
    confirmLabel: "Detach",
  };
}

/** The value a text-field edit stores: undefined (no override) when it matches the deck's text. */
export function overrideValue(next: string, deckValue: string | undefined): string | undefined {
  return next === (deckValue ?? "") ? undefined : next;
}
