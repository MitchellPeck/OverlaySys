import { describe, expect, it } from "vitest";
import {
  resolveSongChannel,
  resolveCustomFieldValue,
  resolveIntroTake,
  resolveOutroTake,
  suggestFieldMap,
  listSongFieldDescriptors,
  interpolateSongString,
} from "./songResolution";
import type { Song } from "./song";
import type { ShowSong, SongRow } from "./show";
import type { Template } from "./template";

// --- Test fixture builders -------------------------------------------------
// Inline-friendly factories so individual tests can override just what they
// care about and the rest reads top-to-bottom without hunting for context.

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song1",
    title: "Amazing Grace",
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: [""] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
    ...overrides,
  } as Song;
}

function makeRow(overrides: Partial<SongRow> = {}): SongRow {
  return {
    kind: "song",
    id: "row1",
    songId: "song1",
    lyricTemplateId: "lyric-tpl",
    ...overrides,
  };
}

function makeTemplate(id: string, fields: Template["fields"] = [], defaultChannel?: string): Template {
  return {
    id,
    name: id,
    size: { w: 1920, h: 1080 },
    fields,
    layers: [],
    timelines: {
      in: { duration: 0, tracks: [] },
      out: { duration: 0, tracks: [] },
    },
    fonts: [],
    defaultChannel,
  } as Template;
}

// --- resolveSongChannel ---------------------------------------------------

describe("resolveSongChannel", () => {
  it("prefers SongRow.channelHint over everything else", () => {
    const row = makeRow({ channelHint: "row-ch" });
    const showSong: ShowSong = { songId: "song1", channelOverride: "show-ch" };
    const song = makeSong({ defaultChannel: "song-ch" });
    const tpl = makeTemplate("lyric-tpl", [], "tpl-ch");
    expect(resolveSongChannel(row, showSong, song, tpl)).toBe("row-ch");
  });

  it("falls through to ShowSong.channelOverride when row has no hint", () => {
    const row = makeRow();
    const showSong: ShowSong = { songId: "song1", channelOverride: "show-ch" };
    const song = makeSong({ defaultChannel: "song-ch" });
    expect(resolveSongChannel(row, showSong, song, undefined)).toBe("show-ch");
  });

  it("falls through to Song.defaultChannel when row and showSong are silent", () => {
    const row = makeRow();
    const song = makeSong({ defaultChannel: "song-ch" });
    expect(resolveSongChannel(row, undefined, song, undefined)).toBe("song-ch");
  });

  it("falls through to lyric template default channel as last resort", () => {
    const row = makeRow();
    const song = makeSong();
    const tpl = makeTemplate("lyric-tpl", [], "tpl-ch");
    expect(resolveSongChannel(row, undefined, song, tpl)).toBe("tpl-ch");
  });

  it("returns undefined when no level provides a channel", () => {
    expect(resolveSongChannel(makeRow(), undefined, makeSong(), undefined)).toBeUndefined();
  });
});

// --- resolveCustomFieldValue ----------------------------------------------

describe("resolveCustomFieldValue", () => {
  it("returns built-in field values directly off the Song", () => {
    const song = makeSong({ title: "Doxology", author: "Thomas Ken", ccliNumber: "12345" });
    expect(resolveCustomFieldValue("title", makeRow(), undefined, song)).toBe("Doxology");
    expect(resolveCustomFieldValue("author", makeRow(), undefined, song)).toBe("Thomas Ken");
    expect(resolveCustomFieldValue("ccliNumber", makeRow(), undefined, song)).toBe("12345");
  });

  it("uses ShowSong.customFieldOverrides over Song.customFields", () => {
    const song = makeSong({ customFields: { tempo: "Slow" } });
    const showSong: ShowSong = {
      songId: "song1",
      customFieldOverrides: { tempo: "Fast" },
    };
    expect(resolveCustomFieldValue("tempo", makeRow(), showSong, song)).toBe("Fast");
  });

  it("falls through to Song.customFields when ShowSong has no override for the key", () => {
    const song = makeSong({ customFields: { tempo: "Moderato" } });
    expect(resolveCustomFieldValue("tempo", makeRow(), undefined, song)).toBe("Moderato");
  });

  it("returns undefined for unknown keys", () => {
    expect(
      resolveCustomFieldValue("nonexistent", makeRow(), undefined, makeSong()),
    ).toBeUndefined();
  });
});

