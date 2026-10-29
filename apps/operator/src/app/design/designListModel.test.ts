import { describe, expect, it } from "vitest";
import type { StageLayoutMeta, TemplateMeta } from "@overlaysys/core";
import {
  OFFLINE_REASON,
  stageMenuItems,
  templateMenuItems,
  stageSorts,
  templateColumns,
  templateFilters,
  templateSecondary,
  templateSorts,
  usedByLabel,
  type DesignActions,
} from "./designListModel";

const t = (o: Partial<TemplateMeta> & { id: string }): TemplateMeta => ({ name: o.id, size: { w: 1920, h: 1080 }, ...o });
const order = (items: TemplateMeta[], id: string) =>
  [...items].sort(templateSorts.find((s) => s.id === id)!.compare).map((x) => x.id);

describe("templateSorts", () => {
  const items = [
    t({ id: "nodate", name: "Alpha" }),
    t({ id: "old", name: "Zed", updatedAt: "2026-10-01T00:00:00.000Z" }),
    t({ id: "new", name: "Mid", updatedAt: "2026-10-20T00:00:00.000Z" }),
    t({ id: "nodate2", name: "Beta" }),
  ];
  it("edited-desc: newest first, undated last, then name", () => {
    expect(order(items, "edited-desc")).toEqual(["new", "old", "nodate", "nodate2"]);
  });
  it("name-asc ignores case", () => {
    expect(order([t({ id: "b", name: "beta" }), t({ id: "a", name: "Alpha" })], "name-asc")).toEqual(["a", "b"]);
  });
});

describe("role filter and columns", () => {
  const f = templateFilters[0]!;
  it("uses templateRole", () => {
    expect(f.test(t({ id: "x", name: "Lyric main" }), "lyric")).toBe(true);
    expect(f.test(t({ id: "x", name: "Old thing" }), "other")).toBe(true);
    expect(f.test(t({ id: "x", name: "Lower third", role: "title" }), "graphic")).toBe(false);
  });
  it("columns render type, size and edited", () => {
    const cols = templateColumns(() => new Date("2026-10-22T12:00:00.000Z"));
    const row = t({ id: "x", name: "Lower third", updatedAt: "2026-10-20T12:00:00.000Z" });
    expect(cols.map((c) => c.render(row))).toEqual(["Graphic", "1920×1080", "2 days ago"]);
  });
  it("secondary", () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    expect(templateSecondary(t({ id: "x", updatedAt: "2026-10-20T12:00:00.000Z" }), now)).toBe(
      "1920×1080 · edited 2 days ago",
    );
    expect(templateSecondary(t({ id: "x" }), now)).toBe("1920×1080");
  });
});

const l = (o: Partial<StageLayoutMeta> & { id: string }): StageLayoutMeta => ({
  name: o.id,
  size: { w: 1920, h: 1080 },
  builtIn: false,
  ...o,
});

describe("stage layouts", () => {
  it("name-asc puts built-ins first", () => {
    const items = [l({ id: "a", name: "Alpha" }), l({ id: "z", name: "Zeta", builtIn: true })];
    expect([...items].sort(stageSorts[0]!.compare).map((x) => x.id)).toEqual(["z", "a"]);
  });
  const acts = { open() {}, duplicate() {}, rename() {}, delete() {}, copyId() {} } as DesignActions<StageLayoutMeta>;
  it("built-ins hide Rename and disable Delete with a reason", () => {
    const items = stageMenuItems(l({ id: "s", builtIn: true }), acts);
    expect(items.some((i) => "id" in i && i.id === "rename")).toBe(false);
    const del = items.find((i) => "id" in i && i.id === "delete");
    expect(del && "disabled" in del && del.disabled).toBe("Built-in layouts can't be deleted");
  });
  it("custom layouts can be renamed and deleted", () => {
    const items = stageMenuItems(l({ id: "s" }), acts);
    expect(items.some((i) => "id" in i && i.id === "rename")).toBe(true);
    const del = items.find((i) => "id" in i && i.id === "delete");
    expect(del && "disabled" in del && del.disabled).toBe(false);
  });
  it("usedByLabel", () => {
    expect(usedByLabel([])).toBe("—");
    expect(usedByLabel([{ id: "c1", name: "Stage" }, { id: "c2" }])).toBe("Stage, c2");
  });
});

describe("offline menu items", () => {
  const acts = { open() {}, duplicate() {}, rename() {}, delete() {}, copyId() {}, export() {} };
  const disabledOf = (items: ReturnType<typeof templateMenuItems>, id: string) => {
    const i = items.find((x) => "id" in x && x.id === id);
    return i && "disabled" in i ? i.disabled : false;
  };
  it("templates: Duplicate/Rename/Delete disabled with a reason; Open/Export/Copy id stay enabled", () => {
    const items = templateMenuItems(t({ id: "a" }), acts, OFFLINE_REASON);
    for (const id of ["duplicate", "rename", "delete"]) expect(disabledOf(items, id), id).toBe(OFFLINE_REASON);
    for (const id of ["open", "export", "copy-id"]) expect(disabledOf(items, id), id).toBe(false);
    expect(disabledOf(templateMenuItems(t({ id: "a" }), acts), "delete")).toBe(false);
  });
  it("stage layouts: same, and built-in Delete keeps its own reason", () => {
    const items = stageMenuItems(l({ id: "s" }), acts, OFFLINE_REASON);
    for (const id of ["duplicate", "rename", "delete"]) expect(disabledOf(items, id), id).toBe(OFFLINE_REASON);
    expect(disabledOf(items, "open")).toBe(false);
    expect(disabledOf(stageMenuItems(l({ id: "s", builtIn: true }), acts, OFFLINE_REASON), "delete")).toBe(
      "Built-in layouts can't be deleted",
    );
  });
});
