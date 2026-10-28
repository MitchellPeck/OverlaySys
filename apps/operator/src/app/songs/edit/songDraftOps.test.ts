import { describe, expect, it } from "vitest";
import type { Section, Song } from "@overlaysys/core";
import {
  addSongSection,
  appendToArrangement,
  decideIncomingSong,
  firstLine,
  linesFromText,
  moveArrangementChip,
  moveByOne,
  nextSlideId,
  removeArrangementAt,
  removeSection,
  removeSlide,
  restoreSection,
  restoreSlide,
  sameSongContent,
  sectionsNotInArrangement,
  setSectionKind,
  slideText,
  uniqueLabel,
} from "./songDraftOps";

describe("draft ops (arrangement, labels, undo)", () => {
  const base = (): Song =>
    song({
      sections: [
        section("v1", ["v1s1", "v1s2"]),
        { id: "v2", kind: "verse", label: "Verse 2", slides: [{ id: "v2s1", lines: ["a"] }] },
        { id: "t1", kind: "tag", label: "Tag", slides: [{ id: "t1s1", lines: ["b"] }] },
      ],
      defaultArrangement: ["v1", "v2", "v1"],
      extra: 1,
    } as Partial<Song>);

  it("addSongSection joins the arrangement [SONGS-2]", () => {
    const r = addSongSection(base(), "bridge");
    expect(r.song.defaultArrangement.at(-1)).toBe(r.sectionId);
    expect(r.song.sections.at(-1)!.label).toBe("Bridge 1");
    expect((r.song as unknown as { extra: number }).extra).toBe(1);
  });
  it("sectionsNotInArrangement lists unused sections", () =>
    expect(sectionsNotInArrangement(base())).toEqual(["t1"]));
  it("uniqueLabel suffixes duplicates", () => {
    const s = song({ sections: [{ ...section("c1", ["x"]), label: "Chorus" }] });
    expect(uniqueLabel(s, "Chorus")).toBe("Chorus 2");
    expect(uniqueLabel(s, "Chorus", "c1")).toBe("Chorus");
  });
  it("setSectionKind relabels an auto label only", () => {
    expect(setSectionKind(base(), "v2", "chorus").sections[1]!.label).toBe("Chorus 2");
    const custom = base();
    custom.sections[1] = { ...custom.sections[1]!, label: "Big ending" };
    expect(setSectionKind(custom, "v2", "tag").sections[1]!.label).toBe("Big ending");
    expect(setSectionKind(custom, "v2", "tag").sections[1]!.kind).toBe("tag");
  });
  it("arrangement append/move/remove", () => {
    expect(appendToArrangement(base(), "t1").defaultArrangement).toEqual(["v1", "v2", "v1", "t1"]);
    expect(moveArrangementChip(base(), 0, 2).defaultArrangement).toEqual(["v2", "v1", "v1"]);
    expect(removeArrangementAt(base(), 1).defaultArrangement).toEqual(["v1", "v1"]);
  });
  it("removeSlide/restoreSlide round-trip [SONGS-5]", () => {
    const s = base();
    const r = removeSlide(s, "v1", "v1s2");
    expect(r.song.sections[0]!.slides).toHaveLength(1);
    expect(restoreSlide(r.song, r.removed!)).toEqual(s);
    expect(removeSlide(s, "v2", "v2s1").removed).toBeNull();
  });
  it("removeSection drops its arrangement entries and restore puts them back", () => {
    const s = base();
    const r = removeSection(s, "v1");
    expect(r.song.sections.map((x) => x.id)).toEqual(["v2", "t1"]);
    expect(r.song.defaultArrangement).toEqual(["v2"]);
    expect(restoreSection(r.song, r.removed)).toEqual(s);
  });
  it("slideText / linesFromText", () => {
    expect(slideText({ id: "a", lines: ["x", "y"] })).toBe("x\ny");
    expect(linesFromText("x\ny\n\n")).toEqual(["x", "y"]);
    expect(linesFromText("")).toEqual([""]);
  });
  it("firstLine", () =>
    expect(
      firstLine({ id: "a", kind: "verse", label: "a", slides: [{ id: "s", lines: ["", "Line one of verse one"] }] }),
    ).toBe("Line one of verse one"));
});

function section(id: string, slideIds: string[]): Section {
  return { id, kind: "verse", label: id, slides: slideIds.map((s) => ({ id: s, lines: [s] })) };
}

function song(over: Partial<Song> = {}): Song {
  return {
    id: "s",
    title: "T",
    sections: [section("v1", ["v1s1"])],
    defaultArrangement: ["v1"],
    customFields: {},
    ...over,
  };
}

describe("nextSlideId", () => {
  it("appends the next number", () => {
    const sec = section("v1", ["v1s1", "v1s2"]);
    expect(nextSlideId({ sections: [sec] }, sec)).toBe("v1s3");
  });

  it("skips a suffix still in use after a delete", () => {
    // v1s1, v1s2, v1s3 → delete v1s2 → counting would give v1s3 again.
    const sec = section("v1", ["v1s1", "v1s3"]);
    expect(nextSlideId({ sections: [sec] }, sec)).toBe("v1s4");
  });

  it("avoids ids used by other sections", () => {
    const a = section("v1", ["v1s1"]);
    const b = section("x", ["v1s2"]);
    expect(nextSlideId({ sections: [a, b] }, a)).toBe("v1s3");
  });
});

describe("moveByOne", () => {
  it("moves up and down", () => {
    expect(moveByOne(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveByOne(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("is a no-op at the edges", () => {
    expect(moveByOne(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveByOne(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("decideIncomingSong", () => {
  const base = song();
  const edited = song({ title: "Mine" });
  const remote = song({ title: "Theirs" });

  it("adopts when nothing is loaded yet", () => {
    expect(decideIncomingSong({ draft: null, baseline: null }, base)).toBe("adopt");
  });

  it("adopts another client's change when clean", () => {
    expect(decideIncomingSong({ draft: base, baseline: base }, remote)).toBe("adopt");
  });

  it("treats its own save echo as a rebase, ignoring updatedAt", () => {
    const echo = { ...edited, updatedAt: "2026-01-01T00:00:00.000Z" };
    expect(decideIncomingSong({ draft: edited, baseline: edited }, echo)).toBe("rebase");
  });

  it("rebases on the save echo even when the user typed during the save", () => {
    const typedMore = song({ title: "Mine, more" });
    expect(decideIncomingSong({ draft: typedMore, baseline: edited }, edited)).toBe("rebase");
  });

  it("flags a conflict when dirty and the song changed elsewhere", () => {
    expect(decideIncomingSong({ draft: edited, baseline: base }, remote)).toBe("conflict");
  });

  it("sameSongContent ignores write stamps", () => {
    expect(sameSongContent(base, { ...base, updatedAt: "x" })).toBe(true);
    expect(sameSongContent(base, edited)).toBe(false);
  });
});
