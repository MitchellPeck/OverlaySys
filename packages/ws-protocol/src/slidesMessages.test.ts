import { describe, expect, it } from "vitest";
import { ClientMessageSchema, ServerMessageSchema } from "./index";

const deck = {
  id: "d1",
  name: "Deck",
  tags: [],
  defaultTemplateId: "t",
  licensing: { kind: "own" },
  slides: [{ id: "s1", data: { text: "Line A" } }],
  createdAt: "2026-10-28T00:00:00.000Z",
};

describe("slides client messages", () => {
  const ok: unknown[] = [
    { type: "list_decks" },
    { type: "get_deck", deckId: "d1" },
    { type: "save_deck", deck },
    { type: "delete_deck", deckId: "d1" },
    { type: "restore_deck", deckId: "d1" },
    { type: "duplicate_deck", deckId: "d1" },
    { type: "slides_take", showId: "s", rowId: "r", slideIdx: 2, channel: "program" },
    { type: "slides_advance", channel: "program", delta: 1 },
    { type: "slides_advance", channel: "program", delta: -1 },
    { type: "slides_goto", channel: "program", slideIdx: 0 },
    { type: "slides_blank", channel: "program" },
    { type: "slides_end", channel: "program" },
    { type: "convert_song_to_deck", songId: "x", titleSlide: true, licensing: { kind: "ccli" } },
    { type: "undo_convert_song", conversionId: "c1" },
  ];
  it.each(ok)("decodes %j", (m) => {
    expect(ClientMessageSchema.safeParse(m).success).toBe(true);
  });
  it("rejects bad delta and negative slideIdx", () => {
    expect(ClientMessageSchema.safeParse({ type: "slides_advance", channel: "p", delta: 2 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "slides_goto", channel: "p", slideIdx: -1 }).success).toBe(false);
  });
  it("slides_take without slideIdx leaves it undefined", () => {
    const r = ClientMessageSchema.parse({ type: "slides_take", showId: "s", rowId: "r" });
    expect(r.type === "slides_take" && r.slideIdx).toBeUndefined();
  });
});

describe("slides server messages", () => {
  it.each([
    { type: "deck_list", decks: [{ id: "d1", name: "D", tags: [], slideCount: 1, licensing: "own", usedBy: 0, createdAt: "x" }] },
    { type: "deck", deck },
    { type: "song_converted", conversionId: "c", deckId: "d", deckName: "D", rows: 1, shows: 1, warnings: [] },
    { type: "song_convert_undone", conversionId: "c", songId: "s", restoredShows: 1, skippedShows: 0 },
  ])("decodes %j", (m) => {
    expect(ServerMessageSchema.safeParse(m).success).toBe(true);
  });
});
