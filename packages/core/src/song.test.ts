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

  it("backfills missing customFields to an empty object (legacy compat)", () => {
    // Inline raw object (no shared fixture) so the omitted `customFields` key
    // is visible at the test site and can't be silently negated later.
    const legacy = {
      id: "legacy-song",
      title: "Legacy",
      sections: [
        {
          id: "v1",
          kind: "verse",
          label: "Verse 1",
          slides: [{ id: "v1s1", lines: ["line one"] }],
        },
      ],
      defaultArrangement: ["v1"],
    };
    const parsed = SongSchema.parse(legacy);
    expect(parsed.customFields).toEqual({});
  });

  it("preserves explicit customFields and sub-take defaults on round-trip", () => {
    const parsed = SongSchema.parse({
      ...minimal,
      customFields: { writtenFor: "Easter", key: "G" },
      defaultIntroTemplateId: "intro-default",
      defaultIntroFieldMap: { title: "title", subtitle: "writtenFor" },
      defaultOutroTemplateId: "outro-default",
      defaultOutroFieldMap: { tagline: "writtenFor" },
      defaultChannel: "program",
    });
    expect(parsed.customFields).toEqual({ writtenFor: "Easter", key: "G" });
    expect(parsed.defaultIntroTemplateId).toBe("intro-default");
    expect(parsed.defaultIntroFieldMap).toEqual({
      title: "title",
      subtitle: "writtenFor",
    });
    expect(parsed.defaultOutroTemplateId).toBe("outro-default");
    expect(parsed.defaultOutroFieldMap).toEqual({ tagline: "writtenFor" });
    expect(parsed.defaultChannel).toBe("program");
  });
});