// --- resolveIntroTake -----------------------------------------------------

describe("resolveIntroTake", () => {
  const introTpl = makeTemplate("intro-tpl", [
    { key: "songTitle", label: "Song Title", type: "text", default: "Untitled" },
    { key: "subtitle", label: "Subtitle", type: "text" },
  ]);

  it("returns null when no template is configured at any level", () => {
    const result = resolveIntroTake(makeRow(), undefined, makeSong(), [introTpl]);
    expect(result).toBeNull();
  });

  it("returns null when row.skipIntro is true even with templates configured", () => {
    const row = makeRow({ skipIntro: true, introTemplateId: "intro-tpl" });
    const result = resolveIntroTake(row, undefined, makeSong(), [introTpl]);
    expect(result).toBeNull();
  });

  it("returns null when the resolved template id doesn't exist in templates", () => {
    const row = makeRow({ introTemplateId: "missing" });
    expect(resolveIntroTake(row, undefined, makeSong(), [introTpl])).toBeNull();
  });

  it("uses the song-level default template when row and showSong don't override", () => {
    const song = makeSong({ defaultIntroTemplateId: "intro-tpl" });
    const result = resolveIntroTake(makeRow(), undefined, song, [introTpl]);
    expect(result?.templateId).toBe("intro-tpl");
  });

  it("ShowSong template overrides song default", () => {
    const altTpl = makeTemplate("alt-intro", []);
    const song = makeSong({ defaultIntroTemplateId: "intro-tpl" });
    const showSong: ShowSong = { songId: "song1", introTemplateId: "alt-intro" };
    const result = resolveIntroTake(makeRow(), showSong, song, [introTpl, altTpl]);
    expect(result?.templateId).toBe("alt-intro");
  });

  it("Row template overrides ShowSong template", () => {
    const altTpl = makeTemplate("alt-intro", []);
    const rowTpl = makeTemplate("row-intro", []);
    const song = makeSong({ defaultIntroTemplateId: "intro-tpl" });
    const showSong: ShowSong = { songId: "song1", introTemplateId: "alt-intro" };
    const row = makeRow({ introTemplateId: "row-intro" });
    const result = resolveIntroTake(row, showSong, song, [introTpl, altTpl, rowTpl]);
    expect(result?.templateId).toBe("row-intro");
  });

  it("uses song-level field map when row and showSong don't provide one", () => {
    const song = makeSong({
      title: "Song A",
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldMap: { songTitle: "title" },
    });
    const result = resolveIntroTake(makeRow(), undefined, song, [introTpl]);
    expect(result?.fieldValues.songTitle).toBe("Song A");
  });

  it("ShowSong field map replaces song's default", () => {
    // ShowSong replaces the song map entirely (no per-key merge).
    const showSong: ShowSong = {
      songId: "song1",
      introFieldMap: { subtitle: "author" },
    };
    const result = resolveIntroTake(
      makeRow(),
      showSong,
      makeSong({
        author: "Author B",
        defaultIntroTemplateId: "intro-tpl",
        defaultIntroFieldMap: { songTitle: "title" },
      }),
      [introTpl],
    );
    expect(result?.fieldValues.subtitle).toBe("Author B");
    // songTitle isn't mapped at the show level, so it falls back to the template default.
    expect(result?.fieldValues.songTitle).toBe("Untitled");
  });

  it("row field map wins over ShowSong's", () => {
    const showSong: ShowSong = {
      songId: "song1",
      introFieldMap: { subtitle: "author" },
    };
    const row = makeRow({ introFieldMap: { songTitle: "title" } });
    const result = resolveIntroTake(
      row,
      showSong,
      makeSong({ title: "Row Title", defaultIntroTemplateId: "intro-tpl" }),
      [introTpl],
    );
    expect(result?.fieldValues.songTitle).toBe("Row Title");
  });

  it("uses template field default when no mapping, then empty string when no default", () => {
    const song = makeSong({ defaultIntroTemplateId: "intro-tpl" });
    const result = resolveIntroTake(makeRow(), undefined, song, [introTpl]);
    expect(result?.fieldValues.songTitle).toBe("Untitled");
    expect(result?.fieldValues.subtitle).toBe("");
  });

  it("uses resolveCustomFieldValue for mapped fields (built-in + custom)", () => {
    const song = makeSong({
      title: "Doxology",
      customFields: { tempo: "Slow" },
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldMap: { songTitle: "title", subtitle: "tempo" },
    });
    const result = resolveIntroTake(makeRow(), undefined, song, [introTpl]);
    expect(result?.fieldValues.songTitle).toBe("Doxology");
    expect(result?.fieldValues.subtitle).toBe("Slow");
  });

  it("returns empty string when a mapped field key has no value anywhere", () => {
    const song = makeSong({
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldMap: { songTitle: "missing-key" },
    });
    const result = resolveIntroTake(makeRow(), undefined, song, [introTpl]);
    expect(result?.fieldValues.songTitle).toBe("");
  });
});

