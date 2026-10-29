import type { DeckMeta, DeckSuggestion, PcoPlanItem } from "@overlaysys/core";
import type { ImportItemConfig } from "../../lib/pcoClient";

export interface SlidesChoice {
  kind: "slides";
  deckId: string;
  templateId?: string;
  remember: true;
}

/**
 * Deck to preselect when an item opens. Only a remembered mapping whose deck
 * still exists qualifies; a name match is shown as a suggestion, never chosen.
 */
export function initialSlidesChoice(
  suggestion: DeckSuggestion | undefined,
  decks: Pick<DeckMeta, "id">[],
): SlidesChoice | null {
  if (!suggestion || suggestion.via !== "remembered") return null;
  if (!decks.some((d) => d.id === suggestion.deckId)) return null;
  return {
    kind: "slides",
    deckId: suggestion.deckId,
    ...(suggestion.templateId ? { templateId: suggestion.templateId } : {}),
    remember: true,
  };
}

export function rememberLabel(item: Pick<PcoPlanItem, "title" | "song">): string {
  return item.song ? "Remember for this Planning Center song" : `Remember for items titled "${item.title}"`;
}

/**
 * Import request entry for a slides row. A remembered mapping's template only
 * applies when the UI passes it back, and only for the deck it was saved with.
 */
export function slidesImportConfig(
  itemId: string,
  choice: { deckId: string; remember: boolean },
  suggestion: DeckSuggestion | undefined,
): ImportItemConfig {
  const templateId =
    suggestion?.via === "remembered" && suggestion.deckId === choice.deckId ? suggestion.templateId : undefined;
  return {
    itemId,
    kind: "slides",
    deckId: choice.deckId,
    remember: choice.remember,
    ...(templateId ? { templateId } : {}),
  };
}

export async function forgetMapping(id: string): Promise<void> {
  // Lazy: pcoClient pulls in the browser WS client, which node tests must not load.
  const { httpBase } = await import("../../lib/pcoClient");
  const res = await fetch(`${httpBase()}/api/pco/item-mappings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Couldn't forget the remembered deck (${res.status}).`);
}
