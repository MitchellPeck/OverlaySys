import { describe, expect, it } from "vitest";
import type { RundownRow, Show } from "@overlaysys/core";
import { canSave, dropTarget, insertRowsAfter, nameForSave, nudgeRow, removeRowAt, restoreRow } from "./showEditOps";

const g = (id: string, sectionId?: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: "graphic", templateId: "t", ...(sectionId ? { sectionId } : {}), ...extra }) as unknown as RundownRow;

function mk(): Show {
  return {
    id: "s",
    name: "S",
    projectId: "p",
    songs: [],
    sections: [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ],
    rows: [g("a1", "A"), g("a2", "A"), g("a3", "A"), g("b1", "B"), g("b2", "B")],
    extra: { keep: true },
  } as unknown as Show;
}
const ids = (s: Show) => s.rows.map((r) => `${r.id}:${r.sectionId ?? "-"}`);

describe("showEditOps", () => {
  it("removeRowAt/restoreRow round-trip keeps index and sectionId", () => {
    const show = mk();
    const { show: after, removed } = removeRowAt(show, "a3");
    expect(after.rows).toHaveLength(4);
    expect(removed).toMatchObject({ index: 2 });
    expect(restoreRow(after, removed!)).toEqual(show);
    const mid = removeRowAt(show, "b1");
    expect(restoreRow(mid.show, mid.removed!)).toEqual(show);
  });
  it("removeRowAt on unknown id is a no-op", () => {
    const show = mk();
    expect(removeRowAt(show, "zz")).toEqual({ show, removed: null });
  });
  it("restoreRow falls back to no-section when the section is gone", () => {
    const { show: after, removed } = removeRowAt(mk(), "b2");
    const noB = { ...after, sections: [{ id: "A", name: "A" }] } as Show;
    expect(restoreRow(noB, removed!).rows.find((r) => r.id === "b2")?.sectionId).toBeUndefined();
  });
  it("keeps unknown row keys and show keys", () => {
    const show = { ...mk(), rows: [g("a1", "A", { future: 1 }), g("a2", "A")] } as Show;
    const { show: after, removed } = removeRowAt(show, "a1");
    const back = restoreRow(after, removed!);
    expect((back.rows[0] as unknown as { future: number }).future).toBe(1);
    expect((back as unknown as { extra: unknown }).extra).toEqual({ keep: true });
  });
  it("nudgeRow up from the first row of a section moves it to the end of the previous section", () => {
    expect(ids(nudgeRow(mk(), "b1", -1))).toEqual(["a1:A", "a2:A", "a3:A", "b1:A", "b2:B"]);
  });
  it("nudgeRow down from the last row crosses to the start of the next section", () => {
    expect(ids(nudgeRow(mk(), "a3", 1))).toEqual(["a1:A", "a2:A", "a3:B", "b1:B", "b2:B"]);
  });
  it("nudgeRow within a section and at the ends", () => {
    expect(ids(nudgeRow(mk(), "a2", 1))).toEqual(["a1:A", "a3:A", "a2:A", "b1:B", "b2:B"]);
    expect(ids(nudgeRow(mk(), "a1", -1))).toEqual(ids(mk()));
    expect(ids(nudgeRow(mk(), "b2", 1))).toEqual(ids(mk()));
  });
  it("dropTarget before a row in another section yields that section and index", () => {
    expect(dropTarget(mk(), { overRowId: "b2", half: "before" })).toEqual({ toSectionId: "B", toIndex: 1 });
    expect(dropTarget(mk(), { overRowId: "a1", half: "after" })).toEqual({ toSectionId: "A", toIndex: 1 });
    expect(dropTarget(mk(), { overSectionId: "B", at: "end" })).toEqual({ toSectionId: "B", toIndex: 2 });
    expect(dropTarget(mk(), { overSectionId: "A", at: "start" })).toEqual({ toSectionId: "A", toIndex: 0 });
  });
  it("canSave explains why not", () => {
    expect(canSave({ connected: false, cloud: false, dirty: true, saving: false })).toEqual({ ok: false, reason: "Not connected" });
    expect(canSave({ connected: true, cloud: false, dirty: false, saving: false })).toEqual({ ok: false, reason: "No changes to save" });
    expect(canSave({ connected: true, cloud: false, dirty: true, saving: true })).toEqual({ ok: false, reason: "Saving…" });
    expect(canSave({ connected: false, cloud: true, dirty: true, saving: false })).toEqual({ ok: true, reason: null });
  });
  it("nameForSave falls back", () => {
    expect(nameForSave("  ")).toBe("Untitled show");
    expect(nameForSave(" Sunday ")).toBe("Sunday");
  });
  it("insertRowsAfter inserts in order after the anchor, in its section", () => {
    const out = insertRowsAfter(mk(), "a1", null, [g("n1"), g("n2")]);
    expect(ids(out)).toEqual(["a1:A", "n1:A", "n2:A", "a2:A", "a3:A", "b1:B", "b2:B"]);
  });
  it("insertRowsAfter with null anchor goes to the start of the section", () => {
    expect(ids(insertRowsAfter(mk(), null, "B", [g("n1")]))).toEqual(["a1:A", "a2:A", "a3:A", "n1:B", "b1:B", "b2:B"]);
  });
});
