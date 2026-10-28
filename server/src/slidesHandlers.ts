import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as decks from "./decks";
import { broadcast } from "./broadcast";
import { scheduleSync } from "./cloudSync";
import * as stageFeedHub from "./stageFeedHub";

export type SlidesMessage = Extract<
  ClientMessage,
  {
    type:
      | "list_decks"
      | "get_deck"
      | "save_deck"
      | "delete_deck"
      | "restore_deck"
      | "duplicate_deck"
      | "slides_take"
      | "slides_advance"
      | "slides_goto"
      | "slides_blank"
      | "slides_end"
      | "convert_song_to_deck"
      | "undo_convert_song";
  }
>;

type Send = (m: ServerMessage) => void;

async function broadcastList(): Promise<void> {
  broadcast({ type: "deck_list", decks: await decks.listDeckMetas() });
}

export async function handleSlidesMessage(msg: SlidesMessage, send: Send): Promise<void> {
  switch (msg.type) {
    case "list_decks":
      send({ type: "deck_list", decks: await decks.listDeckMetas() });
      return;
    case "get_deck": {
      const d = await decks.getDeck(msg.deckId);
      if (!d) send({ type: "error", code: "not_found", message: msg.deckId });
      else send({ type: "deck", deck: d });
      return;
    }
    case "save_deck": {
      const ids = new Set<string>();
      for (const s of msg.deck.slides) {
        if (ids.has(s.id)) {
          send({ type: "error", code: "invalid", message: "Duplicate slide id" });
          return;
        }
        ids.add(s.id);
      }
      const saved = await decks.saveDeck(msg.deck);
      send({ type: "ack", op: "save_deck", id: saved.id });
      broadcast({ type: "deck", deck: saved });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
    case "delete_deck": {
      const ok = await decks.deleteDeck(msg.deckId);
      send({ type: "ack", op: "delete_deck", id: msg.deckId });
      if (ok) {
        await broadcastList();
        stageFeedHub.invalidateAll();
        scheduleSync();
      }
      return;
    }
    case "restore_deck": {
      const d = await decks.restoreDeck(msg.deckId);
      if (!d) {
        send({ type: "error", code: "not_found", message: msg.deckId });
        return;
      }
      send({ type: "ack", op: "restore_deck", id: d.id });
      broadcast({ type: "deck", deck: d });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
    case "duplicate_deck": {
      const d = await decks.duplicateDeck(msg.deckId);
      if (!d) {
        send({ type: "error", code: "not_found", message: msg.deckId });
        return;
      }
      send({ type: "ack", op: "duplicate_deck", id: d.id });
      broadcast({ type: "deck", deck: d });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
      return;
    }
    // slides_* (P3.9) and convert (P3.12) are filled in by later tasks.
    default:
      return;
  }
}