// --- resolveOutroTake -----------------------------------------------------

describe("resolveOutroTake", () => {
  it("mirrors resolveIntroTake — full cascade round-trip", () => {
    const outroTpl = makeTemplate("outro-tpl", [
      { key: "thanks", label: "Thanks", type: "text", default: "Thanks for singing" },
    ]);
    const song = makeSong({
      author: "Author X",
      defaultOutroTemplateId: "outro-tpl",
      defaultOutroFieldMap: { thanks: "author" },
    });
    const result = resolveOutroTake(makeRow(), undefined, song, [outroTpl]);
    expect(result).toEqual({
      templateId: "outro-tpl",
      fieldValues: { thanks: "Author X" },
    });
  });

  it("returns null when row.skipOutro is true", () => {
    const outroTpl = makeTemplate("outro-tpl", []);
    const row = makeRow({ skipOutro: true, outroTemplateId: "outro-tpl" });
    expect(resolveOutroTake(row, undefined, makeSong(), [outroTpl])).toBeNull();
  });
});

// --- suggestFieldMap ------------------------------------------------------

describe("suggestFieldMap", () => {
  it("returns exact-key match as kind 'exact'", () => {
    const result = suggestFieldMap(
      [{ key: "title", label: "Heading", type: "text" }],
      [{ key: "title", label: "Title", type: "text" }],
    );
    expect(result.title).toEqual({ kind: "exact", songFieldKey: "title" });
  });

  it("prefers exact-key match over label suggestion", () => {
    const result = suggestFieldMap(
      [{ key: "title", label: "Composer", type: "text" }],
      [
        { key: "title", label: "Title", type: "text" },
        { key: "author", label: "Composer", type: "text" },
      ],
    );
    expect(result.title).toEqual({ kind: "exact", songFieldKey: "title" });
  });

  it("suggests by label similarity when no exact match exists", () => {
    const result = suggestFieldMap(
      [{ key: "heading", label: "Song Title", type: "text" }],
      [{ key: "title", label: "Title", type: "text" }],
    );
    expect(result.heading).toEqual({ kind: "suggested", songFieldKey: "title" });
  });

  it("returns 'none' when neither exact nor suggested match", () => {
    const result = suggestFieldMap(
      [{ key: "completely_unrelated", label: "xyz", type: "text" }],
      [{ key: "title", label: "Title", type: "text" }],
    );
    expect(result.completely_unrelated).toEqual({ kind: "none" });
  });

  it("does not suggest the same song field for two template fields", () => {
    // Both headings tie on similarity (substring match → 0.8). The greedy pass
    // uses a stable sort, so the first template field in iteration order wins
    // and the second falls back to 'none'. Pinning the assignment here ensures
    // the test would catch double-claim bugs *and* any regression that breaks
    // the documented stable-order tiebreak.
    const result = suggestFieldMap(
      [
        { key: "headingA", label: "Song Title", type: "text" },
        { key: "headingB", label: "Song Title Extra", type: "text" },
      ],
      [{ key: "title", label: "Title", type: "text" }],
    );
    expect(result.headingA).toEqual({ kind: "suggested", songFieldKey: "title" });
    expect(result.headingB).toEqual({ kind: "none" });
  });
});

