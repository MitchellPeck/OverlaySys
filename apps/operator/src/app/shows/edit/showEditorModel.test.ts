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
  undoRowDelete,
  isBareUnusedSongDefault,
  undoSectionDelete,
} from "./showEditorModel";
import { deleteSection, renameSection } from "@overlaysys/core";
import { removeRowAt } from "./showEditOps";

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

  it("undoSectionDelete returns the pre-delete draft when nothing changed since", () => {
    const prev = mk();
    const next = deleteSection(prev, "A", "keep-rows");
    expect(undoSectionDelete(next, prev, next, "A")).toBe(prev);
  });

  it("undoSectionDelete keeps later edits: re-adds the section and moves its rows back (keep-rows)", () => {
    const prev = mk();
    const next = deleteSection(prev, "A", "keep-rows");
    const later = renameSection({ ...next, name: "Edited later" }, "B", "Praise");
    const out = undoSectionDelete(later, prev, next, "A");
    expect(out.name).toBe("Edited later");
    expect(out.sections).toEqual([
      { id: "A", name: "Welcome" },
      { id: "B", name: "Praise" },
    ]);
    expect(ids(out)).toEqual(["a1:A", "a2:A", "b1:B"]);
  });

  it("undoSectionDelete re-inserts deleted rows (delete-rows) but not ones removed later", () => {
    const prev = mk();
    const next = deleteSection(prev, "A", "delete-rows");
    const later = { ...next, rows: [...next.rows, g("new", "B")] } as Show;
    const out = undoSectionDelete(later, prev, next, "A");
    expect(ids(out)).toEqual(["a1:A", "a2:A", "b1:B", "new:B"]);
    // keep-rows, then a moved-out row deleted separately: it stays deleted.
    const kept = deleteSection(prev, "A", "keep-rows");
    const after = removeRowAt(kept, "a2").show;
    expect(ids(undoSectionDelete(after, prev, kept, "A"))).toEqual(["a1:A", "b1:B"]);
  });

  it("isBareUnusedSongDefault: only an untouched default no item uses", () => {
    const song = (id: string, songId: string) => ({ id, kind: "song", songId, lyricTemplateId: "l" }) as unknown as RundownRow;
    const show = {
      ...mk(),
      songs: [{ songId: "x" }, { songId: "y", lyricTemplateId: "t" }, { songId: "z" }],
      rows: [song("r1", "z")],
    } as unknown as Show;
    expect(isBareUnusedSongDefault(show, "x")).toBe(true);
    expect(isBareUnusedSongDefault(show, "y")).toBe(false);
    expect(isBareUnusedSongDefault(show, "z")).toBe(false);
    expect(isBareUnusedSongDefault(show, "missing")).toBe(false);
  });

  it("undo never crosses shows", () => {
    const prev = mk();
    const next = deleteSection(prev, "A", "keep-rows");
    const other = { ...mk(), id: "other" } as Show;
    expect(undoSectionDelete(other, prev, next, "A")).toBe(other);
    const { removed } = removeRowAt(prev, "a1");
    expect(undoRowDelete(other, "s", removed!)).toBe(other);
    const after = removeRowAt(prev, "a1").show;
    expect(ids(undoRowDelete(after, "s", removed!))).toEqual(["a1:A", "a2:A", "b1:B"]);
  });
});
