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

/** "Deck default (<name>)"; plain "Deck default" while the template list loads (no "Missing template" flash). */
export function deckDefaultLabel(templateName: string | undefined, templatesLoaded = true): string {
  if (templateName) return `Deck default (${templateName})`;
  return templatesLoaded ? "Deck default (Missing template)" : "Deck default";
}

/** The "Detach to this show" confirm; CCLI decks also warn that usage stops being reported. */
export function detachConfirm(
  deckName: string,
  ccli = false,
): { title: string; message: string; confirmLabel: string } {
  const base = `This show gets its own copy of the slides. Later edits to "${deckName}" won't change it.`;
  return {
    title: "Detach from deck?",
    message: ccli ? `${base} CCLI usage won't be reported for this row after detaching.` : base,
    confirmLabel: "Detach",
  };
}

/**
 * The value a text-field edit stores: undefined (no override) when it matches
 * the deck's text. Clearing a field the deck never set stores "" so the
 * design's sample text can't air.
 */
export function overrideValue(next: string, deckValue: string | undefined): string | undefined {
  if (deckValue === undefined) return next;
  return next === deckValue ? undefined : next;
}

/** A slide's non-empty stored values the design has no field for, in data order. */
export function unshownValues(data: Record<string, string>, fieldKeys: string[]): { key: string; value: string }[] {
  const shown = new Set(fieldKeys);
  return Object.entries(data)
    .filter(([k, v]) => !shown.has(k) && v.trim() !== "")
    .map(([key, value]) => ({ key, value }));
}

/** True when the slides have text and the design's text keys share none of the keys it is stored under. */
export function designMissesSlideText(fieldKeys: string[], slides: Pick<DeckSlide, "data">[]): boolean {
  const used = new Set<string>();
  for (const s of slides) for (const [k, v] of Object.entries(s.data)) if (v.trim() !== "") used.add(k);
  if (used.size === 0) return false;
  return !fieldKeys.some((k) => used.has(k));
}

/** How many of the row's playing slides keep their own design (the row's design doesn't apply to them). */
export function ownDesignCount(row: SlidesRowFields, deck: Pick<Deck, "slides">): number {
  const byId = new Map(deck.slides.map((s) => [s.id, s] as const));
  return rowSlideIds(row, deck).filter((id) => !!byId.get(id)?.templateId).length;
}
