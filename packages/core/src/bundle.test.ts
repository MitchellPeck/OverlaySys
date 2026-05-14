import { describe, expect, it } from "vitest";
import { type Song } from "./song";
import { type Template } from "./template";
import { type Show } from "./show";
import {
  BundleSchema,
  collectDependencies,
  detectImport,
  type BundleSelection,
  type StoreSnapshot,
} from "./bundle";
import { type Project } from "./project";

describe("BundleSchema", () => {
  it("accepts a minimal valid bundle", () => {
    const ok = BundleSchema.safeParse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a JSON missing the format discriminator", () => {
    const result = BundleSchema.safeParse({
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong format string", () => {
    const result = BundleSchema.safeParse({
      format: "something-else",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("treats songs/templates/shows arrays as defaulting to empty when omitted", () => {
    const ok = BundleSchema.parse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
    });
    expect(ok.songs).toEqual([]);
    expect(ok.templates).toEqual([]);
    expect(ok.shows).toEqual([]);
  });

  it("accepts an optional project descriptor", () => {
    const project: Project = {
      id: "sunday-services",
      name: "Sunday Services",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    const ok = BundleSchema.parse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      project,
    });
    expect(ok.project?.id).toBe("sunday-services");
  });

  it("leaves project undefined when omitted", () => {
    const ok = BundleSchema.parse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
    });
    expect(ok.project).toBeUndefined();
  });
});

describe("collectDependencies (skeleton)", () => {
  it("is a function that takes a selection and a store", () => {
    const empty: BundleSelection = {
      songIds: [],
      templateIds: [],
      showIds: [],
      hotcardIds: [],
    };
    const out = collectDependencies(empty, {
      songs: new Map(),
      templates: new Map(),
      shows: new Map(),
      hotcards: new Map(),
    });
    expect(out.songs).toEqual([]);
    expect(out.templates).toEqual([]);
    expect(out.shows).toEqual([]);
    expect(out.missing).toEqual([]);
  });
});

describe("detectImport (skeleton)", () => {
  it("returns kind 'error' for non-recognized JSON", () => {
    expect(detectImport({ random: "junk" }).kind).toBe("error");
  });
});

function makeSong(id: string, defaultLyricTemplateId?: string): Song {
  return {
    id,
    title: id,
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["x"] }] }],
    defaultArrangement: ["v1"],
    ...(defaultLyricTemplateId !== undefined ? { defaultLyricTemplateId } : {}),
  };
}

function makeTemplate(id: string): Template {
  const emptyTimeline = { duration: 0, tracks: [] };
  return {
    id,
    name: id,
    size: { w: 1920, h: 1080 },
    fields: [],
    layers: [],
    timelines: { in: emptyTimeline, out: emptyTimeline },
    fonts: [],
  };
}

function makeShow(id: string, rows: Show["rows"]): Show {
  return { id, name: id, projectId: "default", rows };
}

