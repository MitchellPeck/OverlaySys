import { describe, expect, it } from "vitest";
import type { Deck } from "@overlaysys/core";
import type { RowLike } from "./rowLike";
import { rowCanFire } from "../app/components/rundown/rundownModel";
import { slidesControlState, slidesRowViewFor } from "./slidesRowView";

const row: RowLike = { kind: "slides", id: "r1", deckId: "d1" };
const deck = (o: object = {}): Deck =>
  ({
    id: "d1",
    name: "Deck A",
    tags: [],
    defaultTemplateId: "t1",
    licensing: { kind: "own" },
    slides: [{ id: "a", data: { text: "x" } }],
    createdAt: "2026-01-01",
    ...o,
  }) as Deck;

describe("slidesControlState (header Cue / Take)", () => {
  it("enabled for a loaded deck with slides", () => {
    expect(slidesControlState(row, { deckCache: { d1: deck() } })).toEqual({ enabled: true });
  });

  it("disabled with the Missing deck tooltip when not found or deleted", () => {
    const t = { enabled: false, title: "Missing deck — restore it from Slides" };
    expect(slidesControlState(row, { deckCache: {}, deckNotFound: { d1: true } })).toEqual(t);
    expect(slidesControlState(row, { deckCache: { d1: deck({ deletedAt: "x" }) } })).toEqual(t);
  });

  it("disabled, without the missing-deck tooltip, while the deck loads", () => {
    expect(slidesControlState(row, { deckCache: {} })).toEqual({ enabled: false });
  });

  it("Enter / Space follow the same rule (rowCanFire) for a missing deck", () => {
    const view = slidesRowViewFor(row, null);
    expect(rowCanFire(row, "take", { supported: !view!.missingDeck, slidesView: view })).toBe(false);
    expect(rowCanFire(row, "cue", { supported: !view!.missingDeck, slidesView: view })).toBe(false);
  });
});