// --- listSongFieldDescriptors ---------------------------------------------

describe("listSongFieldDescriptors", () => {
  it("always returns the four built-in descriptors first, in fixed order", () => {
    const out = listSongFieldDescriptors(makeSong());
    expect(out.slice(0, 4).map((d) => d.key)).toEqual([
      "title",
      "ccliNumber",
      "author",
      "copyright",
    ]);
    expect(out[0]).toEqual({ key: "title", label: "Title", type: "text" });
    expect(out[1]).toEqual({ key: "ccliNumber", label: "CCLI Number", type: "text" });
  });

  it("appends one descriptor per customField key, sorted by key", () => {
    const song = makeSong({ customFields: { zebra: "z", apple: "a", mango: "m" } });
    const out = listSongFieldDescriptors(song);
    expect(out.slice(4).map((d) => d.key)).toEqual(["apple", "mango", "zebra"]);
  });

  it("uses the project schema label/type for custom fields when available", () => {
    const song = makeSong({ customFields: { tempo: "Slow" } });
    const out = listSongFieldDescriptors(song, [
      { key: "tempo", label: "Tempo", type: "number" },
    ]);
    const tempo = out.find((d) => d.key === "tempo")!;
    expect(tempo).toEqual({ key: "tempo", label: "Tempo", type: "number" });
  });

  it("falls back to key-as-label and text type when no project schema entry exists", () => {
    const song = makeSong({ customFields: { weird_key: "x" } });
    const out = listSongFieldDescriptors(song);
    const wk = out.find((d) => d.key === "weird_key")!;
    expect(wk).toEqual({ key: "weird_key", label: "weird_key", type: "text" });
  });
});

// --- interpolateSongString ------------------------------------------------

describe("interpolateSongString", () => {
  it("substitutes built-in song fields", () => {
    const song = makeSong({ title: "Be Thou My Vision", author: "Dallan Forgaill" });
    expect(interpolateSongString("{title} by {author}", makeRow(), undefined, song)).toBe(
      "Be Thou My Vision by Dallan Forgaill",
    );
  });

  it("substitutes custom fields via the cascade", () => {
    const song = makeSong({ customFields: { hymnNumber: "152" } });
    expect(interpolateSongString("Hymn #{hymnNumber}", makeRow(), undefined, song)).toBe(
      "Hymn #152",
    );
  });

  it("honors ShowSong customFieldOverrides over Song.customFields", () => {
    const song = makeSong({ customFields: { hymnNumber: "152" } });
    const showSong: ShowSong = { songId: "song1", customFieldOverrides: { hymnNumber: "999" } };
    expect(interpolateSongString("#{hymnNumber}", makeRow(), showSong, song)).toBe("#999");
  });

  it("treats {{ as a literal { (and }} as }) ", () => {
    const song = makeSong({ title: "x" });
    expect(interpolateSongString("{{title}} is the {title}", makeRow(), undefined, song)).toBe(
      "{title} is the x",
    );
    expect(interpolateSongString("a }} b", makeRow(), undefined, song)).toBe("a } b");
  });

  it("resolves unknown keys to an empty string", () => {
    const song = makeSong();
    expect(interpolateSongString("[{nonexistent}]", makeRow(), undefined, song)).toBe("[]");
  });

  it("emits unterminated `{` verbatim instead of throwing", () => {
    const song = makeSong({ title: "x" });
    expect(interpolateSongString("prefix {title and no close", makeRow(), undefined, song)).toBe(
      "prefix {title and no close",
    );
  });

  it("handles multiple substitutions in one string", () => {
    const song = makeSong({
      title: "Amazing Grace",
      author: "John Newton",
      ccliNumber: "22025",
      customFields: { hymnNumber: "278" },
    });
    expect(
      interpolateSongString(
        "{title} ({author}) — CCLI {ccliNumber} — Hymn {hymnNumber}",
        makeRow(),
        undefined,
        song,
      ),
    ).toBe("Amazing Grace (John Newton) — CCLI 22025 — Hymn 278");
  });
});

