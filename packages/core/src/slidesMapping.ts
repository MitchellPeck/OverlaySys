import { z } from "zod";
import type { Deck, SlidesRowFields } from "./deck";
import type { PcoPlanItem } from "./pco/pcoTypes";
import type { RowSourceRef } from "./show";

export const PcoItemMappingSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    kind: z.literal("slides"),
    deckId: z.string(),
    templateId: z.string().optional(),
    updatedAt: z.string(),
    deletedAt: z.string().optional(),
  })
  .passthrough();
export type PcoItemMapping = z.infer<typeof PcoItemMappingSchema>;

export function normalizePcoTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function mappingKeysFor(item: Pick<PcoPlanItem, "title" | "song">): {
  songKey: string | null;
  titleKey: string;
} {
  const songId = item.song?.id;
  return {
    songKey: songId ? `pcoSong:${songId}` : null,
    titleKey: `title:${normalizePcoTitle(item.title ?? "")}`,
  };
}

export function findMapping(
  item: Pick<PcoPlanItem, "title" | "song">,
  mappings: PcoItemMapping[],
): PcoItemMapping | null {
  const { songKey, titleKey } = mappingKeysFor(item);
  const live = mappings.filter((m) => !m.deletedAt);
  if (songKey) {
    const hit = live.find((m) => m.key === songKey);
    if (hit) return hit;
  }
  return live.find((m) => m.key === titleKey) ?? null;
}

export type DeckSuggestion = {
  deckId: string;
  deckName: string;
  via: "remembered" | "name";
  mappingId?: string;
  templateId?: string;
};

export function suggestDeck(
  item: Pick<PcoPlanItem, "title" | "song">,
  mappings: PcoItemMapping[],
  decks: Pick<Deck, "id" | "name" | "deletedAt">[],
): DeckSuggestion | null {
  const liveDecks = decks.filter((d) => !d.deletedAt);
  const mapping = findMapping(item, mappings);
  if (mapping) {
    const deck = liveDecks.find((d) => d.id === mapping.deckId);
    if (deck) {
      return {
        deckId: deck.id,
        deckName: deck.name,
        via: "remembered",
        mappingId: mapping.id,
        ...(mapping.templateId ? { templateId: mapping.templateId } : {}),
      };
    }
  }
  const norm = normalizePcoTitle(item.title ?? "");
  if (!norm) return null;
  const byName = liveDecks.find((d) => normalizePcoTitle(d.name) === norm);
  return byName ? { deckId: byName.id, deckName: byName.name, via: "name" } : null;
}

export function buildSlidesRow(opts: {
  id: string;
  deckId: string;
  templateId?: string;
  sourceRef: RowSourceRef;
  lengthSec?: number;
}): SlidesRowFields {
  return {
    kind: "slides",
    id: opts.id,
    deckId: opts.deckId,
    ...(opts.templateId ? { templateId: opts.templateId } : {}),
    sourceRef: opts.sourceRef as SlidesRowFields["sourceRef"],
    ...(opts.lengthSec !== undefined ? { lengthSec: opts.lengthSec } : {}),
  };
}

export function carryOverSlidesRow(old: SlidesRowFields, next: SlidesRowFields): SlidesRowFields {
  if (!old.deckId || old.deckId !== next.deckId) return next;
  return {
    ...next,
    ...(old.slideIds ? { slideIds: old.slideIds } : {}),
    ...(old.fieldOverrides ? { fieldOverrides: old.fieldOverrides } : {}),
    ...(!next.templateId && old.templateId ? { templateId: old.templateId } : {}),
  };
}
