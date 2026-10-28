import { describe, expect, it } from "vitest";
import {
  computeVisible,
  listBodyState,
  loadListPrefs,
  moveSelection,
  normalizeSearch,
  saveListPrefs,
  shouldFocusSearch,
  type FilterSpec,
  type SortSpec,
} from "./libraryListModel";

type Item = { id: string; name: string; n: number };
const items: Item[] = [
  { id: "1", name: "Élan", n: 2 },
  { id: "2", name: "apple pie", n: 1 },
  { id: "3", name: "Banana", n: 3 },
];
const sorts: SortSpec<Item>[] = [
  { id: "name-asc", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "n-desc", label: "Count", compare: (a, b) => b.n - a.n },
];
const filters: FilterSpec<Item>[] = [
  {
    id: "size",
    label: "Size",
    options: [
      { value: "small", label: "Small" },
      { value: "big", label: "Big" },
    ],
    test: (t, v) => (v === "big" ? t.n >= 2 : t.n < 2),
  },
];
const base = {
  items,
  query: "",
  searchText: (t: Item) => t.name,
  sorts,
  sortId: "name-asc",
  filterValues: {} as Record<string, string>,
};
const d = { sortIds: ["name-asc"], defaultSort: "name-asc", gridAvailable: false };

describe("normalizeSearch", () => {
  it("strips accents, lowercases and collapses punctuation", () =>
    expect(normalizeSearch("  Élan—Vital! ")).toBe("elan vital"));
});

