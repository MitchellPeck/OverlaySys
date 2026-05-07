import { describe, expect, it } from "vitest";
import { RundownRowSchema, ShowSchema } from "./show";

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
    expect(show.rows[0].kind).toBe("graphic");
    expect(show.rows[1].kind).toBe("song");
  });
});