describe("collectDependencies", () => {
  it("pulls a show's referenced songs and templates", () => {
    const store: StoreSnapshot = {
      songs: new Map([["amazing-grace", makeSong("amazing-grace", "tpl-lyric")]]),
      templates: new Map([
        ["tpl-lyric", makeTemplate("tpl-lyric")],
        ["tpl-graphic", makeTemplate("tpl-graphic")],
        ["tpl-stinger", makeTemplate("tpl-stinger")],
      ]),
      shows: new Map([
        [
          "show1",
          makeShow("show1", [
            { kind: "graphic", id: "r1", templateId: "tpl-graphic", data: {} },
            {
              kind: "song",
              id: "r2",
              songId: "amazing-grace",
              lyricTemplateId: "tpl-lyric",
            },
          ]),
        ],
      ]),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["show1"], hotcardIds: [] },
      store,
    );
    expect(out.shows.map((s) => s.id)).toEqual(["show1"]);
    expect(out.songs.map((s) => s.id)).toEqual(["amazing-grace"]);
    expect(out.templates.map((t) => t.id).sort()).toEqual([
      "tpl-graphic",
      "tpl-lyric",
    ]);
    expect(out.missing).toEqual([]);
  });

  it("pulls a song's defaultLyricTemplateId", () => {
    const store: StoreSnapshot = {
      songs: new Map([["s1", makeSong("s1", "tpl-default")]]),
      templates: new Map([["tpl-default", makeTemplate("tpl-default")]]),
      shows: new Map(),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: ["s1"], templateIds: [], showIds: [], hotcardIds: [] },
      store,
    );
    expect(out.songs.map((s) => s.id)).toEqual(["s1"]);
    expect(out.templates.map((t) => t.id)).toEqual(["tpl-default"]);
  });

  it("does NOT pull anything for a standalone template", () => {
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["t1", makeTemplate("t1")]]),
      shows: new Map(),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: ["t1"], showIds: [], hotcardIds: [] },
      store,
    );
    expect(out.templates.map((t) => t.id)).toEqual(["t1"]);
    expect(out.songs).toEqual([]);
    expect(out.shows).toEqual([]);
  });

  it("records a missing-ref when a referenced song is not in the store", () => {
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["tpl-lyric", makeTemplate("tpl-lyric")]]),
      shows: new Map([
        [
          "show-stale",
          makeShow("show-stale", [
            {
              kind: "song",
              id: "r1",
              songId: "ghost-song",
              lyricTemplateId: "tpl-lyric",
            },
          ]),
        ],
      ]),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["show-stale"], hotcardIds: [] },
      store,
    );
    expect(out.shows.map((s) => s.id)).toEqual(["show-stale"]);
    expect(out.songs).toEqual([]);
    expect(out.missing).toEqual([
      { kind: "song", id: "ghost-song", referencedBy: "show-stale" },
    ]);
  });

  it("does not double-add when two shows reference the same template", () => {
    const tpl = makeTemplate("tpl-shared");
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["tpl-shared", tpl]]),
      shows: new Map([
        ["a", makeShow("a", [{ kind: "graphic", id: "r1", templateId: "tpl-shared", data: {} }])],
        ["b", makeShow("b", [{ kind: "graphic", id: "r1", templateId: "tpl-shared", data: {} }])],
      ]),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["a", "b"], hotcardIds: [] },
      store,
    );
    expect(out.templates.map((t) => t.id)).toEqual(["tpl-shared"]);
  });

  it("includes directly-selected entities even if they have no deps", () => {
    const store: StoreSnapshot = {
      songs: new Map([["s1", makeSong("s1")]]),
      templates: new Map([["t1", makeTemplate("t1")]]),
      shows: new Map(),
      hotcards: new Map(),
    };
    const out = collectDependencies(
      { songIds: ["s1"], templateIds: ["t1"], showIds: [], hotcardIds: [] },
      store,
    );
    expect(out.songs.map((s) => s.id)).toEqual(["s1"]);
    expect(out.templates.map((t) => t.id)).toEqual(["t1"]);
  });

  it("records missing-ref for a directly-selected id that doesn't exist in the store", () => {
    const out = collectDependencies(
      { songIds: ["ghost"], templateIds: [], showIds: [], hotcardIds: [] },
      { songs: new Map(), templates: new Map(), shows: new Map(), hotcards: new Map() },
    );
    expect(out.songs).toEqual([]);
    expect(out.missing).toEqual([
      { kind: "song", id: "ghost", referencedBy: "(direct selection)" },
    ]);
  });
});

describe("detectImport", () => {
  it("recognizes a bundle by the format discriminator", () => {
    const bundle = {
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    };
    const result = detectImport(bundle);
    expect(result.kind).toBe("bundle");
  });

  it("recognizes a single Song", () => {
    const result = detectImport(makeSong("amazing-grace"));
    expect(result.kind).toBe("song");
    if (result.kind === "song") {
      expect(result.song.id).toBe("amazing-grace");
    }
  });

  it("recognizes a single Template", () => {
    const result = detectImport(makeTemplate("tpl-1"));
    expect(result.kind).toBe("template");
  });

  it("recognizes a single Show", () => {
    const result = detectImport(makeShow("show-1", []));
    expect(result.kind).toBe("show");
  });

  it("returns 'error' for arbitrary JSON", () => {
    const result = detectImport({ foo: "bar" });
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for a string", () => {
    const result = detectImport("not an object");
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for null", () => {
    const result = detectImport(null);
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for a malformed bundle (rejects with bundle's error message)", () => {
    const result = detectImport({
      format: "overlaysys-bundle",
      version: 1,
      // missing exportedAt
    });
    expect(result.kind).toBe("error");
  });
});