describe("computeVisible", () => {
  it("matches every term, accent- and case-insensitive", () =>
    expect(computeVisible({ ...base, query: "ELAN" }).map((t) => t.id)).toEqual(["1"]));
  it("requires every query term", () => {
    expect(computeVisible({ ...base, query: "pie apple" }).map((t) => t.id)).toEqual(["2"]);
    expect(computeVisible({ ...base, query: "apple banana" })).toEqual([]);
  });
  it("sorts by the chosen spec", () =>
    expect(computeVisible({ ...base, sortId: "n-desc" }).map((t) => t.id)).toEqual(["3", "1", "2"]));
  it("unknown sort id keeps input order", () =>
    expect(computeVisible({ ...base, sortId: "gone" }).map((t) => t.id)).toEqual(["1", "2", "3"]));
  it("is a stable sort", () => {
    const tie: SortSpec<Item>[] = [{ id: "tie", label: "Tie", compare: () => 0 }];
    expect(computeVisible({ ...base, sorts: tie, sortId: "tie" }).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });
  it("treats filter value 'all' as no filter", () => {
    expect(computeVisible({ ...base, filters, filterValues: { size: "all" } })).toHaveLength(3);
    expect(computeVisible({ ...base, filters, filterValues: { size: "" } })).toHaveLength(3);
    expect(
      computeVisible({ ...base, filters, filterValues: { size: "big" } }).map((t) => t.id),
    ).toEqual(["3", "1"]);
  });
  it("does not mutate the input", () => {
    const copy = [...items];
    computeVisible({ ...base, sortId: "n-desc" });
    expect(items).toEqual(copy);
  });
});

describe("loadListPrefs", () => {
  it("unknown sort id and bad JSON fall back to defaults", () => {
    const s = { getItem: () => '{"sort":"gone","view":"grid","filters":{"x":"y"}}' };
    expect(loadListPrefs(s, "songs", d)).toEqual({ sort: "name-asc", filters: {}, view: "list" });
    expect(loadListPrefs({ getItem: () => "{nope" }, "songs", d).sort).toBe("name-asc");
    expect(
      loadListPrefs(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "songs",
        d,
      ).view,
    ).toBe("list");
  });
  it("reads the namespaced key and keeps valid values", () => {
    let asked = "";
    const s = {
      getItem: (k: string) => {
        asked = k;
        return '{"sort":"n-desc","view":"grid","filters":{"size":"big","gone":"x"}}';
      },
    };
    const prefs = loadListPrefs(s, "songs", {
      sortIds: ["name-asc", "n-desc"],
      defaultSort: "name-asc",
      filters: filters as FilterSpec<unknown>[],
      gridAvailable: true,
    });
    expect(asked).toBe("overlaysys.list.songs");
    expect(prefs).toEqual({ sort: "n-desc", filters: { size: "big" }, view: "grid" });
  });
  it("drops a removed filter option and handles null storage / non-object JSON", () => {
    const fd = { ...d, filters: filters as FilterSpec<unknown>[] };
    expect(loadListPrefs({ getItem: () => '{"filters":{"size":"huge"}}' }, "k", fd).filters).toEqual({});
    expect(loadListPrefs(null, "k", fd)).toEqual({ sort: "name-asc", filters: {}, view: "list" });
    expect(loadListPrefs({ getItem: () => "42" }, "k", fd)).toEqual({ sort: "name-asc", filters: {}, view: "list" });
    expect(loadListPrefs({ getItem: () => null }, "k", fd).sort).toBe("name-asc");
  });
});

describe("saveListPrefs", () => {
  it("writes JSON under the namespaced key and swallows errors", () => {
    const writes: [string, string][] = [];
    saveListPrefs({ setItem: (k, v) => void writes.push([k, v]) }, "songs", {
      sort: "n-desc",
      filters: {},
      view: "list",
    });
    expect(writes).toEqual([["overlaysys.list.songs", '{"sort":"n-desc","filters":{},"view":"list"}']]);
    expect(() =>
      saveListPrefs(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        "songs",
        { sort: "x", filters: {}, view: "list" },
      ),
    ).not.toThrow();
    expect(() => saveListPrefs(null, "songs", { sort: "x", filters: {}, view: "list" })).not.toThrow();
  });
});

describe("moveSelection", () => {
  it("moveSelection clamps", () => {
    expect(moveSelection(["a", "b"], "b", 1)).toBe("b");
    expect(moveSelection(["a", "b"], null, -1)).toBe("b");
  });
  it("moves, starts at first, handles empty and unknown current", () => {
    expect(moveSelection(["a", "b", "c"], "a", 1)).toBe("b");
    expect(moveSelection(["a", "b", "c"], "a", -1)).toBe("a");
    expect(moveSelection(["a", "b"], null, 1)).toBe("a");
    expect(moveSelection([], null, 1)).toBeNull();
    expect(moveSelection(["a", "b"], "gone", 1)).toBe("a");
  });
});

describe("shouldFocusSearch", () => {
  const ev = { key: "a", ctrlKey: false, metaKey: false, altKey: false, targetTag: "DIV", targetEditable: false };
  it("shouldFocusSearch ignores modifiers and inputs", () => {
    expect(shouldFocusSearch(ev)).toBe(true);
    expect(shouldFocusSearch({ ...ev, metaKey: true })).toBe(false);
    expect(shouldFocusSearch({ ...ev, key: "ArrowDown" })).toBe(false);
    expect(shouldFocusSearch({ ...ev, targetTag: "INPUT" })).toBe(false);
  });
  it("ignores ctrl/alt, textarea/select, editables and space", () => {
    expect(shouldFocusSearch({ ...ev, ctrlKey: true })).toBe(false);
    expect(shouldFocusSearch({ ...ev, altKey: true })).toBe(false);
    expect(shouldFocusSearch({ ...ev, targetTag: "TEXTAREA" })).toBe(false);
    expect(shouldFocusSearch({ ...ev, targetTag: "SELECT" })).toBe(false);
    expect(shouldFocusSearch({ ...ev, targetEditable: true })).toBe(false);
    expect(shouldFocusSearch({ ...ev, key: " " })).toBe(false);
    expect(shouldFocusSearch({ ...ev, key: "É" })).toBe(true);
  });
});

describe("listBodyState", () => {
  it("listBodyState: error wins over empty", () =>
    expect(listBodyState({ error: "Not connected", total: 0, visible: 0 })).toBe("error"));
  it("listBodyState: no-match when items exist but none visible", () =>
    expect(listBodyState({ total: 3, visible: 0 })).toBe("no-match"));
  it("precedence error > loading > empty > list", () => {
    expect(listBodyState({ error: "x", loading: true, total: 3, visible: 3 })).toBe("error");
    expect(listBodyState({ loading: true, total: 0, visible: 0 })).toBe("loading");
    expect(listBodyState({ total: 0, visible: 0 })).toBe("empty");
    expect(listBodyState({ error: null, total: 2, visible: 1 })).toBe("list");
  });
});
