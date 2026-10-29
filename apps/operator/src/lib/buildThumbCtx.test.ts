import { describe, expect, it } from "vitest";
import { rowView } from "./rowView";
import { buildThumbCtx } from "./buildThumbCtx";

const show = { id: "sh", name: "S", projectId: "p", rows: [], songs: [] } as never;
const parts = (o: object = {}) => ({
  show,
  songs: [],
  songCache: {},
  templates: [],
  templateCache: {},
  overrides: {},
  deckCache: {},
  channelStates: {},
  songSessions: {},
  ...o,
});

describe("buildThumbCtx", () => {
  it("is null without a show", () => {
    expect(buildThumbCtx(parts({ show: null }))).toBeNull();
  });

  it("carries deckNotFound, so the ItemBar header says Missing deck, not Loading", () => {
    const ctx = buildThumbCtx(parts({ deckNotFound: { d1: true } }))!;
    expect(ctx.deckNotFound).toEqual({ d1: true });
    const v = rowView({ kind: "slides", id: "r", deckId: "d1" } as never, ctx);
    expect(v.title).toBe("Missing deck");
    expect(v.detail).not.toMatch(/Loading/);
  });

  it("still Loading while the deck is neither cached nor known missing", () => {
    const ctx = buildThumbCtx(parts())!;
    expect(rowView({ kind: "slides", id: "r", deckId: "d1" } as never, ctx).detail).toBe("Loading…");
  });
});
