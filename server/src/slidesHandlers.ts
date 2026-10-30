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
import * as mediaDeckSession from "./mediaDeckSession";
// [/P3.9]
// [P3.12]
import {
  ConvertFailedError,
  ConvertRollbackError,
  SongNotFoundError,
  UndoInProgressError,
  conversionShowIds,
  convertSongToDeck,
  undoConversion,
} from "./decksConvert";
import * as songs from "./songs";
// [/P3.12]

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
  // A media-only deck (photos/videos, or a live folder) plays in the media slot, beneath graphics.
  const mediaDeck = mediaDeckSession.mediaDeckForRow(row, deck);
  if (mediaDeck) {
    const res = mediaDeckSession.start(msg.channel ?? row.channelHint ?? "program", {
      rowId: row.id,
      showId: show.id,
      deck: mediaDeck,
      ...(msg.slideIdx !== undefined ? { slideIdx: msg.slideIdx } : {}),
    });
    if (!res.ok) send({ type: "error", code: "not_found", message: res.error });
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
  // Photo/video slides air in the media slot and need no design.
  const tpls = new Map<string, Template>();
  for (const id of new Set(view.slides.filter((s) => !s.media).map((s) => s.templateId))) {
    const t = id ? await templates.getTemplate(id) : null;
    if (!t) {
      send({ type: "error", code: "not_configured", message: "Pick a design for this deck" });
      return;
    }
    tpls.set(id, t);
  }
  // Each slide holds for its own holdSec, else the deck's default; neither means it waits for the operator.
  const sourceSlides = row.deckId ? (deck?.slides ?? []) : (row.localSlides ?? []);
  const byId = new Map(sourceSlides.map((sl) => [sl.id, sl] as const));
  const defaultHoldSec = row.deckId ? deck?.defaultHoldSec : undefined;
  // A video slide plays as in a media-only deck: it advances on its end unless it opts out
  // (then only its own hold applies); the deck's default hold never cuts a video short.
  const isVideo = (sl: (typeof view.slides)[number]) => sl.media?.mediaType === "video";
  const advanceOnEnd = view.slides.map((sl) => isVideo(sl) && (byId.get(sl.slideId)?.advanceOnEnd ?? true));
  const timing = {
    holdSecs: view.slides.map((sl, i) => {
      if (advanceOnEnd[i]) return undefined;
      const own = byId.get(sl.slideId)?.holdSec;
      return isVideo(sl) ? own : (own ?? defaultHoldSec);
    }),
    loop: row.deckId ? deck?.loop === true : false,
    ...(advanceOnEnd.some(Boolean) ? { advanceOnEnd } : {}),
  };
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
      timing,
    },
    slideIdx,
  );
}
// [/P3.9]

/** Slides controls drive the channel's media deck unless a graphics-slot deck is live there. */
function isMediaSession(channel: string): boolean {
  return !slidesSession.getSession(channel) && mediaDeckSession.has(channel);
}

async function broadcastList(): Promise<void> {
  broadcast({ type: "deck_list", decks: await decks.listDeckMetas() });
}

// [P3.12] convert broadcasts
async function broadcastConvertChanges(deckId: string | null, showIds: string[]): Promise<void> {
  if (deckId) {
    const d = await decks.getDeck(deckId);
    if (d) broadcast({ type: "deck", deck: d });
  }
  await broadcastList();
  broadcast({ type: "song_list", songs: await songs.listSongMetas() });
  broadcast({ type: "show_list", shows: await shows.listShowMetas() });
  for (const id of showIds) {
    const s = await shows.getShow(id);
    if (s) broadcast({ type: "show", show: s });
  }
  stageFeedHub.invalidateAll();
  scheduleSync();
}
// [/P3.12]

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
      if (isMediaSession(msg.channel)) mediaDeckSession.step(msg.channel, msg.delta);
      else slidesSession.advance(msg.channel, msg.delta);
      return;
    case "slides_goto": {
      // A media session goes by key when one is sent: its list may have changed under a client's index.
      if (msg.key !== undefined && isMediaSession(msg.channel)) {
        mediaDeckSession.goToKey(msg.channel, msg.key, msg.slideIdx);
        return;
      }
      const ok = isMediaSession(msg.channel)
        ? mediaDeckSession.goTo(msg.channel, msg.slideIdx)
        : slidesSession.goTo(msg.channel, msg.slideIdx);
      if (!ok) send({ type: "error", code: "not_found", message: `slide ${msg.slideIdx}` });
      return;
    }
    case "slides_blank":
      slidesSession.blank(msg.channel);
      return;
    case "slides_end":
      if (isMediaSession(msg.channel)) mediaDeckSession.end(msg.channel);
      else slidesSession.end(msg.channel);
      return;
    // [/P3.9]
    // [P3.12] convert a song to a slide deck
    case "convert_song_to_deck": {
      let res: Awaited<ReturnType<typeof convertSongToDeck>>;
      try {
        res = await convertSongToDeck(msg.songId, {
          titleSlide: msg.titleSlide,
          ...(msg.licensing ? { licensing: msg.licensing } : {}),
        });
      } catch (err) {
        if (err instanceof SongNotFoundError) {
          send({ type: "error", code: "not_found", message: msg.songId });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        // Tagged with the song id so the requesting client can tell this reply is its own.
        send({ type: "error", code: "handler_error", message: `${message} [song:${msg.songId}]` });
        if (err instanceof ConvertRollbackError) {
          // The undo record is kept: give the client its id so it can offer Undo.
          send({ type: "song_convert_failed", conversionId: err.conversionId, songId: err.songId, message });
        }
        // Shows were written (and maybe put back): re-send them so no client keeps a stale copy.
        const showIds = err instanceof ConvertRollbackError || err instanceof ConvertFailedError ? err.showIds : [];
        await broadcastConvertChanges(null, showIds);
        return;
      }
      send({
        type: "song_converted",
        conversionId: res.conversionId,
        deckId: res.deck.id,
        deckName: res.deck.name,
        rows: res.rows,
        shows: res.shows,
        warnings: res.warnings,
      });
      await broadcastConvertChanges(res.deck.id, res.changedShowIds);
      return;
    }
    case "undo_convert_song": {
      let res: Awaited<ReturnType<typeof undoConversion>>;
      try {
        res = await undoConversion(msg.conversionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof UndoInProgressError) {
          send({ type: "error", code: "busy", message });
          return;
        }
        // The undo record is kept, so the operator can try again. Some shows
        // may already be back: re-send every show the conversion touched.
        // Tagged with the conversion id so the requesting client can tell this reply is its own.
        send({ type: "error", code: "handler_error", message: `${message} [conversion:${msg.conversionId}]` });
        await broadcastConvertChanges(null, conversionShowIds(msg.conversionId));
        return;
      }
      if (!res) {
        send({ type: "error", code: "not_found", message: msg.conversionId });
        return;
      }
      send({
        type: "song_convert_undone",
        conversionId: msg.conversionId,
        songId: res.songId,
        restoredShows: res.restoredShows,
        skippedShows: res.skippedShows,
      });
      await broadcastConvertChanges(null, res.restoredShowIds);
      return;
    }
    // [/P3.12]
  }
}
