import { describe, expect, it } from "vitest";
import { RundownRowSchema, ShowSchema, ShowSongSchema } from "./show";

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
