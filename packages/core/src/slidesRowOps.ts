import type { Deck, DeckLicensing, DeckSlide, SlidesRowFields } from "./deck";
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

/** `""` for each key: an empty slide airs blank, never the design's sample text. */
const blankData = (fieldKeys: string[]): Record<string, string> =>
  Object.fromEntries(fieldKeys.map((k) => [k, ""]));

/** A one-off row (no deck) with one empty slide in `templateId`; `fieldKeys` are seeded with "". */
export function newOneOffSlidesRow(
  id: string,
  templateId: string,
  slideId: string,
  fieldKeys: string[] = [],
): SlidesRowFields {
  return { kind: "slides", id, templateId, localSlides: [{ id: slideId, data: blankData(fieldKeys) }] };
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
    // Spread: a deck slide's unknown keys travel with it. Label comes from the resolved slide.
    const { label: _label, ...rest } = src ?? ({} as Partial<DeckSlide>);
    const s: DeckSlide = { ...rest, id: newId(), data: { ...r.data } };
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
export function addLocalSlide<R extends SlidesRowFields>(row: R, slideId: string, fieldKeys: string[] = []): R {
  const localSlides = [...(row.localSlides ?? []), { id: slideId, data: blankData(fieldKeys) }];
  return patch(row, { localSlides, slideIds: row.slideIds ? [...row.slideIds, slideId] : undefined });
}

/** One-off rows: deletes a local slide (and every position of it in the subset). */
export function removeLocalSlide<R extends SlidesRowFields>(row: R, slideId: string): R {
  return patch(row, {
    localSlides: (row.localSlides ?? []).filter((s) => s.id !== slideId),
    slideIds: row.slideIds ? row.slideIds.filter((id) => id !== slideId) : undefined,
  });
}

/** One-off rows: edits a local slide's text. "" is kept (airs blank); only undefined removes the key. */
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

/**
 * "Save to library": the row's one-off slides become a new global deck and the
 * row points at it. Slide ids, labels and unknown slide keys go into the deck
 * unchanged (nothing re-keys), so the subset, repeats and this show's text
 * edits on the row still apply. The row's design becomes the deck default.
 */
export function saveRowToLibrary<R extends SlidesRowFields>(
  row: R,
  a: { deckId: string; name: string; licensing: DeckLicensing; now: string },
): { deck: Deck; row: R } {
  let licensing = a.licensing;
  if (licensing.kind === "ccli") {
    const n = licensing.ccliNumber?.trim();
    licensing = n ? { kind: "ccli", ccliNumber: n } : { kind: "ccli" };
  }
  const deck: Deck = {
    id: a.deckId,
    name: a.name.trim(),
    tags: [],
    defaultTemplateId: row.templateId ?? "",
    licensing,
    slides: (row.localSlides ?? []).map((s) => ({ ...s, data: { ...s.data } })),
    createdAt: a.now,
  };
  return { deck, row: patch(row, { deckId: a.deckId, localSlides: undefined, templateId: undefined }) };
}

/** Pasted text → one slide per blank-line-separated block (trimmed; empty blocks dropped). */
export function splitPastedSlides(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * One-off rows: adds a slide per chunk, the chunk in `targetKey` and "" in the
 * other `fieldKeys`. A row whose only slide is still empty has that slide
 * filled first (its id kept). New slides join the subset when one is set.
 */
export function pasteLocalSlides<R extends SlidesRowFields>(
  row: R,
  chunks: string[],
  o: { newId: () => string; fieldKeys: string[]; targetKey: string },
): R {
  if (chunks.length === 0) return row;
  const fill = (text: string) => ({ ...blankData(o.fieldKeys), [o.targetKey]: text });
  const existing = row.localSlides ?? [];
  const lone = existing.length === 1 && Object.values(existing[0]!.data).every((v) => v === "") ? existing[0]! : null;
  const rest = lone ? chunks.slice(1) : chunks;
  const added: DeckSlide[] = rest.map((c) => ({ id: o.newId(), data: fill(c) }));
  const localSlides = lone ? [{ ...lone, data: { ...lone.data, ...fill(chunks[0]!) } }, ...added] : [...existing, ...added];
  const newIds = added.map((s) => s.id);
  return patch(row, { localSlides, slideIds: row.slideIds ? [...row.slideIds, ...newIds] : undefined });
}
