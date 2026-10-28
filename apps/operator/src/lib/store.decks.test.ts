import { beforeEach, describe, expect, it } from "vitest";
import type { Deck } from "@overlaysys/core";
import { requestedDecks } from "./deckRequests";
import { useStore } from "./store";

const deck = { id: "d1", name: "Deck A", tags: [], defaultTemplateId: "t", licensing: { kind: "own" }, slides: [], createdAt: "x" } as Deck;

beforeEach(() => {
  useStore.setState({ decks: [], deckCache: {}, deckNotFound: {}, deckEpoch: 0 });
  requestedDecks.clear();
});

describe("deck lookup state", () => {
  it("stale list: an unlisted id is not marked missing, then the deck arrives", () => {
    useStore.getState().setDecks([{ id: "other" } as never]);
    expect(useStore.getState().deckNotFound.d1).toBeUndefined();
    useStore.getState().upsertDeck(deck);
    expect(useStore.getState().deckCache.d1).toBe(deck);
  });

  it("not_found marks the id missing and lets it be re-requested", () => {
    requestedDecks.add("d1");
    useStore.getState().markDeckNotFound("d1");
    expect(useStore.getState().deckNotFound.d1).toBe(true);
    expect(requestedDecks.has("d1")).toBe(false);
  });

  it("empty library + deleted deck: not_found alone yields missing", () => {
    expect(useStore.getState().decks).toEqual([]);
    useStore.getState().markDeckNotFound("gone");
    expect(useStore.getState().deckNotFound.gone).toBe(true);
  });

  it("a deck arriving later clears an earlier not_found", () => {
    useStore.getState().markDeckNotFound("d1");
    useStore.getState().upsertDeck(deck);
    expect(useStore.getState().deckNotFound.d1).toBeUndefined();
  });

  it("reconnect clears requested + notFound and bumps the epoch so lost requests retry", () => {
    requestedDecks.add("d1");
    useStore.getState().markDeckNotFound("x");
    useStore.getState().resetDeckLookups();
    expect(requestedDecks.size).toBe(0);
    expect(useStore.getState().deckNotFound).toEqual({});
    expect(useStore.getState().deckEpoch).toBe(1);
  });
});
