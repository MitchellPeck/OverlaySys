import { describe, expect, it } from "vitest";
import { planImport } from "./planImport";

const rows = [
  { kind: "song", id: "a", name: "New", project: "p1" },
  { kind: "song", id: "b", name: "Same id", conflict: { name: "Same id", updatedAt: "2026-10-01" } },
  { kind: "song", id: "c", name: "Looks alike", likelyDuplicate: true },
];

describe("planImport", () => {
  const plan = planImport(rows, { currentProject: "cur" });
  it("defaults a conflict to replace", () => expect(plan.rows[1]!.decision).toBe("replace"));
  it("defaults a likely duplicate to skip", () => expect(plan.rows[2]!.decision).toBe("skip"));
  it("imports new items", () => expect(plan.rows[0]!.decision).toBe("import"));
  it("falls back to the current project", () => {
    expect(plan.rows[0]!.targetProject).toBe("p1");
    expect(plan.rows[1]!.targetProject).toBe("cur");
  });
  it("summarises the plan", () => expect(plan.summary).toBe("Import 1, replace 1, skip 1"));
  it("leaves out empty parts", () => {
    expect(planImport([rows[0]!], { currentProject: "cur" }).summary).toBe("Import 1");
    expect(planImport([], { currentProject: "cur" }).summary).toBe("Nothing to import");
  });
});
