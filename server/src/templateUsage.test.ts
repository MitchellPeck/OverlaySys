import { describe, expect, it } from "vitest";
import { templateUsage, type TemplateUsageInput } from "./templateUsage";

const base = (): TemplateUsageInput => ({
  shows: [
    { id: "s1", name: "Sunday", rows: [{ kind: "graphic", id: "r1", templateId: "lt" } as never], songs: [] },
    {
      id: "s2",
      name: "Wednesday",
      rows: [{ kind: "song", id: "r2", songId: "x", lyricTemplateId: "lyric-default" } as never],
      songs: [],
    },
  ],
  hotcards: [{ id: "h1", name: "Welcome", templateId: "lt" }],
  songs: [],
  scripture: {},
});

describe("templateUsage", () => {
  it("lists shows and hotcards using a template", () => {
    const u = templateUsage("lt", base());
    expect(u.shows).toEqual([{ id: "s1", name: "Sunday" }]);
    expect(u.hotcards).toEqual([{ id: "h1", name: "Welcome" }]);
    expect(u.protected).toBe(false);
  });
  it("marks the built-in lyric template protected", () => {
    const u = templateUsage("lyric-default", base());
    expect(u.protected).toBe(true);
    expect(u.shows.map((s) => s.id)).toEqual(["s2"]);
  });
  it("counts a ShowSong override", () => {
    const input = base();
    input.shows = [{ id: "s3", name: "Special", rows: [], songs: [{ songId: "x", lyricTemplateId: "lt" }] }];
    expect(templateUsage("lt", input).shows).toEqual([{ id: "s3", name: "Special" }]);
  });
  it("ignores tombstoned shows, hotcards and songs", () => {
    const input = base();
    input.shows = input.shows.map((s) => ({ ...s, deletedAt: "2026-01-01" }));
    input.hotcards = input.hotcards.map((h) => ({ ...h, deletedAt: "2026-01-01" }));
    input.songs = [{ id: "a", title: "A", defaultLyricTemplateId: "lt", deletedAt: "2026-01-01" }];
    const u = templateUsage("lt", input);
    expect(u.shows).toEqual([]);
    expect(u.hotcards).toEqual([]);
    expect(u.songs).toEqual([]);
  });
  it("covers song defaults, scripture rows and scripture settings", () => {
    const input = base();
    input.songs = [{ id: "a", title: "A", defaultIntroTemplateId: "lt" }];
    input.shows = [
      { id: "s4", name: "Verse", rows: [{ kind: "scripture", id: "r", templateId: "lt" } as never], songs: [] },
    ];
    input.scripture = { introTemplateId: "lt" };
    const u = templateUsage("lt", input);
    expect(u.songs).toEqual([{ id: "a", title: "A" }]);
    expect(u.shows).toEqual([{ id: "s4", name: "Verse" }]);
    expect(u.scriptureDefault).toBe(true);
  });

  describe("decks", () => {
    const deck = (over: object = {}) => ({ id: "d1", name: "Welcome deck", defaultTemplateId: "x", slides: [], ...over });
    const slidesShow = (row: object) => ({
      id: "s9",
      name: "Deck show",
      rows: [{ kind: "slides", id: "r", ...row } as never],
      songs: [],
    });
    it("counts a slides row's localSlides template", () => {
      const input = { ...base(), shows: [slidesShow({ localSlides: [{ id: "a", templateId: "lt", data: {} }] })] };
      expect(templateUsage("lt", input).shows).toEqual([{ id: "s9", name: "Deck show" }]);
    });
    it("counts a referenced deck's slide template and lists the deck", () => {
      const d = deck({ slides: [{ id: "a", templateId: "lt", data: {} }] });
      const input = { ...base(), shows: [slidesShow({ deckId: "d1" })], decks: [d] };
      const u = templateUsage("lt", input);
      expect(u.shows).toEqual([{ id: "s9", name: "Deck show" }]);
      expect(u.decks).toEqual([{ id: "d1", name: "Welcome deck" }]);
    });
    it("counts a deck defaultTemplateId, and lists unused-by-shows decks", () => {
      const input = { ...base(), shows: [slidesShow({ deckId: "d1" })], decks: [deck({ defaultTemplateId: "lt" })] };
      expect(templateUsage("lt", input).shows).toHaveLength(1);
      expect(templateUsage("lt", { ...base(), decks: [deck({ defaultTemplateId: "lt" })] }).decks).toHaveLength(1);
    });
    it("ignores tombstoned decks", () => {
      const input = { ...base(), shows: [slidesShow({ deckId: "d1" })], decks: [deck({ defaultTemplateId: "lt", deletedAt: "2026-01-01" })] };
      expect(templateUsage("lt", input).shows).toEqual([]);
      expect(templateUsage("lt", input).decks).toEqual([]);
    });
  });
});
