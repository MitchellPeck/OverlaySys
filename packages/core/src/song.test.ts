import { describe, expect, it } from "vitest";
import { SongSchema, SectionKindSchema } from "./song";

describe("SectionKindSchema", () => {
  it("accepts known kinds", () => {
    for (const k of ["verse", "chorus", "bridge", "tag", "intro", "outro", "other"]) {
      expect(SectionKindSchema.parse(k)).toBe(k);
    }
  });
  it("rejects unknown kinds", () => {
    expect(() => SectionKindSchema.parse("prelude")).toThrow();
  });
});

describe("SongSchema", () => {
  const minimal = {
    id: "amazing-grace",
    title: "Amazing Grace",
    sections: [
      {
        id: "v1",
        kind: "verse",
        label: "Verse 1",
        slides: [
          { id: "v1s1", lines: ["Amazing grace how sweet the sound"] },
        ],
      },
    ],
    defaultArrangement: ["v1"],
  };

  it("parses a minimal valid song", () => {
    const parsed = SongSchema.parse(minimal);
    expect(parsed.id).toBe("amazing-grace");
    expect(parsed.sections[0]!.slides[0]!.lines).toEqual([
      "Amazing grace how sweet the sound",
    ]);
  });

  it("rejects empty sections array", () => {
    expect(() =>
      SongSchema.parse({ ...minimal, sections: [] }),
    ).toThrow();
  });

  it("rejects a section with no slides", () => {
    expect(() =>
      SongSchema.parse({
        ...minimal,
        sections: [{ ...minimal.sections[0]!, slides: [] }],
      }),
    ).toThrow();
  });

  it("rejects a slide with no lines", () => {
    expect(() =>
      SongSchema.parse({
        ...minimal,
        sections: [
          {
            ...minimal.sections[0]!,
            slides: [{ id: "v1s1", lines: [] }],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts optional metadata fields", () => {
    const parsed = SongSchema.parse({
      ...minimal,
      ccliNumber: "22025",
      author: "John Newton",
      copyright: "Public Domain",
      defaultLyricTemplateId: "lyric-default",
    });
    expect(parsed.ccliNumber).toBe("22025");
    expect(parsed.defaultLyricTemplateId).toBe("lyric-default");
  });
});
