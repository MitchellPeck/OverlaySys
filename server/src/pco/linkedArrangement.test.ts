import { describe, expect, it } from "vitest";
import type { Section, Song } from "@overlaysys/core";
import { arrangementFromSequence, linkedRowArrangement, mergeReimportedArrangement } from "./linkedArrangement";

const sec = (id: string, label: string): Section =>
  ({ id, kind: "verse", label, slides: [{ id: `${id}s`, lines: ["x"] }] }) as Section;
const sections = [sec("v1", "Verse 1"), sec("c1", "Chorus"), sec("v2", "Verse 2"), sec("b1", "Bridge")];

describe("arrangementFromSequence", () => {
  it("maps labels, keeping repeats", () => {
    expect(arrangementFromSequence(sections, ["Verse 1", "Chorus", "Chorus", "Bridge"])).toEqual([
      "v1",
      "c1",
      "c1",
      "b1",
    ]);
  });
  it("is case and space insensitive and skips unmatched", () => {
    expect(arrangementFromSequence(sections, ["verse1", "Tag", " CHORUS "])).toEqual(["v1", "c1"]);
  });
  it("returns null when nothing matches", () => {
    expect(arrangementFromSequence(sections, ["Tag"])).toBeNull();
    expect(arrangementFromSequence(sections, undefined)).toBeNull();
  });
});

describe("linkedRowArrangement", () => {
  const song = { sections, defaultArrangement: ["v1", "c1"] } as unknown as Song;
  it("is undefined when equal to the default or unmatched", () => {
    expect(linkedRowArrangement(song, ["Verse 1", "Chorus"])).toBeUndefined();
    expect(linkedRowArrangement(song, ["Tag"])).toBeUndefined();
  });
  it("returns a differing arrangement", () => {
    expect(linkedRowArrangement(song, ["Verse 2"])).toEqual(["v2"]);
  });
});

describe("mergeReimportedArrangement", () => {
  it("keeps an operator edit", () => {
    const r = mergeReimportedArrangement(
      { arrangement: ["v1", "b1"], sourceRef: { pcoArrangement: ["v1", "c1"] } },
      ["v2"],
    );
    expect(r.arrangement).toEqual(["v1", "b1"]);
  });
  it("overwrites when unset or still PCO's", () => {
    expect(mergeReimportedArrangement(undefined, ["v2"])).toEqual({ arrangement: ["v2"], pcoArrangement: ["v2"] });
    expect(
      mergeReimportedArrangement({ arrangement: ["v1"], sourceRef: { pcoArrangement: ["v1"] } }, ["v2"]),
    ).toEqual({ arrangement: ["v2"], pcoArrangement: ["v2"] });
  });
  it("clears when PCO no longer matches and the row was untouched", () => {
    expect(
      mergeReimportedArrangement({ arrangement: ["v1"], sourceRef: { pcoArrangement: ["v1"] } }, undefined),
    ).toEqual({});
  });
});
