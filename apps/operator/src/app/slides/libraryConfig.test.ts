import { describe, expect, it, vi } from "vitest";
import type { DeckMeta } from "@overlaysys/core";
import {
  DEFAULT_DECK_SORT,
  buildNewDeck,
  deckColumns,
  deckDeleteConfirm,
  deckFilters,
  deckMenuItems,
  deckSorts,
  defaultDeckTemplateId,
  licensingLabel,
  newDeckBlocker,
} from "./libraryConfig";

const meta = (o: Partial<DeckMeta> & { id: string }): DeckMeta => ({
  name: o.id,
  tags: [],
  slideCount: 1,
  licensing: "own",
  usedBy: 0,
  createdAt: "2026-10-01T10:00:00.000Z",
  ...o,
});

const a = meta({ id: "a", name: "Benediction", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" });
const b = meta({ id: "b", name: "announcements", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", licensing: "ccli", tags: ["Weekly"] });
const c = meta({ id: "c", name: "Creed", createdAt: "2026-10-10T00:00:00.000Z", licensing: "public-domain", tags: ["Liturgy", "Weekly"] });

const order = (id: string) => [a, b, c].sort(deckSorts.find((s) => s.id === id)!.compare).map((d) => d.id);

describe("deckSorts", () => {
  it("has name-asc (default), edited-desc and added-desc", () => {
    expect(deckSorts.map((s) => s.id)).toEqual(["name-asc", "edited-desc", "added-desc"]);
    expect(DEFAULT_DECK_SORT).toBe("name-asc");
  });
  it("name-asc ignores case", () => {
    expect(order("name-asc")).toEqual(["b", "a", "c"]);
  });
  it("edited-desc uses updatedAt, falling back to createdAt", () => {
    expect(order("edited-desc")).toEqual(["b", "c", "a"]);
  });
  it("added-desc uses createdAt", () => {
    expect(order("added-desc")).toEqual(["c", "a", "b"]);
  });
});

describe("deckFilters", () => {
  it("licensing filter matches each kind; labels read as 'All <label>'", () => {
    const lic = deckFilters([a, b, c]).find((f) => f.id === "licensing")!;
    expect(lic.label).toBe("licences");
    expect(lic.options.map((o) => o.value)).toEqual(["ccli", "public-domain", "own"]);
    expect([a, b, c].filter((d) => lic.test(d, "ccli")).map((d) => d.id)).toEqual(["b"]);
    expect([a, b, c].filter((d) => lic.test(d, "public-domain")).map((d) => d.id)).toEqual(["c"]);
    expect([a, b, c].filter((d) => lic.test(d, "own")).map((d) => d.id)).toEqual(["a"]);
  });
  it("tag filter lists every tag once, sorted, and matches decks with that tag", () => {
    const tag = deckFilters([a, b, c]).find((f) => f.id === "tag")!;
    expect(tag.label).toBe("tags");
    expect(tag.options.map((o) => o.value)).toEqual(["Liturgy", "Weekly"]);
    expect([a, b, c].filter((d) => tag.test(d, "Weekly")).map((d) => d.id)).toEqual(["b", "c"]);
  });
  it("no tag filter when no deck has a tag", () => {
    expect(deckFilters([a]).map((f) => f.id)).toEqual(["licensing"]);
  });
});

describe("licensingLabel and columns", () => {
  it("maps each kind to its label", () => {
    expect(licensingLabel).toEqual({ ccli: "CCLI", "public-domain": "Public domain", own: "Own" });
  });
  it("columns are Slides, Licensing, Tags, Edited", () => {
    expect(deckColumns.map((col) => col.label)).toEqual(["Slides", "Licensing", "Tags", "Edited"]);
    const render = (id: string, d: DeckMeta) => deckColumns.find((col) => col.id === id)!.render(d);
    expect(render("slides", meta({ id: "x", slideCount: 7 }))).toBe(7);
    expect(render("licensing", b)).toBe("CCLI");
    expect(render("tags", c)).toBe("Liturgy, Weekly");
  });
});

describe("deckMenuItems", () => {
  it("Open, Duplicate, Rename, Delete; Delete is danger and calls its action", () => {
    const actions = { open: vi.fn(), duplicate: vi.fn(), rename: vi.fn(), delete: vi.fn() };
    const items = deckMenuItems(a, actions);
    const real = items.filter((i): i is Extract<typeof i, { id: string }> => "id" in i);
    expect(real.map((i) => i.label)).toEqual(["Open", "Duplicate", "Rename…", "Delete…"]);
    const del = real.find((i) => i.id === "delete")!;
    expect(del.danger).toBe(true);
    del.onSelect();
    expect(actions.delete).toHaveBeenCalledWith(a);
  });
});

describe("deckDeleteConfirm", () => {
  it("asks only when the deck is used", () => {
    expect(deckDeleteConfirm(a)).toBeNull();
    const used = deckDeleteConfirm(meta({ id: "u", name: "Prayer", usedBy: 2 }))!;
    expect(used).toEqual({
      title: "Delete deck?",
      message: '"Prayer" is used in 2 show(s). Those rows will show "Missing deck" until you restore it.',
      confirmLabel: "Delete",
      danger: true,
    });
  });
});

describe("new deck", () => {
  it("needs a name and a licensing answer", () => {
    expect(newDeckBlocker("", { kind: "own" })).toBe("Name the deck");
    expect(newDeckBlocker("  ", { kind: "own" })).toBe("Name the deck");
    expect(newDeckBlocker("Deck", null)).toBe("Choose the licensing");
    expect(newDeckBlocker("Deck", { kind: "ccli" })).toBeNull();
  });
  it("default template: suggested lyric template first, else any template", () => {
    const t = (id: string, name: string) => ({ id, name });
    expect(defaultDeckTemplateId([t("g", "Lower Third"), t("l", "Lyric — Default")])).toBe("l");
    expect(defaultDeckTemplateId([t("g", "Lower Third")])).toBe("g");
    expect(defaultDeckTemplateId([])).toBeUndefined();
  });
  it("builds a deck with one empty slide, trimmed name, blank CCLI number dropped", () => {
    const d = buildNewDeck({
      name: "  Call to worship ",
      licensing: { kind: "ccli", ccliNumber: "  " },
      templateId: "lyric-default",
      deckId: "deck-1",
      slideId: "s-1",
      now: "2026-10-28T09:00:00.000Z",
    });
    expect(d).toEqual({
      id: "deck-1",
      name: "Call to worship",
      tags: [],
      defaultTemplateId: "lyric-default",
      licensing: { kind: "ccli" },
      slides: [{ id: "s-1", data: {} }],
      createdAt: "2026-10-28T09:00:00.000Z",
    });
    expect(
      buildNewDeck({ name: "X", licensing: { kind: "ccli", ccliNumber: " 123 " }, templateId: "t", deckId: "d", slideId: "s", now: "n" })
        .licensing,
    ).toEqual({ kind: "ccli", ccliNumber: "123" });
  });
});
