import { mappingKeysFor, suggestDeck, type DeckSuggestion, type PcoPlanItem } from "@overlaysys/core";
import { listDecks } from "../decks";
import { listItemMappings, upsertItemMapping } from "./itemMappings";
import type { ImportItemConfig } from "./importPlan";

/**
 * itemId → the deck the import UI should pre-select for "Import as Slides".
 * A remembered mapping wins (PCO song id over title); a mapping whose deck
 * was deleted is ignored and the name match is used instead. Items with no
 * suggestion are left out.
 */
export async function slidesSuggestionsFor(items: PcoPlanItem[]): Promise<Record<string, DeckSuggestion>> {
  const [mappings, decks] = await Promise.all([listItemMappings(), listDecks()]);
  const out: Record<string, DeckSuggestion> = {};
  for (const item of items) {
    const s = suggestDeck(item, mappings, decks);
    if (s) out[item.id] = s;
  }
  return out;
}

/**
 * Remember the operator's deck choice for each slides config with
 * `remember: true`: always under the item's `title:` key, and also under its
 * `pcoSong:` key when the item is linked to a PCO song. Returns the number of
 * mappings written. Call only after the show was saved.
 */
export async function rememberSlidesChoices(items: PcoPlanItem[], configs: ImportItemConfig[]): Promise<number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  let written = 0;
  for (const cfg of configs) {
    if (cfg.kind !== "slides" || cfg.remember !== true || !cfg.deckId) continue;
    const item = byId.get(cfg.itemId);
    if (!item) continue;
    const { songKey, titleKey } = mappingKeysFor(item);
    // A title that normalises to nothing (punctuation only) is no key at all.
    const keys = [...(titleKey !== "title:" ? [titleKey] : []), ...(songKey ? [songKey] : [])];
    for (const key of keys) {
      await upsertItemMapping({
        key,
        kind: "slides",
        deckId: cfg.deckId,
        ...(cfg.templateId ? { templateId: cfg.templateId } : {}),
      });
      written++;
    }
  }
  return written;
}
