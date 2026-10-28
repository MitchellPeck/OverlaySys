import { describe, expect, it } from "vitest";
import { RundownRowSchema, ScriptureRowSchema, ScriptureSlideSchema, ShowSchema, ShowSongSchema } from "./show";

describe("RundownRowSchema", () => {
  it("parses a graphic row with explicit kind", () => {
    const row = RundownRowSchema.parse({
      kind: "graphic",
      id: "r1",
      templateId: "lower-third-default",
      data: { name: "Jane" },
    });
    expect(row.kind).toBe("graphic");
  });

  it("treats a legacy row (no kind) as graphic", () => {
    const row = RundownRowSchema.parse({
      id: "r1",
      templateId: "lower-third-default",
      data: { name: "Jane" },
    });
    expect(row.kind).toBe("graphic");
    if (row.kind === "graphic") {
      expect(row.templateId).toBe("lower-third-default");
    }
  });

  it("parses a song row", () => {
    const row = RundownRowSchema.parse({
      kind: "song",
      id: "r2",
      songId: "amazing-grace",
      lyricTemplateId: "lyric-default",
    });
    expect(row.kind).toBe("song");
    if (row.kind === "song") {
      expect(row.songId).toBe("amazing-grace");
    }
  });

  it("parses a song row with optional arrangement and trustMode", () => {
    const row = RundownRowSchema.parse({
      kind: "song",
      id: "r3",
      songId: "amazing-grace",
      lyricTemplateId: "lyric-default",
      arrangement: ["v1", "c"],
      trustMode: true,
    });
    if (row.kind !== "song") throw new Error("expected song");
    expect(row.arrangement).toEqual(["v1", "c"]);
    expect(row.trustMode).toBe(true);
  });

  it("rejects a song row missing songId", () => {
    expect(() =>
      RundownRowSchema.parse({
        kind: "song",
        id: "r4",
        lyricTemplateId: "lyric-default",
      }),
    ).toThrow();
  });

  it("accepts a song row with sub-take overrides and skip flags", () => {
    const row = RundownRowSchema.parse({
      kind: "song",
      id: "r5",
      songId: "amazing-grace",
      lyricTemplateId: "lyric-default",
      introTemplateId: "intro-special",
      introFieldMap: { title: "title" },
      outroTemplateId: "outro-special",
      outroFieldMap: { tagline: "writtenFor" },
      skipIntro: false,
      skipOutro: true,
    });
    if (row.kind !== "song") throw new Error("expected song");
    expect(row.introTemplateId).toBe("intro-special");
    expect(row.introFieldMap).toEqual({ title: "title" });
    expect(row.outroTemplateId).toBe("outro-special");
    expect(row.outroFieldMap).toEqual({ tagline: "writtenFor" });
    expect(row.skipIntro).toBe(false);
    expect(row.skipOutro).toBe(true);
  });
});

describe("ShowSongSchema", () => {
  it("parses a minimal ShowSong entry", () => {
    const s = ShowSongSchema.parse({ songId: "amazing-grace" });
    expect(s.songId).toBe("amazing-grace");
    expect(s.channelOverride).toBeUndefined();
  });

  it("round-trips all override fields", () => {
    const s = ShowSongSchema.parse({
      songId: "amazing-grace",
      channelOverride: "stage",
      introTemplateId: "intro-A",
      introFieldMap: { title: "title" },
      outroTemplateId: "outro-A",
      outroFieldMap: { tagline: "writtenFor" },
      lyricTemplateId: "lyric-A",
      customFieldOverrides: { writtenFor: "Easter Service" },
    });
    expect(s).toEqual({
      songId: "amazing-grace",
      channelOverride: "stage",
      introTemplateId: "intro-A",
      introFieldMap: { title: "title" },
      outroTemplateId: "outro-A",
      outroFieldMap: { tagline: "writtenFor" },
      lyricTemplateId: "lyric-A",
      customFieldOverrides: { writtenFor: "Easter Service" },
    });
  });
});

