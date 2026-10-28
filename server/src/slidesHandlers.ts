import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as decks from "./decks";
import { broadcast } from "./broadcast";
import { scheduleSync } from "./cloudSync";
import * as stageFeedHub from "./stageFeedHub";
// [P3.9]
import type { Template } from "@overlaysys/core";
import { slidesRowView } from "@overlaysys/core";
import * as shows from "./shows";
import * as templates from "./templates";
import * as slidesSession from "./slidesSession";
// [/P3.9]

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

// [P3.9] slides take: every check runs before anything reaches air.
async function takeSlides(msg: Extract<SlidesMessage, { type: "slides_take" }>, send: Send): Promise<void> {
  const show = await shows.getShow(msg.showId);
  if (!show) {
    send({ type: "error", code: "not_found", message: msg.showId });
    return;
  }
  const row = show.rows.find((r) => r.id === msg.rowId);
  if (!row || row.kind !== "slides") {
    send({ type: "error", code: "not_found", message: msg.rowId });
    return;
  }
  const deck = row.deckId ? await decks.getDeck(row.deckId) : null;
  const view = slidesRowView(row, deck);
  if (view.missingDeck) {
    send({ type: "error", code: "not_found", message: "This slides row's deck was deleted or hasn't synced" });
    return;
  }
  if (view.slides.length === 0) {
    send({ type: "error", code: "not_found", message: "This slides row has no slides" });
    return;
  }
  const slideIdx = msg.slideIdx ?? 0;
  if (slideIdx >= view.slides.length) {
    send({ type: "error", code: "not_found", message: `slide ${slideIdx}` });
    return;
  }
  // A slide with no resolvable design fails the whole take: never a half-rendered deck on air.
  const tpls = new Map<string, Template>();
  for (const id of new Set(view.slides.map((s) => s.templateId))) {
    const t = id ? await templates.getTemplate(id) : null;
    if (!t) {
      send({ type: "error", code: "not_configured", message: "Pick a design for this deck" });
      return;
    }
    tpls.set(id, t);
  }
  const channel = msg.channel ?? row.channelHint ?? "program";
  slidesSession.start(
    channel,
    {
      showId: show.id,
      rowId: row.id,
      ...(row.deckId ? { deckId: row.deckId } : {}),
      title: view.title,
      slides: view.slides,
      licensing: row.deckId && deck ? deck.licensing : null,
      templates: tpls,
    },
    slideIdx,
  );
}
// [/P3.9]

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
      if (!ok) {
        send({ type: "error", code: "not_found", message: msg.deckId });
        return;
      }
      send({ type: "ack", op: "delete_deck", id: msg.deckId });
      await broadcastList();
      stageFeedHub.invalidateAll();
      scheduleSync();
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
    // [P3.9] live slides
    case "slides_take":
      await takeSlides(msg, send);
      return;
    case "slides_advance":
      slidesSession.advance(msg.channel, msg.delta);
      return;
    case "slides_goto":
      if (!slidesSession.goTo(msg.channel, msg.slideIdx)) {
        send({ type: "error", code: "not_found", message: `slide ${msg.slideIdx}` });
      }
      return;
    case "slides_blank":
      slidesSession.blank(msg.channel);
      return;
    case "slides_end":
      slidesSession.end(msg.channel);
      return;
    // [/P3.9]
    // [P3.4] placeholder: replaced by P3.12 (convert)
    case "convert_song_to_deck":
    case "undo_convert_song":
      send({ type: "error", code: "not_implemented", message: msg.type });
      return;
    // [/P3.4]
  }
}
