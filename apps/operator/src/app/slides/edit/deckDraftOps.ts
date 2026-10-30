import { deckTextToSlides, type Deck, type DeckSlide, type MediaRef } from "@overlaysys/core";

/** Pure edits on a deck draft. Every op returns a new deck, or the same deck when it changes nothing. */

const indexOf = (deck: Deck, id: string) => deck.slides.findIndex((s) => s.id === id);

function mapSlide(deck: Deck, id: string, fn: (s: DeckSlide) => DeckSlide): Deck {
  const i = indexOf(deck, id);
  if (i < 0) return deck;
  const slides = deck.slides.slice();
  slides[i] = fn(deck.slides[i]!);
  return { ...deck, slides };
}

function insertAt(deck: Deck, at: number, slide: DeckSlide): Deck {
  const slides = deck.slides.slice();
  slides.splice(at, 0, slide);
  return { ...deck, slides };
}

/** An empty slide after `afterId` (at the end when absent or unknown). */
export function addSlide(deck: Deck, afterId: string | undefined, newId: string): Deck {
  const i = afterId === undefined ? -1 : indexOf(deck, afterId);
  return insertAt(deck, i < 0 ? deck.slides.length : i + 1, { id: newId, data: {} });
}

/** A copy of slide `id` (template, data, label) under `newId`, right after it. */
export function duplicateSlide(deck: Deck, id: string, newId: string): Deck {
  const i = indexOf(deck, id);
  if (i < 0) return deck;
  const src = deck.slides[i]!;
  return insertAt(deck, i + 1, { ...src, id: newId, data: { ...src.data } });
}

/** Removes slide `id`. Refused (same deck back) for the last slide: a deck always has one. */
export function deleteSlide(deck: Deck, id: string): Deck {
  if (deck.slides.length <= 1) return deck;
  const i = indexOf(deck, id);
  if (i < 0) return deck;
  return { ...deck, slides: deck.slides.filter((_, j) => j !== i) };
}

/** Moves the slide at index `from` to index `to`. Ids and contents are kept. */
export function moveSlide(deck: Deck, from: number, to: number): Deck {
  const n = deck.slides.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return deck;
  const slides = deck.slides.slice();
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved!);
  return { ...deck, slides };
}

/** Per-slide design override; `undefined` clears it so the row/deck default applies. */
export function setSlideTemplate(deck: Deck, id: string, templateId: string | undefined): Deck {
  return mapSlide(deck, id, (s) => {
    const { templateId: _old, ...rest } = s;
    return templateId ? { ...rest, templateId } : rest;
  });
}

export function setSlideData(deck: Deck, id: string, key: string, value: string): Deck {
  return mapSlide(deck, id, (s) => ({ ...s, data: { ...s.data, [key]: value } }));
}

/** A blank label removes it. */
export function setSlideLabel(deck: Deck, id: string, label: string): Deck {
  return mapSlide(deck, id, (s) => {
    const { label: _old, ...rest } = s;
    return label.trim() ? { ...rest, label } : rest;
  });
}

const isBlankSlide = (s: DeckSlide) =>
  !s.media && !s.templateId && !s.label?.trim() && Object.values(s.data).every((v) => !v.trim());

/** The deck's slides with a new deck's lone empty slide dropped (it would play first otherwise). */
const keptSlides = (deck: Deck) => (deck.slides.length === 1 && isBlankSlide(deck.slides[0]!) ? [] : deck.slides);

/** A photo or video slide at the end. `data` stays `{}` so older clients still parse the deck. */
export function addMediaSlide(deck: Deck, ref: MediaRef, newId: string): Deck {
  const media: MediaRef = { ...(ref.mediaItemId ? { mediaItemId: ref.mediaItemId } : {}), assetUrl: ref.assetUrl, mediaType: ref.mediaType };
  return { ...deck, slides: [...keptSlides(deck), { id: newId, data: {}, media }] };
}

const validHold = (sec: number | undefined) => (sec !== undefined && Number.isFinite(sec) && sec > 0 ? sec : undefined);

/** Seconds every slide is held; `undefined` (or not a positive number) turns auto-advance off. */
export function setDefaultHold(deck: Deck, sec: number | undefined): Deck {
  const { defaultHoldSec: _old, ...rest } = deck;
  const v = validHold(sec);
  return v === undefined ? rest : { ...rest, defaultHoldSec: v };
}

/** One slide's own hold; `undefined` falls back to the deck's. */
export function setSlideHold(deck: Deck, id: string, sec: number | undefined): Deck {
  return mapSlide(deck, id, (s) => {
    const { holdSec: _old, ...rest } = s;
    const v = validHold(sec);
    return v === undefined ? rest : { ...rest, holdSec: v };
  });
}

export function setLoop(deck: Deck, on: boolean): Deck {
  const { loop: _old, ...rest } = deck;
  return on ? { ...rest, loop: true } : rest;
}

/** A video slide moves on when the video ends (or waits for its hold / the operator). */
export function setAdvanceOnEnd(deck: Deck, id: string, on: boolean): Deck {
  return mapSlide(deck, id, (s) => ({ ...s, advanceOnEnd: on }));
}

/** A video slide plays silently when muted; off (the default) plays its sound. */
export function setSlideMuted(deck: Deck, id: string, on: boolean): Deck {
  return mapSlide(deck, id, (s) => {
    const { muted: _old, ...rest } = s;
    return on ? { ...rest, muted: true } : rest;
  });
}

/** Hold-time text → seconds; blank or not a positive number → undefined (use the default). */
export function parseHoldText(text: string): number | undefined {
  const t = text.trim();
  return t ? validHold(Number(t)) : undefined;
}

/**
 * One slide per blank-line-separated block of `text`, written to `fieldKey`,
 * appended to the deck. A deck that is just one empty slide (a new deck) is
 * replaced rather than keeping the empty slide first.
 */
export function appendPastedText(deck: Deck, text: string, fieldKey: string, newId: () => string): Deck {
  const added = deckTextToSlides(text, fieldKey, newId);
  if (added.length === 0) return deck;
  return { ...deck, slides: [...keptSlides(deck), ...added] };
}

/** Comma-separated tag text → trimmed tags, blanks and case-insensitive repeats dropped (first spelling wins). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const t = raw.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export const deckDefaultOptionLabel = (templateName: string) => `Deck default (${templateName})`;
