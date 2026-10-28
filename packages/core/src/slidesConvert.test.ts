import { describe, expect, it } from "vitest";
import type { ShowSong, SongRow } from "./show";
import type { Song } from "./song";
import type { Template } from "./template";
import { convertedDeckId, deckFromSong, isUpcomingShow, songRowToSlidesRow } from "./slidesConvert";

// Placeholder lyrics only.
const song: Song = {
  id: "song-1",
  title: "Placeholder Song",
  ccliNumber: "123",
  defaultLyricTemplateId: "lyric-t",
  sections: [
    {
      id: "v1",
      kind: "verse",
      label: "Verse 1",
      slides: [
        { id: "v1a", lines: ["Line A1", "Line A2"] },
        { id: "v1b", lines: ["Line B1"] },
      ],
    },
    { id: "c", kind: "chorus", label: "Chorus", slides: [{ id: "c1", lines: ["Chorus line"] }] },
    { id: "v2", kind: "verse", label: "Verse 2", slides: [{ id: "v2a", lines: ["Line C1"] }] },
  ],
  defaultArrangement: ["v1", "c", "c"],
  customFields: {},
};

function idGen(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

const opts = () => ({ id: "deck-1", now: "2026-10-28T00:00:00.000Z", newId: idGen() });

describe("deckFromSong", () => {
  it("builds slides in play order with labels; repeats get new ids; first-occurrence map", () => {
    const { deck, sectionSlideIds, droppedSections } = deckFromSong(song, opts());
    expect(deck.name).toBe("Placeholder Song");
    expect(deck.slides.map((s) => s.label)).toEqual(["Verse 1", "Verse 1", "Chorus", "Chorus"]);
    expect(deck.slides.map((s) => s.data.text)).toEqual(["Line A1\nLine A2", "Line B1", "Chorus line", "Chorus line"]);
    expect(new Set(deck.slides.map((s) => s.id)).size).toBe(4);
    expect(sectionSlideIds.v1).toEqual(["s1", "s2"]);
    expect(sectionSlideIds.c).toHaveLength(1);
    expect(sectionSlideIds.c).toEqual(["s3"]);
    expect(droppedSections).toEqual(["Verse 2"]);
    expect(deck.licensing).toEqual({ kind: "ccli", ccliNumber: "123" });
    expect(deck.convertedFromSongId).toBe(song.id);
    expect(deck.defaultTemplateId).toBe("lyric-t");
    expect(deck.createdAt).toBe("2026-10-28T00:00:00.000Z");
  });

  it("licensing falls back to public domain; template falls back to the given first template", () => {
    const { ccliNumber: _c, defaultLyricTemplateId: _t, ...bare } = song;
    void _c;
    void _t;
    const { deck } = deckFromSong(bare as Song, { ...opts(), fallbackTemplateId: "first-t" });
    expect(deck.licensing).toEqual({ kind: "public-domain" });
    expect(deck.defaultTemplateId).toBe("first-t");
  });

  it("uses explicit licensing when given", () => {
    const { deck } = deckFromSong(song, { ...opts(), licensing: { kind: "own" } });
    expect(deck.licensing).toEqual({ kind: "own" });
  });

  it("prepends a title slide when asked", () => {
    const { deck, sectionSlideIds } = deckFromSong(song, {
      ...opts(),
      titleSlide: { templateId: "intro-t", data: { title: "Placeholder Song" } },
    });
    expect(deck.slides).toHaveLength(5);
    expect(deck.slides[0]).toMatchObject({ templateId: "intro-t", data: { title: "Placeholder Song" } });
    expect(deck.slides.slice(1).map((s) => s.label)).toEqual(["Verse 1", "Verse 1", "Chorus", "Chorus"]);
    expect(sectionSlideIds.v1).not.toContain(deck.slides[0]!.id);
  });
});

describe("songRowToSlidesRow", () => {
  const { deck, sectionSlideIds } = deckFromSong(song, opts());
  const base: SongRow = {
    kind: "song",
    id: "row-1",
    songId: song.id,
    lyricTemplateId: "lyric-t",
    sectionId: "sec-a",
    channelHint: "program",
    notes: "a note",
    lengthSec: 240,
    lengthSecManual: true,
    sourceRef: { provider: "pco", serviceTypeId: "st", planId: "p", itemId: "i" },
  };

  it("keeps id, sourceRef, sectionId and length; default arrangement gives no slideIds or templateId", () => {
    const { row, warning } = songRowToSlidesRow(base, undefined, song, deck, sectionSlideIds);
    expect(row).toEqual({
      kind: "slides",
      id: "row-1",
      deckId: "deck-1",
      sectionId: "sec-a",
      channelHint: "program",
      notes: "a note",
      lengthSec: 240,
      lengthSecManual: true,
      sourceRef: { provider: "pco", serviceTypeId: "st", planId: "p", itemId: "i" },
    });
    expect(warning).toBeUndefined();
  });

  it("maps a custom arrangement and sets a non-default template", () => {
    const { row } = songRowToSlidesRow(
      { ...base, lyricTemplateId: "other-t", arrangement: ["c", "v1"] },
      undefined,
      song,
      deck,
      sectionSlideIds,
    );
    expect(row.templateId).toBe("other-t");
    expect(row.slideIds).toEqual(["s3", "s1", "s2"]);
  });

  it("uses the show's arrangement when the row has none", () => {
    const showSong: ShowSong = { songId: song.id, arrangement: ["c"] };
    const { row } = songRowToSlidesRow(base, showSong, song, deck, sectionSlideIds);
    expect(row.slideIds).toEqual(["s3"]);
  });

  it("pins the resolved song channel when the row has no channelHint", () => {
    const { channelHint: _h, ...noHint } = base;
    void _h;
    const viaSong = songRowToSlidesRow(noHint, undefined, { ...song, defaultChannel: "lower" }, deck, sectionSlideIds);
    expect(viaSong.row.channelHint).toBe("lower");
    const viaShow = songRowToSlidesRow(
      noHint,
      { songId: song.id, channelOverride: "side" },
      { ...song, defaultChannel: "lower" },
      deck,
      sectionSlideIds,
    );
    expect(viaShow.row.channelHint).toBe("side");
    const viaTemplate = songRowToSlidesRow(noHint, undefined, song, deck, sectionSlideIds, {
      defaultChannel: "tpl-ch",
    } as Template);
    expect(viaTemplate.row.channelHint).toBe("tpl-ch");
    const none = songRowToSlidesRow(noHint, undefined, song, deck, sectionSlideIds);
    expect(none.row.channelHint).toBeUndefined();
  });

  it("warns on an unmapped section", () => {
    const { row, warning } = songRowToSlidesRow(
      { ...base, arrangement: ["v1", "v2"] },
      undefined,
      song,
      deck,
      sectionSlideIds,
    );
    expect(row.slideIds).toEqual(["s1", "s2"]);
    expect(warning).toBe('Section "Verse 2" isn\'t in the deck; skipped');
  });
});

describe("isUpcomingShow", () => {
  it("today and later and undated are upcoming; yesterday is not", () => {
    const today = "2026-10-28";
    expect(isUpcomingShow({ name: "x", scheduledFor: "2026-10-28" }, today)).toBe(true);
    expect(isUpcomingShow({ name: "x", scheduledFor: "2026-11-01" }, today)).toBe(true);
    expect(isUpcomingShow({ name: "Sunday 11/1/26" }, today)).toBe(true);
    expect(isUpcomingShow({ name: "No date" }, today)).toBe(true);
    expect(isUpcomingShow({ name: "x", scheduledFor: "2026-10-27" }, today)).toBe(false);
    expect(isUpcomingShow({ name: "Sunday 10/27/26" }, today)).toBe(false);
  });
});

describe("convertedDeckId", () => {
  it("reads customFields.converted_to_deck", () => {
    expect(convertedDeckId({ customFields: { converted_to_deck: "deck-9" } })).toBe("deck-9");
    expect(convertedDeckId({ customFields: {} })).toBeNull();
  });
});
