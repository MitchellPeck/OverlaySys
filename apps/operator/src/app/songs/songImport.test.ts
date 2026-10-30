import { describe, expect, it } from "vitest";
import { exportFileName } from "../../lib/exportName";
import type { Song } from "@overlaysys/core";
import { findCcliDuplicate, parseSongImportJson, resolveImportId, stripServerFields, uniqueSlug, slugInput, finalSlug } from "./songImport";

describe("stripServerFields", () => {
  const song = {
    id: "a", title: "T", sections: [], defaultArrangement: [], customFields: { k: "v" },
    deletedAt: "2026-01-01", createdAt: "2025-01-01", updatedAt: "2026-02-02",
  } as unknown as Song;
  it("removes deletedAt, createdAt and updatedAt but keeps other keys", () => {
    const r = stripServerFields(song);
    expect(r).not.toHaveProperty("deletedAt");
    expect(r).not.toHaveProperty("createdAt");
    expect(r).not.toHaveProperty("updatedAt");
    expect(r.customFields).toEqual({ k: "v" });
  });
  it("keeps the replaced song's createdAt", () => {
    expect(stripServerFields(song, { createdAt: "2024-05-05" }).createdAt).toBe("2024-05-05");
  });
});

describe("uniqueSlug", () => {
  it("keeps a free slug", () => {
    expect(uniqueSlug("amazing", new Set())).toBe("amazing");
  });
  it("suffixes past every taken variant", () => {
    expect(uniqueSlug("amazing", new Set(["amazing", "amazing-2"]))).toBe("amazing-3");
  });
});

describe("findCcliDuplicate", () => {
  const songs = [
    { id: "a", title: "A", ccliNumber: "123" },
    { id: "b", title: "B" },
  ];
  it("matches trimmed CCLI numbers", () => {
    expect(findCcliDuplicate(" 123 ", songs)?.id).toBe("a");
  });
  it("never matches a blank CCLI", () => {
    expect(findCcliDuplicate("", songs)).toBeNull();
    expect(findCcliDuplicate(undefined, songs)).toBeNull();
  });
});

describe("resolveImportId", () => {
  const dup = { id: "existing", title: "X", ccliNumber: "1" };
  it("replace keeps the duplicate's id", () => {
    expect(resolveImportId("new", new Set(["existing"]), dup, "replace")).toBe("existing");
  });
  it("copy auto-suffixes a colliding slug instead of overwriting", () => {
    expect(resolveImportId("existing", new Set(["existing"]), dup, "copy")).toBe("existing-2");
  });
  it("a slug colliding with a non-duplicate song is suffixed too", () => {
    expect(resolveImportId("other", new Set(["other"]), null, "copy")).toBe("other-2");
  });
});

describe("song JSON import", () => {
  const sampleSong = () => ({
    id: "s1",
    title: "Placeholder Song",
    sections: [{ id: "v1", kind: "verse" as const, label: "Verse 1", slides: [{ id: "v1s1", lines: ["Line one"] }] }],
    defaultArrangement: ["v1"],
  });
  it("export file name comes from plan 1's helper", () =>
    expect(exportFileName("song", { id: "s", title: "Placeholder: Song", ccliNumber: "123" })).toBe(
      "Placeholder Song (CCLI 123).json",
    ));
  it("export then import round-trips", () => {
    const r = parseSongImportJson(JSON.stringify(sampleSong()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.song).toMatchObject(sampleSong());
  });
  it("import rejects JSON that isn't a song", () => {
    expect(parseSongImportJson("{}")).toMatchObject({ ok: false });
    expect(parseSongImportJson("nope")).toMatchObject({ ok: false });
  });
});

describe("slugInput / finalSlug", () => {
  it("lowercases, strips accents and turns other characters into dashes", () => {
    expect(slugInput("Café Dël Mar's Song")).toBe("cafe-del-mar-s-song");
  });
  it("collapses dashes while typing but keeps a trailing one so a dash can be typed", () => {
    expect(slugInput("a  --b-")).toBe("a-b-");
  });
  it("keeps underscores and digits", () => {
    expect(slugInput("psalm_23")).toBe("psalm_23");
  });
  it("finalSlug trims the dashes", () => {
    expect(finalSlug("-a-b-")).toBe("a-b");
  });
  it("finalSlug is empty when nothing usable is left", () => {
    expect(finalSlug("日本語 !!")).toBe("");
  });
});
