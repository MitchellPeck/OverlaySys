import { describe, expect, it } from "vitest";
import type { RundownRow, Show } from "./show";
import {
  addSection,
  deleteSection,
  groupRowsBySection,
  insertRow,
  moveRow,
  moveSection,
  orderRowsBySection,
  renameSection,
  sectionLength,
} from "./sections";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const g = (id: string, sectionId?: string): RundownRow =>
  ({ kind: "graphic", id, templateId: "t", data: {}, ...(sectionId ? { sectionId } : {}) }) as RundownRow;

const make = (): Show =>
  deepFreeze({
    id: "s",
    name: "Show",
    rows: [g("r1"), g("r2", "A"), g("r3", "A"), g("r4", "B"), g("r5", "A")],
    sections: [
      { id: "A", name: "Alpha" },
      { id: "B", name: "Beta" },
    ],
  } as unknown as Show);

const ids = (groups: ReturnType<typeof groupRowsBySection>) =>
  groups.map((x) => [x.section?.id ?? null, x.rows.map((r) => r.id)]);
const rowIds = (s: Show) => s.rows.map((r) => r.id);

describe("groupRowsBySection", () => {
  it("groups: no-section first, then sections in order, members in rows order", () =>
    expect(ids(groupRowsBySection(make()))).toEqual([[null, ["r1"]], ["A", ["r2", "r3", "r5"]], ["B", ["r4"]]]));
  it("rows with an unknown sectionId fall into the no-section group", () => {
    const s = deepFreeze({ ...make(), rows: [g("r1", "gone"), g("r2", "A")] }) as Show;
    expect(ids(groupRowsBySection(s))).toEqual([[null, ["r1"]], ["A", ["r2"]], ["B", []]]);
  });
  it("a show without sections is one flat group, even when empty", () => {
    const s = make();
    expect(groupRowsBySection({ ...s, sections: undefined, rows: [] })).toEqual([{ section: null, rows: [] }]);
  });
  it("empty sections are kept as groups", () => {
    const s = deepFreeze({ ...make(), rows: [g("r1")] }) as Show;
    expect(ids(groupRowsBySection(s))).toEqual([[null, ["r1"]], ["A", []], ["B", []]]);
  });
  it("duplicate section ids: the first wins", () => {
    const s = deepFreeze({
      ...make(),
      sections: [
        { id: "A", name: "one" },
        { id: "A", name: "two" },
      ],
    }) as Show;
    const groups = groupRowsBySection(s);
    expect(groups.filter((x) => x.section).length).toBe(1);
    expect(groups[1]!.section!.name).toBe("one");
  });
});

describe("orderRowsBySection", () => {
  it("puts r5 before r4", () => expect(rowIds(orderRowsBySection(make()))).toEqual(["r1", "r2", "r3", "r5", "r4"]));
  it("returns the same show when already ordered", () => {
    const s = orderRowsBySection(make());
    expect(orderRowsBySection(s)).toBe(s);
  });
});

describe("moveRow / insertRow", () => {
  it("moveRow into B at 0 sets sectionId and display order", () => {
    const s = moveRow(make(), "r2", "B", 0);
    expect(s.rows.find((r) => r.id === "r2")!.sectionId).toBe("B");
    expect(rowIds(s)).toEqual(["r1", "r3", "r5", "r2", "r4"]);
  });
  it("moveRow to null removes the sectionId key", () => {
    const s = moveRow(make(), "r4", null, 9);
    expect(rowIds(s)).toEqual(["r1", "r4", "r2", "r3", "r5"]);
    expect("sectionId" in s.rows.at(1)!).toBe(false);
  });
  it("moveRow with an unknown section or row returns the same show", () => {
    const s = make();
    expect(moveRow(s, "r2", "nope", 0)).toBe(s);
    expect(moveRow(s, "zz", "A", 0)).toBe(s);
  });
  it("moveRow to its own place returns the same show", () => {
    const s = orderRowsBySection(make());
    expect(moveRow(s, "r2", "A", 0)).toBe(s);
  });
  it("moveRow clamps the index", () =>
    expect(rowIds(moveRow(make(), "r1", "B", 99))).toEqual(["r2", "r3", "r5", "r4", "r1"]));
  it("insertRow adds into a section at an index", () => {
    const s = insertRow(make(), g("n1"), "A", 1);
    expect(rowIds(s)).toEqual(["r1", "r2", "n1", "r3", "r5", "r4"]);
    expect(s.rows.find((r) => r.id === "n1")!.sectionId).toBe("A");
  });
  it("insertRow into no section strips sectionId", () => {
    const s = insertRow(make(), g("n1", "A"), null, 0);
    expect(rowIds(s)[0]).toBe("n1");
    expect("sectionId" in s.rows[0]!).toBe(false);
  });
});