describe("ShowSchema (legacy compat)", () => {
  it("parses a show with mixed legacy + tagged rows", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      rows: [
        { id: "r1", templateId: "lower-third-default", data: { name: "Pastor" } },
        {
          kind: "song",
          id: "r2",
          songId: "amazing-grace",
          lyricTemplateId: "lyric-default",
        },
      ],
    });
    expect(show.rows[0]!.kind).toBe("graphic");
    expect(show.rows[1]!.kind).toBe("song");
  });

  it("backfills missing projectId to the default project", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      rows: [],
    });
    expect(show.projectId).toBe("default");
  });

  it("preserves explicit projectId on read", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      projectId: "christmas-eve",
      rows: [],
    });
    expect(show.projectId).toBe("christmas-eve");
  });

  it("backfills missing songs to an empty array (legacy compat)", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      rows: [],
    });
    expect(show.songs).toEqual([]);
  });

  it("backfills missing songs when projectId is present", () => {
    const show = ShowSchema.parse({
      id: "s-asym-1",
      name: "Asymmetric A",
      projectId: "x",
      rows: [],
    });
    expect(show.projectId).toBe("x");
    expect(show.songs).toEqual([]);
  });

  it("backfills missing projectId when songs is present", () => {
    const show = ShowSchema.parse({
      id: "s-asym-2",
      name: "Asymmetric B",
      rows: [],
      songs: [{ songId: "s1" }],
    });
    expect(show.projectId).toBe("default");
    expect(show.songs).toEqual([{ songId: "s1" }]);
  });

  it("preserves an explicit songs array on read", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      projectId: "default",
      rows: [],
      songs: [
        {
          songId: "amazing-grace",
          channelOverride: "stage",
          customFieldOverrides: { writtenFor: "Easter" },
        },
      ],
    });
    expect(show.songs).toHaveLength(1);
    expect(show.songs[0]!.songId).toBe("amazing-grace");
    expect(show.songs[0]!.channelOverride).toBe("stage");
    expect(show.songs[0]!.customFieldOverrides).toEqual({ writtenFor: "Easter" });
  });
});

describe("ScriptureSlideSchema", () => {
  const minimal = {
    id: "s1",
    verses: [
      { book: "JHN", chapter: 3, verse: 16, text: "For God so loved..." },
    ],
  };

  it("parses a minimal slide", () => {
    expect(ScriptureSlideSchema.parse(minimal).id).toBe("s1");
  });

  it("rejects a slide with no verses", () => {
    expect(() =>
      ScriptureSlideSchema.parse({ id: "s1", verses: [] }),
    ).toThrow();
  });
});

describe("ScriptureRowSchema", () => {
  const base = {
    kind: "scripture" as const,
    id: "s1",
    reference: "John 3:16",
    translation: "NIV",
    slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
    templateId: "t",
  };

  it("accepts an api.bible source", () => {
    const row = ScriptureRowSchema.parse({
      ...base,
      source: { provider: "api.bible", bibleId: "B", fetchedAt: "2026-10-21T00:00:00.000Z", usageTokens: ["t1"] },
    });
    expect(row.source?.bibleId).toBe("B");
  });

  it("defaults usageTokens and leaves source optional", () => {
    const row = ScriptureRowSchema.parse({
      ...base,
      source: { provider: "api.bible", bibleId: "B", fetchedAt: "2026-10-21T00:00:00.000Z" },
    });
    expect(row.source?.usageTokens).toEqual([]);
    expect(ScriptureRowSchema.parse(base).source).toBeUndefined();
  });

  it("rejects unknown providers", () => {
    expect(() =>
      ScriptureRowSchema.parse({ ...base, source: { provider: "other", bibleId: "B", fetchedAt: "x" } }),
    ).toThrow();
  });

  const minimal = {
    kind: "scripture" as const,
    id: "row-1",
    reference: "John 3:16",
    translation: "KJV",
    slides: [{
      id: "s1",
      verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God..." }],
    }],
    templateId: "scripture-template",
  };

  it("parses a minimal row", () => {
    const parsed = ScriptureRowSchema.parse(minimal);
    expect(parsed.kind).toBe("scripture");
    expect(parsed.reference).toBe("John 3:16");
  });

  it("accepts optional fields", () => {
    const parsed = ScriptureRowSchema.parse({
      ...minimal,
      attribution: "Public Domain",
      channelHint: "program",
      notes: "intro reading",
    });
    expect(parsed.attribution).toBe("Public Domain");
    expect(parsed.channelHint).toBe("program");
  });

  it("round-trips translationAbbreviation when provided", () => {
    const parsed = ScriptureRowSchema.parse({ ...minimal, translationAbbreviation: "KJV" });
    expect(parsed.translationAbbreviation).toBe("KJV");
  });

  it("translationAbbreviation is optional (backwards compat)", () => {
    const parsed = ScriptureRowSchema.parse(minimal);
    expect(parsed.translationAbbreviation).toBeUndefined();
  });

  it("rejects a row with no slides", () => {
    expect(() =>
      ScriptureRowSchema.parse({ ...minimal, slides: [] }),
    ).toThrow();
  });
});

