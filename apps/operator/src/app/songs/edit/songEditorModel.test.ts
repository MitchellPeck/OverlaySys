import { describe, expect, it } from "vitest";
import type { Section, Song } from "@overlaysys/core";
import {
  customFieldKey,
  isSongNotFound,
  moveSlideWithin,
  moveSongSection,
  outputChannelGroups,
  slideEditorText,
  songSubtitle,
} from "./songEditorModel";

const sec = (id: string, slides: string[]): Section => ({
  id,
  kind: "verse",
  label: id,
  slides: slides.map((s) => ({ id: s, lines: [`Line one of ${s}`] })),
});
const song = (over: Partial<Song> = {}): Song =>
  ({
    id: "s",
    title: "Placeholder song",
    customFields: {},
    sections: [sec("v1", ["a", "b", "c"]), sec("v2", ["d"]), sec("v3", ["e"])],
    defaultArrangement: ["v1", "v2"],
    extra: 7,
    ...over,
  }) as Song;

describe("songSubtitle", () => {
  it("adds the CCLI number when there is one", () => {
    expect(songSubtitle(song({ ccliNumber: "1234567" }))).toBe("Song · CCLI 1234567");
    expect(songSubtitle(song())).toBe("Song");
  });
});

describe("outputChannelGroups", () => {
  it("splits program-type channels from stage displays and drops mirrors", () => {
    const g = outputChannelGroups([
      { id: "program", name: "Program", kind: "graphics" },
      { id: "alpha", name: "Alpha", kind: "graphics", mirrorOf: "program" },
      { id: "stage", name: "Stage", kind: "stage" },
      { id: "lower", name: "Lower", kind: "graphics" },
      { id: "preview", name: "Preview", kind: "graphics" },
    ] as never);
    expect(g.program.map((c) => c.id)).toEqual(["program", "lower"]);
    expect(g.stage.map((c) => c.id)).toEqual(["stage"]);
  });
});

describe("customFieldKey", () => {
  it("derives the key from the label with slugifyTitle", () =>
    expect(customFieldKey("Hymn Number", ["author"])).toEqual({ key: "hymn_number" }));
  it("treats an existing hymn_number key as a duplicate", () =>
    expect(customFieldKey("Hymn number", ["hymn_number"])).toEqual({ error: "A field with this name already exists" }));
  it("rejects an empty label", () => expect(customFieldKey("  ", [])).toEqual({ error: "Enter a label" }));
  it("rejects a key that already exists, ignoring case", () =>
    expect(customFieldKey("Hymn number", ["Hymn-Number"])).toEqual({ error: "A field with this name already exists" }));
});

describe("slideEditorText", () => {
  it("keeps the local text while it still maps to the slide's lines (trailing newline survives)", () =>
    expect(slideEditorText("Line one\n", ["Line one"])).toBe("Line one\n"));
  it("shows the slide's lines when they changed elsewhere (undo, revert)", () =>
    expect(slideEditorText("Line one\n", ["Other line"])).toBe("Other line"));
  it("shows the slide's lines when there is no local text", () =>
    expect(slideEditorText(null, ["a", "b"])).toBe("a\nb"));
});

describe("moveSongSection", () => {
  it("moves a section and keeps unknown keys", () => {
    const r = moveSongSection(song(), 0, 2);
    expect(r.sections.map((s) => s.id)).toEqual(["v2", "v3", "v1"]);
    expect((r as unknown as { extra: number }).extra).toBe(7);
  });
  it("is a no-op out of range", () =>
    expect(moveSongSection(song(), 0, 9).sections.map((s) => s.id)).toEqual(["v1", "v2", "v3"]));
});

describe("moveSlideWithin", () => {
  it("reorders the slides of one section", () =>
    expect(moveSlideWithin(song(), "v1", 2, 0).sections[0]!.slides.map((s) => s.id)).toEqual(["c", "a", "b"]));
});

describe("isSongNotFound", () => {
  it("matches not_found for this id only", () => {
    expect(isSongNotFound({ type: "error", code: "not_found", message: "nope" }, "nope")).toBe(true);
    expect(isSongNotFound({ type: "error", code: "not_found", message: "other" }, "nope")).toBe(false);
    expect(isSongNotFound({ type: "error", code: "handler_error", message: "nope" }, "nope")).toBe(false);
  });
});
