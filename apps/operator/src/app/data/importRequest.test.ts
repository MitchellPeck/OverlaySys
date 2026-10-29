import { describe, expect, it } from "vitest";
import { ShowSchema, type Hotcard, type Show, type Song, type Template } from "@overlaysys/core";
import { buildImportRequest, resolveTargetProject } from "./importRequest";
import { planImport } from "./planImport";

let n = 0;
const makeId = (p: string) => `${p}-new${++n}`;

const song = { id: "s1", title: "Song One" } as unknown as Song;
const show = ShowSchema.parse({
  id: "sh1",
  name: "Sunday",
  projectId: "elsewhere",
  sections: [{ id: "sec1", name: "Worship" }],
  songs: [{ songId: "s1", introTemplateId: "t1" }],
  rows: [
    { kind: "song", id: "r1", sectionId: "sec1", songId: "s1", lyricTemplateId: "t1", stageLayouts: { stage: "lay" } },
    { kind: "graphic", id: "r2", templateId: "t1", data: {} },
    { kind: "slides", id: "r3", sectionId: "sec1", deckId: "d1", localSlides: [{ id: "x", templateId: "t1", data: {} }] },
  ],
}) as Show;
const preview = { songs: [song], templates: [] as Template[], shows: [show], hotcards: [] as Hotcard[], assets: [] };

describe("resolveTargetProject", () => {
  it("uses the bundle project only when it exists locally", () => {
    expect(resolveTargetProject("p2", ["default", "p2"], "default")).toBe("p2");
    expect(resolveTargetProject("missing", ["default"], "default")).toBe("default");
    expect(resolveTargetProject(undefined, ["default"], "cur")).toBe("cur");
  });
  it("planImport target equals what the request sends", () => {
    const plan = planImport([{ kind: "show", id: "sh1", name: "Sunday", project: undefined }], { currentProject: "cur" });
    const body = buildImportRequest(preview, [{ kind: "show", id: "sh1", decision: "import", targetProject: plan.rows[0]!.targetProject }], makeId);
    expect(body.shows[0]!.projectId).toBe("cur");
  });
});

describe("buildImportRequest", () => {
  it("copying a song remaps show rows and show-song overrides to the new id", () => {
    const body = buildImportRequest(
      preview,
      [
        { kind: "song", id: "s1", decision: "copy", targetProject: "cur" },
        { kind: "show", id: "sh1", decision: "import", targetProject: "cur" },
      ],
      makeId,
    );
    const newId = body.songs[0]!.id;
    expect(newId).not.toBe("s1");
    expect(body.songs[0]!.title).toBe("Song One (copy)");
    const s = body.shows[0]!;
    expect((s.rows[0] as { songId: string }).songId).toBe(newId);
    expect(s.songs[0]!.songId).toBe(newId);
    expect(s.projectId).toBe("cur");
  });

  it("copying a template remaps graphic, lyric, intro and local slide template refs", () => {
    const tpl = { id: "t1", name: "Lyric" } as unknown as Template;
    const body = buildImportRequest(
      { ...preview, templates: [tpl] },
      [
        { kind: "template", id: "t1", decision: "copy", targetProject: "cur" },
        { kind: "song", id: "s1", decision: "import", targetProject: "cur" },
        { kind: "show", id: "sh1", decision: "import", targetProject: "cur" },
      ],
      makeId,
    );
    const t = body.templates[0]!.id;
    const s = body.shows[0]!;
    expect((s.rows[0] as { lyricTemplateId: string }).lyricTemplateId).toBe(t);
    expect((s.rows[1] as { templateId: string }).templateId).toBe(t);
    expect((s.rows[2] as { localSlides: { templateId: string }[] }).localSlides[0]!.templateId).toBe(t);
    expect(s.songs[0]!.introTemplateId).toBe(t);
  });

  it("leaves references alone when nothing is copied, and skips skipped rows", () => {
    const body = buildImportRequest(
      preview,
      [
        { kind: "song", id: "s1", decision: "skip", targetProject: "cur" },
        { kind: "show", id: "sh1", decision: "replace", targetProject: "cur" },
      ],
      makeId,
    );
    expect(body.songs).toEqual([]);
    expect((body.shows[0]!.rows[0] as { songId: string }).songId).toBe("s1");
  });

  it("an imported (copied) show keeps sections, section ids, stage layouts and slides rows through show validation", () => {
    const body = buildImportRequest(
      preview,
      [
        { kind: "song", id: "s1", decision: "copy", targetProject: "cur" },
        { kind: "show", id: "sh1", decision: "copy", targetProject: "cur" },
      ],
      makeId,
    );
    const parsed = ShowSchema.parse(JSON.parse(JSON.stringify(body.shows[0]))) as Show;
    expect(parsed.sections).toEqual([{ id: "sec1", name: "Worship" }]);
    expect(parsed.rows.map((r) => r.kind)).toEqual(["song", "graphic", "slides"]);
    expect(parsed.rows[0]!.sectionId).toBe("sec1");
    expect(parsed.rows[2]!.sectionId).toBe("sec1");
    expect((parsed.rows[0] as { stageLayouts?: unknown }).stageLayouts).toEqual({ stage: "lay" });
    expect(parsed.name).toBe("Sunday (copy)");
  });
});
