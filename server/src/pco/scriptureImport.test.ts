import { describe, expect, it } from "vitest";
import { ScriptureRowSchema, makeSourceRef, type ScriptureRow } from "@overlaysys/core";
import { buildImportedScriptureRow } from "./scriptureImport";

const sourceRef = makeSourceRef("st-1", "plan-1", "item-S");
const base = {
  rowId: "row-1",
  reference: "john 3:16-18",
  translation: "KJV",
  templateId: "tpl-scripture",
  sourceRef,
};

describe("buildImportedScriptureRow", () => {
  it("builds a normalized, schema-valid scripture row", async () => {
    const row = await buildImportedScriptureRow({ ...base, notes: "read slowly" });
    expect(() => ScriptureRowSchema.parse(row)).not.toThrow();
    expect(row.kind).toBe("scripture");
    expect(row.id).toBe("row-1");
    expect(row.reference).toBe("John 3:16-18");
    expect(row.translation).toBe("KJV");
    expect(row.translationAbbreviation).toBe("KJV");
    expect(row.templateId).toBe("tpl-scripture");
    expect(row.sourceRef).toEqual(sourceRef);
    expect(row.notes).toBe("read slowly");
    expect(row.attribution).toBeTruthy();
    expect(row.slides.flatMap((s) => s.verses).map((v) => v.verse)).toEqual([16, 17, 18]);
  });

  it("splits slides by slideMaxChars", async () => {
    const big = await buildImportedScriptureRow({ ...base, slideMaxChars: 2000 });
    const small = await buildImportedScriptureRow({ ...base, slideMaxChars: 40 });
    expect(small.slides.length).toBeGreaterThan(big.slides.length);
  });

  it("rejects an unknown translation", async () => {
    await expect(buildImportedScriptureRow({ ...base, translation: "NOPE" })).rejects.toThrow(/NOPE/);
  });

  it("rejects an unparseable reference", async () => {
    await expect(buildImportedScriptureRow({ ...base, reference: "Welcome" })).rejects.toThrow();
  });

  it("preserves an existing row with the same reference and translation", async () => {
    const built = await buildImportedScriptureRow(base);
    const edited: ScriptureRow = {
      ...built,
      slides: [{ id: "custom", verses: built.slides[0]!.verses.slice(0, 1) }],
      introTemplateId: "intro-x",
      templateId: "old-tpl",
      notes: "old",
    };
    const row = await buildImportedScriptureRow({
      ...base,
      reference: "John 3:16-18",
      templateId: "new-tpl",
      notes: "new",
      existing: edited,
    });
    expect(row.slides).toEqual(edited.slides);
    expect(row.introTemplateId).toBe("intro-x");
    expect(row.templateId).toBe("new-tpl");
    expect(row.notes).toBe("new");
  });

  it("rebuilds when the existing row has a different reference", async () => {
    const other = await buildImportedScriptureRow({ ...base, reference: "Romans 8:28" });
    const row = await buildImportedScriptureRow({ ...base, existing: other });
    expect(row.reference).toBe("John 3:16-18");
    expect(row.slides).not.toEqual(other.slides);
  });
});