// --- Literal-value cascade in resolveIntroTake ----------------------------

describe("resolveIntroTake — literals", () => {
  const tpl = makeTemplate("intro-tpl", [
    { key: "title", label: "Title", type: "text", default: "" },
    { key: "subtitle", label: "Subtitle", type: "text", default: "" },
  ]);
  const templates = [tpl];

  it("uses song-level intro literals with interpolation", () => {
    const song = makeSong({
      title: "Amazing Grace",
      customFields: { hymnNumber: "278" },
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldLiterals: { subtitle: "Hymn #{hymnNumber}" },
    });
    const out = resolveIntroTake(makeRow(), undefined, song, templates);
    expect(out?.fieldValues).toEqual({
      title: "",
      subtitle: "Hymn #278",
    });
  });

  it("ShowSong literals override Song defaults (whole-object)", () => {
    const song = makeSong({
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldLiterals: { subtitle: "From song" },
    });
    const showSong: ShowSong = {
      songId: "song1",
      introFieldLiterals: { subtitle: "From show" },
    };
    const out = resolveIntroTake(makeRow(), showSong, song, templates);
    expect(out?.fieldValues.subtitle).toBe("From show");
  });

  it("Row literals override ShowSong and Song", () => {
    const song = makeSong({
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldLiterals: { subtitle: "From song" },
    });
    const showSong: ShowSong = {
      songId: "song1",
      introFieldLiterals: { subtitle: "From show" },
    };
    const row = makeRow({ introFieldLiterals: { subtitle: "From row" } });
    const out = resolveIntroTake(row, showSong, song, templates);
    expect(out?.fieldValues.subtitle).toBe("From row");
  });

  it("literal wins over field map when both target the same template field", () => {
    const song = makeSong({
      title: "Amazing Grace",
      customFields: { hymnNumber: "278" },
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldMap: { subtitle: "hymnNumber" },
      defaultIntroFieldLiterals: { subtitle: "Literal wins" },
    });
    const out = resolveIntroTake(makeRow(), undefined, song, templates);
    expect(out?.fieldValues.subtitle).toBe("Literal wins");
  });

  it("template fields without a literal still resolve through the map cascade", () => {
    const song = makeSong({
      title: "Amazing Grace",
      defaultIntroTemplateId: "intro-tpl",
      defaultIntroFieldMap: { title: "title" }, // template "title" ← song "title"
      defaultIntroFieldLiterals: { subtitle: "static" },
    });
    const out = resolveIntroTake(makeRow(), undefined, song, templates);
    expect(out?.fieldValues).toEqual({
      title: "Amazing Grace",
      subtitle: "static",
    });
  });
});

describe("resolveOutroTake — literals", () => {
  it("honors the outro literal cascade", () => {
    const tpl = makeTemplate("outro-tpl", [
      { key: "footer", label: "Footer", type: "text", default: "" },
    ]);
    const song = makeSong({
      defaultOutroTemplateId: "outro-tpl",
      defaultOutroFieldLiterals: { footer: "© {copyright}" },
      copyright: "Public Domain",
    });
    const out = resolveOutroTake(makeRow(), undefined, song, [tpl]);
    expect(out?.fieldValues.footer).toBe("© Public Domain");
  });
});
