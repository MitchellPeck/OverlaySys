"use client";

import { useEffect } from "react";
import type { Deck } from "@overlaysys/core";
import { useStore } from "../../lib/store";
import { getClient } from "../../lib/useWs";

const requested = new Set<string>();

/**
 * The deck with this id from the store's cache. undefined = loading (sends
 * get_deck once per id), null = not found. Re-reads deckCache, so a broadcast
 * `deck` refreshes every consumer.
 */
export function useDeck(deckId: string | undefined): Deck | null | undefined {
  const cached = useStore((s) => (deckId ? s.deckCache[deckId] : undefined));
  const known = useStore((s) => (deckId ? s.decks.some((d) => d.id === deckId) : false));
  const listed = useStore((s) => s.decks.length > 0);
  useEffect(() => {
    if (!deckId || cached || requested.has(deckId)) return;
    requested.add(deckId);
    getClient().send({ type: "get_deck", deckId });
  }, [deckId, cached]);
  if (!deckId) return undefined;
  if (cached) return cached;
  // Deck list loaded and the id isn't in it (and wasn't cached): not found.
  if (listed && !known) return null;
  return undefined;
}
