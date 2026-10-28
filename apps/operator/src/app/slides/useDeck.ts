"use client";

import { useEffect } from "react";
import type { Deck } from "@overlaysys/core";
import { useStore } from "../../lib/store";
import { getClient } from "../../lib/useWs";
import { requestedDecks } from "../../lib/deckRequests";

/**
 * The deck with this id from the store's cache. undefined = loading (sends
 * get_deck once per id per connection), null = the server said not_found.
 *
 * Deliberately returns tombstones (deletedAt set): the library may show and
 * restore them. Live callers go through useDeckFor, which maps them to null.
 */
export function useDeck(deckId: string | undefined): Deck | null | undefined {
  const cached = useStore((s) => (deckId ? s.deckCache[deckId] : undefined));
  const notFound = useStore((s) => (deckId ? !!s.deckNotFound[deckId] : false));
  const epoch = useStore((s) => s.deckEpoch);
  useEffect(() => {
    if (!deckId || cached || requestedDecks.has(deckId)) return;
    requestedDecks.add(deckId);
    getClient().send({ type: "get_deck", deckId });
  }, [deckId, cached, epoch]);
  if (!deckId) return undefined;
  if (cached) return cached;
  return notFound ? null : undefined;
}
