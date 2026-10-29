import { beforeEach, describe, expect, it } from "vitest";
import type { Deck } from "@overlaysys/core";
import { requestedDecks } from "./deckRequests";
import { useStore } from "./store";

const deck = { id: "d1", name: "Deck A", tags: [], defaultTemplateId: "t", licensing: { kind: "own" }, slides: [], createdAt: "x" } as Deck;

beforeEach(() => {
  useStore.setState({ decks: [], deckCache: {}, deckNotFound: {}, deckEpoch: 0, decksLoaded: false });
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

// [P3.14]
describe("decksLoaded", () => {
  it("is false until the first deck list arrives, even an empty one", () => {
    expect(useStore.getState().decksLoaded).toBe(false);
    useStore.getState().setDecks([]);
    expect(useStore.getState().decksLoaded).toBe(true);
  });
});
// [/P3.14]

describe("deck delete and restore (deck_list only)", () => {
  it("a cached deck missing from the new list is evicted and marked missing", () => {
    useStore.getState().upsertDeck(deck);
    useStore.getState().setDecks([]);
    expect(useStore.getState().deckCache.d1).toBeUndefined();
    expect(useStore.getState().deckNotFound.d1).toBe(true);
  });

  it("keeps listed decks and unrelated cache entries", () => {
    useStore.getState().upsertDeck(deck);
    useStore.getState().setDecks([{ id: "d1" } as never]);
    expect(useStore.getState().deckCache.d1).toBe(deck);
    expect(useStore.getState().deckNotFound.d1).toBeUndefined();
  });

  it("Undo (restore) brings it back: the deck message clears the mark", () => {
    useStore.getState().upsertDeck(deck);
    useStore.getState().setDecks([]);
    useStore.getState().upsertDeck(deck);
    useStore.getState().setDecks([{ id: "d1" } as never]);
    expect(useStore.getState().deckCache.d1).toBe(deck);
    expect(useStore.getState().deckNotFound.d1).toBeUndefined();
  });

  it("a list that names the deck again clears the mark so it is re-fetched", () => {
    useStore.getState().upsertDeck(deck);
    useStore.getState().setDecks([]);
    useStore.getState().setDecks([{ id: "d1" } as never]);
    expect(useStore.getState().deckNotFound.d1).toBeUndefined();
  });
});
