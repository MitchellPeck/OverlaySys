import { describe, expect, it } from "vitest";
import type { RundownRow, Show } from "@overlaysys/core";
import {
  duplicateRowIn,
  insertNewRows,
  itemSummary,
  moveRowToSection,
  moveToSectionChoices,
  savedSettles,
  sectionIdOf,
  sectionRowCount,
  showForSave,
} from "./showEditorModel";

const g = (id: string, sectionId?: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: "graphic", templateId: "t", data: {}, ...(sectionId ? { sectionId } : {}), ...extra }) as unknown as RundownRow;

function mk(): Show {
  return {
    id: "s",
    name: "S",
    projectId: "p",
    songs: [],
    sections: [
      { id: "A", name: "Welcome" },
      { id: "B", name: "Worship" },
    ],
    rows: [g("a1", "A"), g("a2", "A"), g("b1", "B")],
    futureKey: 1,
  } as unknown as Show;
}
const ids = (s: Show) => s.rows.map((r) => `${r.id}:${r.sectionId ?? "-"}`);

describe("showEditorModel", () => {
  it("sectionIdOf: the selected row's known section, null for none/unknown, undefined when nothing is selected", () => {
    const show = mk();
    expect(sectionIdOf(show, "b1")).toBe("B");
    expect(sectionIdOf(show, null)).toBeUndefined();
    const orphan = { ...show, rows: [...show.rows, g("x", "gone")] };
    expect(sectionIdOf(orphan, "x")).toBeNull();
  });

  it("insertNewRows goes after the selection, in its section", () => {
    const out = insertNewRows(mk(), "a1", [g("n1"), g("n2")]);
    expect(ids(out)).toEqual(["a1:A", "n1:A", "n2:A", "a2:A", "b1:B"]);
    expect((out as unknown as { futureKey: number }).futureKey).toBe(1);
  });

  it("insertNewRows with no selection appends to the last group (an empty last section included)", () => {
    expect(ids(insertNewRows(mk(), null, [g("n")]))).toEqual(["a1:A", "a2:A", "b1:B", "n:B"]);
    const withEmpty = { ...mk(), sections: [...mk().sections!, { id: "C", name: "Close" }] };
    expect(ids(insertNewRows(withEmpty, null, [g("n")]))).toEqual(["a1:A", "a2:A", "b1:B", "n:C"]);
    const empty = { ...mk(), sections: undefined, rows: [] } as unknown as Show;
    expect(ids(insertNewRows(empty, null, [g("n")]))).toEqual(["n:-"]);
  });

  it("duplicateRowIn copies every key under a new id right after the original", () => {
    const show = { ...mk(), rows: [g("a1", "A", { notes: "cue", futureRowKey: 2 }), g("b1", "B")] } as Show;
    const out = duplicateRowIn(show, "a1", "copy");
    expect(ids(out)).toEqual(["a1:A", "copy:A", "b1:B"]);
    expect(out.rows[1]).toMatchObject({ notes: "cue", futureRowKey: 2, id: "copy" });
    expect(duplicateRowIn(show, "nope", "copy")).toBe(show);
  });

  it("moveToSectionChoices lists the other sections, plus No section for a row in a section", () => {
    expect(moveToSectionChoices(mk(), "a1")).toEqual([
      { id: null, label: "No section" },
      { id: "B", label: "Worship" },
    ]);
    const plain = { ...mk(), rows: [...mk().rows, g("z")] };
    expect(moveToSectionChoices(plain, "z")).toEqual([
      { id: "A", label: "Welcome" },
      { id: "B", label: "Worship" },
    ]);
  });

  it("moveRowToSection appends the row to the end of the target section", () => {
    expect(ids(moveRowToSection(mk(), "a1", "B"))).toEqual(["a2:A", "b1:B", "a1:B"]);
    expect(ids(moveRowToSection(mk(), "b1", null))).toEqual(["b1:-", "a1:A", "a2:A"]);
  });

  it("sectionRowCount counts the rows in a section", () => {
    expect(sectionRowCount(mk(), "A")).toBe(2);
    expect(sectionRowCount(mk(), "nope")).toBe(0);
  });

  it("itemSummary: '<n> item(s) · Total M:SS' (total only when a row has a length)", () => {
    expect(itemSummary(mk())).toBe("3 items");
    const one = { ...mk(), rows: [g("a", undefined, { lengthSec: 125 })] } as Show;
    expect(itemSummary(one)).toBe("1 item · Total 2:05");
  });

  it("showForSave keeps unknown keys and fills an empty name", () => {
    const show = { ...mk(), name: "   " } as Show;
    const out = showForSave(show);
    expect(out.name).toBe("Untitled show");
    expect((out as unknown as { futureKey: number }).futureKey).toBe(1);
    expect(out.rows).toBe(show.rows);
  });

  it("savedSettles only when the draft hasn't changed since it was sent", () => {
    const sent = mk();
    expect(savedSettles(sent, sent)).toBe(true);
    expect(savedSettles(sent, { ...sent, name: "edited during save" })).toBe(false);
    expect(savedSettles(sent, null)).toBe(false);
  });
});
