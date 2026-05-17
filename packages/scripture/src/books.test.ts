import { describe, expect, it } from "vitest";
import { BOOKS, findBookByAlias } from "./books";

describe("BOOKS", () => {
  it("contains 66 books (39 OT + 27 NT)", () => {
    expect(BOOKS).toHaveLength(66);
  });

  it("each book has a unique id", () => {
    const ids = new Set(BOOKS.map((b) => b.id));
    expect(ids.size).toBe(BOOKS.length);
  });

  it("each book has at least one alias", () => {
    for (const b of BOOKS) {
      expect(b.aliases.length).toBeGreaterThan(0);
    }
  });

  it("chapter counts are positive", () => {
    for (const b of BOOKS) {
      expect(b.chapters).toBeGreaterThan(0);
    }
  });
});

describe("findBookByAlias", () => {
  it("resolves the full English name", () => {
    expect(findBookByAlias("John")?.id).toBe("JHN");
    expect(findBookByAlias("Genesis")?.id).toBe("GEN");
    expect(findBookByAlias("Revelation")?.id).toBe("REV");
  });

  it("is case-insensitive", () => {
    expect(findBookByAlias("john")?.id).toBe("JHN");
    expect(findBookByAlias("GENESIS")?.id).toBe("GEN");
  });

  it("tolerates leading/trailing whitespace", () => {
    expect(findBookByAlias("  John  ")?.id).toBe("JHN");
  });

  it("resolves common abbreviations", () => {
    expect(findBookByAlias("Gen")?.id).toBe("GEN");
    expect(findBookByAlias("Rom")?.id).toBe("ROM");
    expect(findBookByAlias("1 Cor")?.id).toBe("1CO");
    expect(findBookByAlias("1Cor")?.id).toBe("1CO");
    expect(findBookByAlias("Ps")?.id).toBe("PSA");
    expect(findBookByAlias("Psalm")?.id).toBe("PSA");
    expect(findBookByAlias("Psalms")?.id).toBe("PSA");
  });

  it("disambiguates Philippians vs Philemon", () => {
    expect(findBookByAlias("Phil")?.id).toBe("PHP");   // Philippians
    expect(findBookByAlias("Philem")?.id).toBe("PHM"); // Philemon
    expect(findBookByAlias("Phlm")?.id).toBe("PHM");
    expect(findBookByAlias("Philippians")?.id).toBe("PHP");
    expect(findBookByAlias("Philemon")?.id).toBe("PHM");
  });

  it("returns null for unknown input", () => {
    expect(findBookByAlias("Foobar")).toBeNull();
    expect(findBookByAlias("")).toBeNull();
  });
});
