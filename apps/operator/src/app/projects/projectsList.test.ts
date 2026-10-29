import { describe, expect, it } from "vitest";
import {
  projectMenuItems,
  projectNameError,
  projectSecondary,
  projectSorts,
  unassignedItems,
  type ProjectActions,
  type ProjectRow,
} from "./projectsList";

const row = (o: Partial<ProjectRow> = {}): ProjectRow => ({
  id: "sunday-services",
  name: "Sunday services",
  shows: 3,
  hotcards: 2,
  countsKnown: true,
  isCurrent: false,
  isDefault: false,
  ...o,
});
const noop = () => {};
const actions: ProjectActions = { makeCurrent: noop, rename: noop, customFields: noop, copyId: noop, remove: noop };

const find = (items: ReturnType<typeof projectMenuItems>, id: string) =>
  items.find((i) => !("separator" in i) && i.id === id);

describe("projectSecondary", () => {
  it("counts items and never shows the id", () => {
    const s = projectSecondary(row());
    expect(s).toBe("3 shows · 2 hotcards");
    expect(s).not.toContain("sunday-services");
  });
  it("singularises", () => {
    expect(projectSecondary(row({ shows: 1, hotcards: 1 }))).toBe("1 show · 1 hotcard");
  });
});

describe("projectMenuItems", () => {
  it("disables Delete with a reason when the project has items", () => {
    const d = find(projectMenuItems(row(), actions), "delete");
    expect(d && !("separator" in d) && d.disabled).toBe("Move or delete its shows and hotcards first");
  });
  it("disables Delete as Loading… until counts are known", () => {
    const d = find(projectMenuItems(row({ shows: 0, hotcards: 0, countsKnown: false }), actions), "delete");
    expect(d && !("separator" in d) && d.disabled).toBe("Loading…");
  });
  it("enables Delete for an empty project", () => {
    const d = find(projectMenuItems(row({ shows: 0, hotcards: 0 }), actions), "delete");
    expect(d && !("separator" in d) && d.disabled).toBe(false);
  });
  it("orders items with a separator before Delete", () => {
    const items = projectMenuItems(row(), actions);
    expect(items.map((i) => ("separator" in i ? "-" : i.id))).toEqual([
      "make-current",
      "rename",
      "custom-fields",
      "copy-id",
      "-",
      "delete",
    ]);
  });
  it("disables Make current on the current project", () => {
    const m = find(projectMenuItems(row({ isCurrent: true }), actions), "make-current");
    expect(m && !("separator" in m) && !!m.disabled).toBe(true);
  });
});

describe("projectSorts", () => {
  it("puts the current project first", () => {
    const rows = [row({ id: "a", name: "Alpha" }), row({ id: "b", name: "Beta", isCurrent: true })];
    const s = projectSorts.find((x) => x.id === "current-first")!;
    expect([...rows].sort(s.compare).map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("defaults to name-asc", () => {
    expect(projectSorts[0]!.id).toBe("name-asc");
  });
});

describe("projectNameError", () => {
  it("rejects blank", () => expect(projectNameError("  ", [])).toBe("Enter a name"));
  it("rejects duplicates case-insensitively", () =>
    expect(projectNameError("test", ["Test"])).toBe('A project named "test" already exists'));
  it("accepts a new name", () => expect(projectNameError("New", ["Test"])).toBeNull());
});

describe("unassignedItems", () => {
  it("finds items whose project is gone", () => {
    const r = unassignedItems(
      [{ projectId: "gone" }, { projectId: "p" }],
      [{ projectId: "p" }, { projectId: "gone" }],
      ["p"],
    );
    expect(r.shows).toEqual([{ projectId: "gone" }]);
    expect(r.hotcards).toEqual([{ projectId: "gone" }]);
  });
});