describe("RundownRowSchema — scripture variant", () => {
  it("parses a scripture row via the union", () => {
    const row = RundownRowSchema.parse({
      kind: "scripture",
      id: "row-1",
      reference: "John 3:16",
      translation: "KJV",
      slides: [{
        id: "s1",
        verses: [{ book: "JHN", chapter: 3, verse: 16, text: "..." }],
      }],
      templateId: "t1",
    });
    expect(row.kind).toBe("scripture");
  });

  it("still defaults missing kind to graphic (regression)", () => {
    const row = RundownRowSchema.parse({
      // no kind
      id: "row-x",
      templateId: "t1",
      data: { text: "hello" },
    });
    expect(row.kind).toBe("graphic");
  });
});

describe("ShowSchema with mixed rundown rows", () => {
  it("accepts graphic + song + scripture in the same rundown", () => {
    const show = ShowSchema.parse({
      id: "show-1",
      name: "Test",
      rows: [
        { kind: "graphic", id: "g", templateId: "t", data: {} },
        {
          kind: "song", id: "s", songId: "song-1", lyricTemplateId: "lt",
        },
        {
          kind: "scripture",
          id: "sc",
          reference: "John 3:16",
          translation: "KJV",
          slides: [{
            id: "sl",
            verses: [{ book: "JHN", chapter: 3, verse: 16, text: "..." }],
          }],
          templateId: "scripture-template",
        },
      ],
    });
    expect(show.rows).toHaveLength(3);
  });
});

describe("Show scheduledFor", () => {
  it("round-trips an ISO scheduledFor date", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "5/17/26 Service",
      projectId: "p1",
      rows: [],
      songs: [],
      scheduledFor: "2026-05-17",
    });
    expect(show.scheduledFor).toBe("2026-05-17");
  });

  it("leaves scheduledFor undefined when absent", () => {
    const show = ShowSchema.parse({
      id: "s2",
      name: "Untitled",
      projectId: "p1",
      rows: [],
      songs: [],
    });
    expect(show.scheduledFor).toBeUndefined();
  });
});

describe("VideoRow", () => {
  it("parses with defaults", () => {
    const row = RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/assets/a.mp4" });
    if (row.kind !== "video") throw new Error("expected video");
    expect(row.volume).toBe(1);
    expect(row.endAction).toBe("clear");
    expect(row.label).toBeUndefined();
    // Rows saved before transitions existed fade in and out.
    expect(row.transitionIn).toEqual({ style: "fade", durationMs: 500 });
    expect(row.transitionOut).toEqual({ style: "fade", durationMs: 500 });
  });

  it("keeps zoom/slide transitions and rejects out-of-range durations", () => {
    const row = RundownRowSchema.parse({
      kind: "video", id: "v1", assetUrl: "/a.mp4",
      transitionIn: { style: "zoom", durationMs: 1200 }, transitionOut: { style: "slide", durationMs: 0 },
    });
    if (row.kind !== "video") throw new Error("expected video");
    expect(row.transitionIn.style).toBe("zoom");
    expect(row.transitionOut).toEqual({ style: "slide", durationMs: 0 });
    expect(() =>
      RundownRowSchema.parse({
        kind: "video", id: "v1", assetUrl: "/a.mp4", transitionIn: { style: "fade", durationMs: 9000 },
      }),
    ).toThrow();
  });

  it("keeps label, duration, hold and channel", () => {
    const row = RundownRowSchema.parse({
      kind: "video", id: "v1", assetUrl: "/assets/a.mp4",
      label: "Giving", durationSec: 301.2, volume: 0.5, endAction: "hold", channelHint: "program",
    });
    if (row.kind !== "video") throw new Error("expected video");
    expect(row).toMatchObject({ label: "Giving", durationSec: 301.2, volume: 0.5, endAction: "hold" });
  });

  it("rejects volume > 1", () => {
    expect(() =>
      RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/a.mp4", volume: 2 }),
    ).toThrow();
  });
});

