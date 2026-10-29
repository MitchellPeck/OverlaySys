"use client";

import { useEffect } from "react";
import type { Show } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { requestedDecks } from "@/lib/deckRequests";

/**
 * Asks the server once for every deck the show's slides rows point at, so the
 * rundown shows deck names (not "Missing deck") before a row is selected.
 * Live does the same in Rundown.tsx; this is for the show editor.
 */
export function useRowDecks(show: Show, enabled: boolean): void {
  const conn = useStore((s) => s.conn);
  const deckCache = useStore((s) => s.deckCache);
  const deckNotFound = useStore((s) => s.deckNotFound);
  const epoch = useStore((s) => s.deckEpoch);
  useEffect(() => {
    if (!enabled || conn !== "open") return;
    for (const r of show.rows) {
      if (r.kind !== "slides" || !r.deckId) continue;
      const id = r.deckId;
      if (deckCache[id] || deckNotFound[id] || requestedDecks.has(id)) continue;
      requestedDecks.add(id);
      getClient().send({ type: "get_deck", deckId: id });
    }
  }, [enabled, show, conn, deckCache, deckNotFound, epoch]);
}
