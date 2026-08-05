import { describe, it, expect } from "vitest";
import { SongSchema, type Song } from "../song";
import {
  PCO_ARRANGEMENT_ID_KEY,
  PCO_SONG_ID_KEY,
  buildGraphicRow,
  buildImportedSong,
  buildItemPreview,
  buildSongRow,
  effectiveLyricsArrangement,
  ensureShowSongEntry,
  listPcoItemFieldDescriptors,
  makeSourceRef,
  mapPcoItemFields,
  matchLibrarySong,
  pcoItemGraphicDefaults,
  pickLyricsArrangement,
  reorderArrangementBySequence,
  resolveImportedSongId,
} from "./mapPlanItems";
import type { PcoArrangement, PcoPlanItem, PcoSong } from "./pcoTypes";

function song(partial: Partial<Song> & { id: string; title: string }): Song {
  return SongSchema.parse({
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["x"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
    ...partial,
  });
}

const pcoSong: PcoSong = {
  id: "pco-123",
  title: "Amazing Grace",
  ccliNumber: "22025",
  author: "John Newton",
};

describe("matchLibrarySong", () => {
  it("matches by stored pco_song_id first", () => {
    const lib = [
      song({ id: "amazing-grace", title: "Amazing Grace", ccliNumber: "22025" }),
      song({ id: "other", title: "Amazing Grace", customFields: { [PCO_SONG_ID_KEY]: "pco-123" } }),
    ];
    const m = matchLibrarySong(pcoSong, lib);
    expect(m?.confidence).toBe("pco-id");
    expect(m?.song.id).toBe("other");
  });

  it("matches by CCLI when no pco id link exists", () => {
    const lib = [song({ id: "amazing-grace", title: "AG", ccliNumber: "22025" })];
    expect(matchLibrarySong(pcoSong, lib)?.confidence).toBe("ccli");
  });

  it("matches by title slug as a last resort", () => {
    const lib = [song({ id: "amazing-grace", title: "Amazing Grace" })];
    expect(matchLibrarySong({ id: "p", title: "Amazing Grace" }, lib)?.confidence).toBe("title");
  });

  it("ignores soft-deleted songs and returns null when nothing matches", () => {
    const lib = [song({ id: "amazing-grace", title: "Amazing Grace", ccliNumber: "22025", deletedAt: "2026-01-01" })];
    expect(matchLibrarySong(pcoSong, lib)).toBeNull();
  });
});

describe("resolveImportedSongId", () => {
  it("uses the title slug when free", () => {
    expect(resolveImportedSongId(pcoSong, new Set())).toBe("amazing-grace");
  });
  it("suffixes on collision", () => {
    expect(resolveImportedSongId(pcoSong, new Set(["amazing-grace", "amazing-grace-2"]))).toBe("amazing-grace-3");
  });
});

describe("reorderArrangementBySequence", () => {
  const sections = [
    { id: "v1", kind: "verse" as const, label: "Verse 1", slides: [{ id: "a", lines: ["x"] }] },
    { id: "c1", kind: "chorus" as const, label: "Chorus", slides: [{ id: "b", lines: ["y"] }] },
  ];
  it("orders by sequence labels, case-insensitively, allowing repeats", () => {
    expect(reorderArrangementBySequence(sections, ["Chorus", "verse 1", "CHORUS"])).toEqual(["c1", "v1", "c1"]);
  });
  it("falls back to section order when sequence is empty or unmatched", () => {
    expect(reorderArrangementBySequence(sections, [])).toEqual(["v1", "c1"]);
    expect(reorderArrangementBySequence(sections, ["Interlude"])).toEqual(["v1", "c1"]);
  });
});

describe("buildImportedSong", () => {
  it("builds a song with lyrics, ccli, and pco custom fields", () => {
    const { song: s, warnings } = buildImportedSong(
      "amazing-grace",
      pcoSong,
      { id: "arr-1", lyrics: "Verse 1\nAmazing grace\n\nChorus\nMy chains", sequence: ["Chorus", "Verse 1"] },
    );
    expect(warnings).toHaveLength(0);
    expect(s.ccliNumber).toBe("22025");
    expect(s.author).toBe("John Newton");
    expect(s.customFields[PCO_SONG_ID_KEY]).toBe("pco-123");
    expect(s.customFields[PCO_ARRANGEMENT_ID_KEY]).toBe("arr-1");
    expect(s.sections.map((x) => x.kind)).toEqual(["verse", "chorus"]);
    expect(s.defaultArrangement).toEqual(["c1", "v1"]);
    expect(() => SongSchema.parse(s)).not.toThrow();
  });

  it("emits a stub + warning when the arrangement has no lyrics", () => {
    const { song: s, warnings } = buildImportedSong("x", pcoSong, { id: "arr-2", lyrics: "" });
    expect(warnings).toHaveLength(1);
    expect(s.sections).toHaveLength(1);
    expect(() => SongSchema.parse(s)).not.toThrow();
  });
});

describe("mapPcoItemFields", () => {
  const fullItem: PcoPlanItem = {
    id: "item-1",
    title: "Amazing Grace",
    itemType: "song",
    description: "Band only",
    htmlDetails: "<p>Key of <b>G</b></p>",
    song: { id: "pco-123", title: "Amazing Grace (Live)", author: "John Newton", ccliNumber: "22025", copyright: "Public Domain" },
    arrangement: { id: "arr-1", name: "Sunday Arrangement", lyrics: "Verse 1\nx" },
  };

  it("lists only the descriptors the item actually carries", () => {
    const bare: PcoPlanItem = { id: "i", title: "Welcome", itemType: "header" };
    expect(listPcoItemFieldDescriptors(bare).map((d) => d.key)).toEqual(["title"]);
    expect(listPcoItemFieldDescriptors(fullItem).map((d) => d.key)).toEqual([
      "title", "description", "details", "song_title", "author", "ccli", "copyright", "arrangement",
    ]);
  });

  it("fills template fields whose key matches a PCO field exactly", () => {
    const data = mapPcoItemFields(fullItem, [
      { key: "title", label: "Headline", type: "text" },
      { key: "author", label: "By", type: "text" },
    ]);
    expect(data).toEqual({ title: "Amazing Grace", author: "John Newton" });
  });

  it("falls back to label similarity when keys differ", () => {
    const data = mapPcoItemFields(fullItem, [{ key: "line1", label: "Copyright", type: "text" }]);
    expect(data["line1"]).toBe("Public Domain");
  });

  it("seeds the first text field with the item title when nothing else claims it", () => {
    const data = mapPcoItemFields(
      { id: "i", title: "Welcome & Offering", itemType: "header" },
      [{ key: "line1", label: "Top Line", type: "text" }, { key: "line2", label: "Bottom Line", type: "text" }],
    );
    expect(data).toEqual({ line1: "Welcome & Offering" });
  });

  it("never writes into non-text template fields", () => {
    const data = mapPcoItemFields(fullItem, [
      { key: "title", label: "Title", type: "image" },
      { key: "author", label: "Author", type: "color" },
    ]);
    expect(data).toEqual({});
  });

  it("strips html from details", () => {
    const data = mapPcoItemFields(fullItem, [{ key: "details", label: "Details", type: "text" }]);
    expect(data["details"]).toBe("Key of G");
  });
});

describe("row + showsong builders", () => {
  const ref = makeSourceRef("st-1", "plan-1", "item-1");

  it("builds a song row with source ref", () => {
    const row = buildSongRow({ rowId: "r1", songId: "amazing-grace", lyricTemplateId: "tpl-lyric", sourceRef: ref });
    expect(row).toMatchObject({ kind: "song", songId: "amazing-grace", sourceRef: ref });
  });

  it("builds a graphic row from explicit data + notes", () => {
    const row = buildGraphicRow({ rowId: "r2", templateId: "tpl-header", data: { title: "Offering" }, notes: "5 min", sourceRef: makeSourceRef("st-1", "plan-1", "item-2") });
    expect(row).toMatchObject({ kind: "graphic", templateId: "tpl-header", data: { title: "Offering" }, notes: "5 min" });
  });

  it("pcoItemGraphicDefaults maps item fields→template fields and description→notes", () => {
    const item: PcoPlanItem = { id: "item-2", title: "Offering", itemType: "header", description: "5 min" };
    expect(pcoItemGraphicDefaults(item, [{ key: "headline", label: "Headline", type: "text" }])).toEqual({
      data: { headline: "Offering" },
      notes: "5 min",
    });
    expect(pcoItemGraphicDefaults(item)).toEqual({ data: {}, notes: "5 min" });
  });

  it("ensureShowSongEntry is idempotent", () => {
    const one = ensureShowSongEntry([], "amazing-grace");
    expect(one).toEqual([{ songId: "amazing-grace" }]);
    expect(ensureShowSongEntry(one, "amazing-grace")).toBe(one);
  });
});

describe("buildItemPreview", () => {
  const lib = [song({ id: "amazing-grace", title: "Amazing Grace", ccliNumber: "22025" })];
  it("flags a linkable song", () => {
    const item: PcoPlanItem = { id: "i1", title: "Amazing Grace", itemType: "song", song: pcoSong, arrangement: { id: "a", lyrics: "Verse 1\nx" } };
    const p = buildItemPreview(item, lib);
    expect(p.match?.confidence).toBe("ccli");
    expect(p.hasLyrics).toBe(true);
    expect(p.willCreateSong).toBeUndefined();
  });
  it("flags a song that will be created", () => {
    const item: PcoPlanItem = { id: "i2", title: "New Song", itemType: "song", song: { id: "p2", title: "New Song" }, arrangement: { id: "a", lyrics: "" } };
    const p = buildItemPreview(item, lib);
    expect(p.willCreateSong).toBe(true);
    expect(p.hasLyrics).toBe(false);
  });
  it("passes through non-song items", () => {
    const item: PcoPlanItem = { id: "i3", title: "Welcome", itemType: "header" };
    expect(buildItemPreview(item, lib)).toEqual({ itemId: "i3", title: "Welcome", itemType: "header" });
  });
});

describe("pickLyricsArrangement", () => {
  const empty: PcoArrangement = { id: "a1", name: "Default", lyrics: "" };
  const blank: PcoArrangement = { id: "a2", name: "Blank", lyrics: "   \n  " };
  const full: PcoArrangement = { id: "a3", name: "Acoustic in G", lyrics: "Verse 1\nline" };
  const alsoFull: PcoArrangement = { id: "a4", name: "Band", lyrics: "Chorus\nother" };

  it("returns the first arrangement with non-empty lyrics", () => {
    expect(pickLyricsArrangement([empty, full, alsoFull])?.id).toBe("a3");
  });

  it("treats whitespace-only lyrics as empty", () => {
    expect(pickLyricsArrangement([blank, full])?.id).toBe("a3");
  });

  it("skips the excluded arrangement even when it has lyrics", () => {
    expect(pickLyricsArrangement([full, alsoFull], "a3")?.id).toBe("a4");
  });

  it("returns undefined when nothing has lyrics", () => {
    expect(pickLyricsArrangement([empty, blank])).toBeUndefined();
    expect(pickLyricsArrangement([])).toBeUndefined();
  });
});

describe("effectiveLyricsArrangement", () => {
  const own: PcoArrangement = { id: "own", lyrics: "Verse 1\nmine" };
  const fallback: PcoArrangement = { id: "fb", name: "Acoustic", lyrics: "Verse 1\ntheirs" };

  it("prefers the fallback when one was resolved", () => {
    const item: PcoPlanItem = {
      id: "i", title: "T", itemType: "song",
      song: { id: "p", title: "T" },
      arrangement: { id: "own", lyrics: "" },
      lyricsArrangement: fallback,
    };
    expect(effectiveLyricsArrangement(item)?.id).toBe("fb");
  });

  it("falls back to the item's own arrangement", () => {
    const item: PcoPlanItem = {
      id: "i", title: "T", itemType: "song",
      song: { id: "p", title: "T" }, arrangement: own,
    };
    expect(effectiveLyricsArrangement(item)?.id).toBe("own");
  });

  it("returns undefined when the item has neither", () => {
    expect(effectiveLyricsArrangement({ id: "i", title: "T", itemType: "header" })).toBeUndefined();
  });
});

describe("buildItemPreview with a lyrics fallback", () => {
  const lib: Song[] = [];
  const base = {
    id: "i1", title: "New Song", itemType: "song" as const,
    song: { id: "p1", title: "New Song" },
  };

  it("reports hasLyrics and names the source arrangement", () => {
    const p = buildItemPreview(
      { ...base, arrangement: { id: "own", lyrics: "" },
        lyricsArrangement: { id: "fb", name: "Acoustic in G", lyrics: "Verse 1\nx" } },
      lib,
    );
    expect(p.hasLyrics).toBe(true);
    expect(p.lyricsFromArrangement).toBe("Acoustic in G");
  });

  it("falls back to the arrangement id when it has no name", () => {
    const p = buildItemPreview(
      { ...base, arrangement: { id: "own", lyrics: "" },
        lyricsArrangement: { id: "fb-id", lyrics: "Verse 1\nx" } },
      lib,
    );
    expect(p.lyricsFromArrangement).toBe("fb-id");
  });

  it("omits lyricsFromArrangement when the item's own arrangement has lyrics", () => {
    const p = buildItemPreview({ ...base, arrangement: { id: "own", lyrics: "Verse 1\nx" } }, lib);
    expect(p.hasLyrics).toBe(true);
    expect(p.lyricsFromArrangement).toBeUndefined();
  });

  it("reports hasLyrics false when neither arrangement has any", () => {
    const p = buildItemPreview({ ...base, arrangement: { id: "own", lyrics: "" } }, lib);
    expect(p.hasLyrics).toBe(false);
    expect(p.lyricsFromArrangement).toBeUndefined();
  });
});