describe("ShowSchema sections and pass-through", () => {
  const base = { id: "s1", name: "Sunday", projectId: "p", songs: [] as unknown[] };
  const graphicRow = { kind: "graphic", id: "r1", templateId: "t", data: {} };

  it("parses an old show without sections unchanged", () => {
    const s = ShowSchema.parse({ ...base, rows: [graphicRow] });
    expect(s.sections).toBeUndefined();
    expect(s.rows[0]!.sectionId).toBeUndefined();
  });

  it("round-trips sections and sectionId", () => {
    const s = ShowSchema.parse({
      ...base,
      sections: [{ id: "sec-a", name: "Worship" }],
      rows: [{ ...graphicRow, sectionId: "sec-a" }],
    });
    expect(s.sections).toEqual([{ id: "sec-a", name: "Worship" }]);
    expect(s.rows[0]!.sectionId).toBe("sec-a");
  });

  it("keeps unknown keys on the show, rows, show songs and sections", () => {
    const s = ShowSchema.parse({
      ...base,
      futureShowKey: 1,
      songs: [{ songId: "x", futureSongKey: true }],
      sections: [{ id: "a", name: "A", colour: "#fff" }],
      rows: [{ ...graphicRow, futureRowKey: "x" }],
    }) as Record<string, unknown>;
    expect(s.futureShowKey).toBe(1);
    expect((s.rows as Record<string, unknown>[])[0]!.futureRowKey).toBe("x");
    expect((s.songs as Record<string, unknown>[])[0]!.futureSongKey).toBe(true);
    expect((s.sections as Record<string, unknown>[])[0]!.colour).toBe("#fff");
  });

  it("still defaults a row without kind to graphic", () => {
    const s = ShowSchema.parse({ ...base, rows: [{ id: "r1", templateId: "t", data: {} }] });
    expect(s.rows[0]!.kind).toBe("graphic");
  });

  it("round-trips sourceRef.pcoArrangement", () => {
    const s = ShowSchema.parse({
      ...base,
      rows: [
        {
          kind: "song",
          id: "r1",
          songId: "x",
          lyricTemplateId: "l",
          sourceRef: { provider: "pco", serviceTypeId: "a", planId: "b", itemId: "c", pcoArrangement: ["v1", "c"] },
        },
      ],
    });
    const row = s.rows[0]!;
    expect(row.kind === "song" && row.sourceRef?.pcoArrangement).toEqual(["v1", "c"]);
  });

  it("parses a slides row with subset, overrides, local slides and an unknown key", () => {
    const show = ShowSchema.parse({
      ...base,
      rows: [
        {
          kind: "slides",
          id: "r",
          deckId: "d",
          slideIds: ["a", "a"],
          fieldOverrides: { a: { text: "Line X" } },
          localSlides: [{ id: "l1", data: { text: "Line A" } }],
          stageLayouts: { st: "lay" },
          sectionId: "sec",
          later: true,
        },
      ],
    });
    expect(show.rows[0]).toMatchObject({ kind: "slides", slideIds: ["a", "a"], sectionId: "sec", later: true });
  });

  it("existing row kinds still parse unchanged alongside slides", () => {
    const rows = [
      { kind: "graphic", id: "g", templateId: "t", data: {} },
      { kind: "video", id: "v", assetUrl: "x" },
    ];
    const show = ShowSchema.parse({ ...base, rows });
    expect(show.rows.map((r) => r.kind)).toEqual(["graphic", "video"]);
  });
});
