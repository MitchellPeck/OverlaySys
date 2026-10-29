import type { Deck, DeckSlide, SlidesRowFields } from "./deck";
import { resolveSlidesRow } from "./slides";

/**
 * Pure edits on a slides row (show editor, P3.16). Every op returns a new row
 * that keeps the row id and any unknown keys. "Positions" index the row's
 * effective slide-id list (`slideIds`, else deck order), stale ids included,
 * so a slide that left the deck can still be removed.
 *
 * Ops that take `deck` only read its slide order, so a one-off row can pass
 * `{ slides: row.localSlides }`.
 */

type DeckLike = Pick<Deck, "slides">;

/** A copy of `row` with `patch` applied; `undefined` removes the key. */
function patch<R extends SlidesRowFields>(row: R, p: Partial<SlidesRowFields>): R {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as unknown as R;
}

export function newSlidesRow(id: string, deckId: string): SlidesRowFields {
  return { kind: "slides", id, deckId };
}

/** A one-off row (no deck) with one empty slide in `templateId`. */
export function newOneOffSlidesRow(id: string, templateId: string, slideId: string): SlidesRowFields {
  return { kind: "slides", id, templateId, localSlides: [{ id: slideId, data: {} }] };
}

/** The row's slide ids in play order: its subset when set, else the deck's order. */
export function rowSlideIds(row: SlidesRowFields, deck: DeckLike): string[] {
  return row.slideIds ? row.slideIds.slice() : deck.slides.map((s) => s.id);
}

/** Points the row at another deck; this week's subset and text edits no longer apply. */
export function setDeck<R extends SlidesRowFields>(row: R, deckId: string): R {
  return patch(row, { deckId, slideIds: undefined, fieldOverrides: undefined, localSlides: undefined });
}

export function useAllSlides<R extends SlidesRowFields>(row: R): R {
  return patch(row, { slideIds: undefined });
}

/** Sets this week's slide order; collapses to "all slides" when it equals the deck order. */
export function setSubset<R extends SlidesRowFields>(row: R, deck: DeckLike, slideIds: string[]): R {
  const full = deck.slides.map((s) => s.id);
  const same = slideIds.length === full.length && slideIds.every((id, i) => id === full[i]);
  return patch(row, { slideIds: same ? undefined : slideIds.slice() });
}

/** Plays the slide at `position` again, right after itself. */
export function addRepeat<R extends SlidesRowFields>(row: R, deck: DeckLike, position: number): R {
  const ids = rowSlideIds(row, deck);
  if (position < 0 || position >= ids.length) return row;
  ids.splice(position + 1, 0, ids[position]!);
  return setSubset(row, deck, ids);
}

export function removeAt<R extends SlidesRowFields>(row: R, deck: DeckLike, position: number): R {
  const ids = rowSlideIds(row, deck);
  if (position < 0 || position >= ids.length) return row;
  ids.splice(position, 1);
  return setSubset(row, deck, ids);
}

export function moveAt<R extends SlidesRowFields>(row: R, deck: DeckLike, from: number, to: number): R {
  const ids = rowSlideIds(row, deck);
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return row;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);
  return setSubset(row, deck, ids);
}

/** Row design override; undefined or "" falls back to the deck default. */
export function setRowTemplate<R extends SlidesRowFields>(row: R, templateId: string | undefined): R {
  return patch(row, { templateId: templateId || undefined });
}

/** This week's text for one field of one slide; undefined resets it. Empty entries are pruned. */
export function setFieldOverride<R extends SlidesRowFields>(
  row: R,
  slideId: string,
  key: string,
  value: string | undefined,
): R {
  const all = { ...(row.fieldOverrides ?? {}) };
  const one = { ...(all[slideId] ?? {}) };
  if (value === undefined) delete one[key];
  else one[key] = value;
  if (Object.keys(one).length > 0) all[slideId] = one;
  else delete all[slideId];
  return patch(row, { fieldOverrides: Object.keys(all).length > 0 ? all : undefined });
}

/**
 * Gives the row its own copy of the slides: the resolved slides with this
 * week's text baked in, the effective row design kept, and the deck link,
 * subset and overrides removed. Each local slide gets a fresh id (repeats too).
 */
export function detachSlidesRow<R extends SlidesRowFields>(row: R, deck: Deck, newId: () => string): R {
  const byId = new Map(deck.slides.map((s) => [s.id, s] as const));
  const localSlides: DeckSlide[] = resolveSlidesRow(row, deck).slides.map((r) => {
    const src = byId.get(r.slideId);
    const s: DeckSlide = { id: newId(), data: { ...r.data } };
    if (src?.templateId) s.templateId = src.templateId;
    if (r.label !== undefined) s.label = r.label;
    return s;
  });
  return patch(row, {
    deckId: undefined,
    slideIds: undefined,
    fieldOverrides: undefined,
    templateId: row.templateId || deck.defaultTemplateId,
    localSlides,
  });
}

/** One-off rows: appends an empty local slide (and to the subset when one is set). */
export function addLocalSlide<R extends SlidesRowFields>(row: R, slideId: string): R {
  const localSlides = [...(row.localSlides ?? []), { id: slideId, data: {} }];
  return patch(row, { localSlides, slideIds: row.slideIds ? [...row.slideIds, slideId] : undefined });
}

/** One-off rows: edits a local slide's text; undefined removes the key. */
export function setLocalSlideField<R extends SlidesRowFields>(
  row: R,
  slideId: string,
  key: string,
  value: string | undefined,
): R {
  const localSlides = (row.localSlides ?? []).map((s) => {
    if (s.id !== slideId) return s;
    const data = { ...s.data };
    if (value === undefined) delete data[key];
    else data[key] = value;
    return { ...s, data };
  });
  return patch(row, { localSlides });
}
