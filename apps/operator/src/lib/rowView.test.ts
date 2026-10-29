import { describe, expect, it, vi } from "vitest";
import type { Section, Show, Song, Template } from "@overlaysys/core";

const slidesMock = vi.fn();
vi.mock("./slidesRowView", () => ({ slidesRowViewFor: (...a: unknown[]) => slidesMock(...a) }));

import { rowView, sectionShortLabel, type RowViewCtx } from "./rowView";

const template = {
  id: "t1",
  name: "Section Intro",
  fields: [
    { key: "logo", label: "Logo", type: "image" },
    { key: "bg", label: "Bg", type: "color" },
    { key: "title", label: "Title", type: "text" },
    { key: "subtitle", label: "Subtitle", type: "text" },
  ],
} as unknown as Template;

const sec = (id: string, kind: Section["kind"]): Section => ({ id, kind, label: id, slides: [{ id: "s", lines: ["x"] }] });

const song = (sections: Section[], defaultArrangement: string[]): Song =>
  ({ id: "so1", title: "Song One", sections, defaultArrangement, customFields: {} }) as unknown as Song;

const ctx = (o: Partial<RowViewCtx> = {}): RowViewCtx => ({
  show: { id: "sh", name: "S", projectId: "p", rows: [], songs: [] } as unknown as Show,
  songs: [{ id: "so1", title: "Song One" }] as RowViewCtx["songs"],
  songCache: {},
  templates: [{ id: "t1", name: "Section Intro" }] as RowViewCtx["templates"],
  templateCache: { t1: template },
  overrides: {},
  deckCache: {},
  ...o,
});

const gfx = (data: Record<string, string>) => ({ kind: "graphic", id: "r1", templateId: "t1", data }) as never;
const songRow = (extra: object = {}) => ({ kind: "song", id: "r2", songId: "so1", lyricTemplateId: "t1", ...extra }) as never;

describe("rowView", () => {
  it("graphic title is the first text field value, template name is the tag [D19]", () => {
    expect(rowView(gfx({ title: "Welcome placeholder", subtitle: "Second line" }), ctx())).toMatchObject({
      kind: "graphic",
      title: "Welcome placeholder",
      detail: "Second line",
      tag: "Section Intro",
    });
  });
  it("graphic title skips image/colour fields and data URLs", () => {
    const v = rowView(gfx({ logo: "data:image/png;base64,AA", bg: "#fff", title: "data:x", subtitle: "Name" }), ctx());
    expect(v.title).toBe("Name");
    expect(rowView(gfx({ logo: "/assets/a.png", title: "Real" }), ctx()).title).toBe("Real");
  });
  it("graphic with no field values falls back to the template name", () => {
    expect(rowView(gfx({}), ctx()).title).toBe("Section Intro");
  });
  it("session overrides change the graphic title", () => {
    expect(rowView(gfx({ title: "Saved" }), ctx({ overrides: { r1: { title: "Edited" } } })).title).toBe("Edited");
  });
  it("song row shows section chips V1 V2 V3 +5", () => {
    const secs = Array.from({ length: 8 }, (_, i) => sec(`v${i}`, "verse"));
    const s = song(secs, secs.map((x) => x.id));
    expect(rowView(songRow(), ctx({ songCache: { so1: s } }))).toMatchObject({
      kind: "song",
      title: "Song One",
      chips: ["V1", "V2", "V3"],
      moreChips: 5,
    });
  });
  it("song before it is cached has no chips and a default arrangement detail", () => {
    expect(rowView(songRow(), ctx())).toMatchObject({ chips: [], detail: "Default arrangement" });
  });
  it("repeated chorus gets C then C2 only for a different chorus section", () => {
    const secs = [sec("c1", "chorus"), sec("c2", "chorus")];
    expect(sectionShortLabel(secs[0]!, secs)).toBe("C");
    expect(sectionShortLabel(secs[1]!, secs)).toBe("C2");
    const s = song(secs, ["c1", "c1"]);
    expect(rowView(songRow(), ctx({ songCache: { so1: s } })).chips).toEqual(["C", "C"]);
  });
  it("section short labels for the other kinds", () => {
    const secs = [sec("b", "bridge"), sec("t", "tag"), sec("i", "intro"), sec("o", "outro"), sec("x", "other")];
    expect(secs.map((s) => sectionShortLabel(s, secs))).toEqual(["B", "T", "I", "O", "X"]);
  });
  it("scripture detail is the abbreviation, else the id upper-cased [LIVE-23]", () => {
    const base = { kind: "scripture", id: "s", reference: "John 3:16", translation: "kjv" };
    expect(rowView({ ...base, translationAbbreviation: "NIV" } as never, ctx()).detail).toBe("NIV");
    expect(rowView(base as never, ctx())).toMatchObject({ title: "John 3:16", detail: "KJV" });
  });
  it("video detail is its length", () => {
    expect(rowView({ kind: "video", id: "v", assetUrl: "/assets/a/b.mp4", durationSec: 32 } as never, ctx())).toMatchObject({
      kind: "video",
      title: "b.mp4",
      detail: "0:32",
    });
  });
  it("an unknown kind renders as unsupported, never throws", () => {
    expect(rowView({ kind: "future", id: "x" }, ctx())).toMatchObject({ supported: false, title: "Unsupported item" });
  });
  it("a slides row with no adapter view renders a placeholder", () => {
    slidesMock.mockReturnValueOnce(null);
    expect(rowView({ kind: "slides", id: "x" }, ctx())).toMatchObject({
      kind: "slides",
      title: "Slides deck",
      detail: "Needs Slides decks",
      supported: false,
    });
  });
  it("a slides row uses the adapter view when it returns one", () => {
    slidesMock.mockReturnValueOnce({ title: "Gloria", detail: "3 slides", missingDeck: false, missingSlides: 0 });
    expect(rowView({ kind: "slides", id: "x", deckId: "d" }, ctx())).toMatchObject({
      title: "Gloria",
      detail: "3 slides",
      supported: true,
      warning: null,
    });
    slidesMock.mockReturnValueOnce({ title: "Missing deck", detail: "x", missingDeck: true, missingSlides: 0 });
    expect(rowView({ kind: "slides", id: "x", deckId: "d" }, ctx()).supported).toBe(false);
  });
  it("a deck the server reported not found is passed as missing (null), not still loading", () => {
    slidesMock.mockReturnValueOnce({ title: "Missing deck", detail: "x", missingDeck: true, missingSlides: 0 });
    rowView({ kind: "slides", id: "x", deckId: "d" }, ctx({ deckNotFound: { d: true } }));
    expect(slidesMock).toHaveBeenLastCalledWith(expect.anything(), null);
    slidesMock.mockReturnValueOnce({ title: "Slides deck", detail: "Loading…", missingDeck: false, missingSlides: 0 });
    rowView({ kind: "slides", id: "x", deckId: "d" }, ctx());
    expect(slidesMock).toHaveBeenLastCalledWith(expect.anything(), undefined);
  });
  it("a slides row with some slides missing exposes a warning", () => {
    slidesMock.mockReturnValueOnce({ title: "Gloria", detail: "1 of 3 slides", missingDeck: false, missingSlides: 2 });
    expect(rowView({ kind: "slides", id: "x", deckId: "d" }, ctx()).warning).toBe("2 slides no longer in the deck");
  });
});