describe("section CRUD", () => {
  it("addSection(null) inserts first; empty name becomes 'Section 3'", () => {
    const { show, section } = addSection(make(), "  ", null, "X");
    expect(section).toEqual({ id: "X", name: "Section 3" });
    expect(show.sections!.map((x) => x.id)).toEqual(["X", "A", "B"]);
  });
  it("addSection appends by default, inserts after a known id, appends for an unknown id", () => {
    expect(addSection(make(), "N", undefined, "X").show.sections!.map((x) => x.id)).toEqual(["A", "B", "X"]);
    expect(addSection(make(), "N", "A", "X").show.sections!.map((x) => x.id)).toEqual(["A", "X", "B"]);
    expect(addSection(make(), "N", "zz", "X").show.sections!.map((x) => x.id)).toEqual(["A", "B", "X"]);
  });
  it("addSection default id is sec-<8 hex>; works on a show with no sections", () => {
    const s = { ...make(), sections: undefined, rows: [g("r1")] } as Show;
    const { show, section } = addSection(s, "Intro");
    expect(section.id).toMatch(/^sec-[0-9a-f]{8}$/);
    expect(show.sections).toEqual([section]);
    expect(rowIds(show)).toEqual(["r1"]);
  });
  it("deleteSection keep-rows moves B's rows into A; A's into no-section", () => {
    const b = deleteSection(make(), "B", "keep-rows");
    expect(ids(groupRowsBySection(b))).toEqual([
      [null, ["r1"]],
      ["A", ["r2", "r3", "r5", "r4"]],
    ]);
    expect(b.rows.find((r) => r.id === "r4")!.sectionId).toBe("A");
    const a = deleteSection(make(), "A", "keep-rows");
    expect(ids(groupRowsBySection(a))).toEqual([
      [null, ["r1", "r2", "r3", "r5"]],
      ["B", ["r4"]],
    ]);
    expect("sectionId" in a.rows.find((r) => r.id === "r2")!).toBe(false);
  });
  it("deleteSection delete-rows removes the members", () =>
    expect(rowIds(deleteSection(make(), "A", "delete-rows"))).toEqual(["r1", "r4"]));
  it("deleting the last section removes the sections key", () => {
    const one = deleteSection(deleteSection(make(), "A", "keep-rows"), "B", "keep-rows");
    expect("sections" in one).toBe(false);
    expect(rowIds(one)).toEqual(["r1", "r2", "r3", "r5", "r4"]);
  });
  it("deleteSection of an unknown id returns the same show", () => {
    const s = make();
    expect(deleteSection(s, "zz", "keep-rows")).toBe(s);
  });
  it("renameSection trims, ignores blank and unknown", () => {
    const s = make();
    expect(renameSection(s, "A", "  ")).toBe(s);
    expect(renameSection(s, "zz", "x")).toBe(s);
    expect(renameSection(s, "A", " New ").sections![0]!.name).toBe("New");
  });
  it("moveSection reorders sections and rows", () => {
    const s = moveSection(make(), "B", 0);
    expect(s.sections!.map((x) => x.id)).toEqual(["B", "A"]);
    expect(rowIds(s)).toEqual(["r1", "r4", "r2", "r3", "r5"]);
    const s0 = make();
    expect(moveSection(s0, "zz", 0)).toBe(s0);
  });
});

describe("sectionLength", () => {
  it("sums lengthSec and is null without lengths", () => {
    const x = g("x");
    expect(sectionLength([{ ...x, lengthSec: 120 } as RundownRow, { ...x, lengthSec: 30 } as RundownRow, x])).toBe(150);
    expect(sectionLength([x])).toBeNull();
  });
});
